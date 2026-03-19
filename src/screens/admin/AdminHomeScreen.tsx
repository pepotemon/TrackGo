// src/screens/admin/AdminHomeScreen.tsx
// ✅ OPTIMIZADO:
// - reduce trabajo repetido en render con useMemo
// - indexa clients/users una sola vez
// - evita recomputar filtros pesados múltiples veces
// - mantiene daily/week stats correctos sin inflar
// - Meta Leads ahora tiene filtro Semana / Mes
// - weekly/monthly Meta Leads usa timestamps del estado real:
//   * verified -> verifiedAt / verificationStatusChangedAt / updatedAt
//   * pending_review / incomplete / not_suitable -> verificationStatusChangedAt / updatedAt
// - pending de cobranza sigue contando SOLO clientes pending asignados
// - sin romper UX actual

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ImageBackground,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import bgMap from "../../../assets/bg-map.png";
import { useAuth } from "../../auth/useAuth";
import { subscribeAdminClients } from "../../data/repositories/clientsRepo";
import { subscribeDailyEventsByRange } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, DailyEventDoc, UserDoc } from "../../types/models";

type AdminAction = {
    title: string;
    subtitle: string;
    icon: any;
    route:
    | "/admin/users"
    | "/admin/clients"
    | "/admin/accounting"
    | "/admin/leads";
};

type LeadsRangeMode = "week" | "month";

type LeadDerivedStatus =
    | "verified"
    | "pending_review"
    | "incomplete"
    | "not_suitable";

function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function todayKey() {
    return dayKeyFromDate(new Date());
}

function weekRangeKeys(base = new Date()) {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);
    const jsDay = d.getDay(); // 0=Dom..6=Sáb
    const diffToMonday = jsDay === 0 ? 6 : jsDay - 1;
    const start = new Date(d);
    start.setDate(d.getDate() - diffToMonday);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    return {
        startKey: dayKeyFromDate(start),
        endKey: dayKeyFromDate(end),
        startMs: start.getTime(),
        endMs: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime(),
    };
}

function monthRangeKeys(base = new Date()) {
    const d = new Date(base);
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

    return {
        startKey: dayKeyFromDate(start),
        endKey: dayKeyFromDate(end),
        startMs: start.getTime(),
        endMs: end.getTime(),
    };
}

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toMillis === "function") return v.toMillis();
    if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

/**
 * Último evento por clientId dentro del rango.
 * Luego filtramos por status actual del client para no inflar.
 */
function latestEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();

    for (const e of events) {
        const cid = String((e as any)?.clientId ?? "").trim();
        if (!cid) continue;

        const prev = map.get(cid);
        const eMs = toMs((e as any)?.createdAt);
        const pMs = prev ? toMs((prev as any)?.createdAt) : 0;

        if (!prev || eMs >= pMs) {
            map.set(cid, e);
        }
    }

    return map;
}

function getRatePerVisit(u?: UserDoc | null) {
    const anyU: any = u as any;
    const n = anyU?.ratePerVisit ?? anyU?.visitFee ?? 0;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function isMetaLead(c: ClientDoc) {
    return String((c as any)?.source ?? "").trim().toLowerCase() === "whatsapp_meta";
}

function isMetaUnassignedLead(c: ClientDoc) {
    return isMetaLead(c) && !String((c as any)?.assignedTo ?? "").trim();
}

function getDerivedLeadQueueStatus(c: ClientDoc): LeadDerivedStatus {
    const verificationStatus = String((c as any)?.verificationStatus ?? "").trim().toLowerCase();
    const leadQuality = String((c as any)?.leadQuality ?? "").trim().toLowerCase();
    const parseStatus = String((c as any)?.parseStatus ?? "").trim().toLowerCase();

    if (verificationStatus === "verified") return "verified";
    if (verificationStatus === "pending_review") return "pending_review";
    if (verificationStatus === "incomplete") return "incomplete";
    if (verificationStatus === "not_suitable") return "not_suitable";

    if (leadQuality === "not_suitable") return "not_suitable";
    if (parseStatus === "ready") return "pending_review";

    return "incomplete";
}

function getLeadStatusTimestampMs(c: ClientDoc, status: LeadDerivedStatus) {
    if (status === "verified") {
        return (
            toMs((c as any)?.verifiedAt) ||
            toMs((c as any)?.verificationStatusChangedAt) ||
            toMs((c as any)?.updatedAt) ||
            toMs((c as any)?.createdAt)
        );
    }

    return (
        toMs((c as any)?.verificationStatusChangedAt) ||
        toMs((c as any)?.updatedAt) ||
        toMs((c as any)?.createdAt)
    );
}

function isWithinRange(ms: number, startMs: number, endMs: number) {
    if (!ms) return false;
    return ms >= startMs && ms <= endMs;
}

function buildLeadStatsForRange(
    clients: ClientDoc[],
    startMs: number,
    endMs: number
) {
    let verified = 0;
    let pendingReview = 0;
    let incomplete = 0;
    let notSuitable = 0;

    for (const c of clients) {
        if (!isMetaLead(c)) continue;

        const status = getDerivedLeadQueueStatus(c);
        const statusMs = getLeadStatusTimestampMs(c, status);

        if (!isWithinRange(statusMs, startMs, endMs)) continue;

        if (status === "verified") {
            verified += 1;
            continue;
        }

        if (!isMetaUnassignedLead(c)) continue;

        if (status === "pending_review") pendingReview += 1;
        else if (status === "incomplete") incomplete += 1;
        else if (status === "not_suitable") notSuitable += 1;
    }

    return {
        verified,
        pendingReview,
        incomplete,
        notSuitable,
        activeQueue: pendingReview + incomplete + notSuitable,
        total: verified + pendingReview + incomplete + notSuitable,
    };
}

const COLORS = {
    bg: "#07111F",
    card: "rgba(10, 20, 37, 0.74)",
    border: "rgba(255,255,255,0.08)",
    borderSoft: "rgba(125, 211, 252, 0.16)",

    text: "#F8FAFC",
    muted: "#9FB0C4",
    softText: "#CBD5E1",

    primary: "#5AC8FA",
    primaryBright: "#7BE0FF",
    primarySoft: "#BFDBFE",

    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",
    info: "#60A5FA",
    purple: "#C4B5FD",

    logoutBg: "rgba(127, 29, 29, 0.22)",
    logoutBorder: "rgba(248,113,113,0.18)",

    navBg: "rgba(9, 18, 34, 0.96)",
    navBorder: "rgba(255,255,255,0.08)",
    navItem: "rgba(255,255,255,0.04)",
    navItemActive: "rgba(90,200,250,0.14)",
};

const TinyStat = React.memo(function TinyStat({
    icon,
    color,
    value,
    label,
}: {
    icon: any;
    color: string;
    value: number;
    label: string;
}) {
    return (
        <View style={styles.tinyStatWrap} accessibilityLabel={`${label}: ${value}`}>
            <Ionicons name={icon} size={15} color={color} />
            <Text style={styles.tinyStatValue}>{value}</Text>
        </View>
    );
});

const BottomNavItem = React.memo(function BottomNavItem({
    title,
    icon,
    onPress,
    active,
}: {
    title: string;
    icon: any;
    onPress: () => void;
    active?: boolean;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.bottomNavItem,
                active && styles.bottomNavItemActive,
                pressed && styles.pressed,
            ]}
        >
            <View style={[styles.bottomNavIconWrap, active && styles.bottomNavIconWrapActive]}>
                <Ionicons
                    name={icon}
                    size={18}
                    color={active ? COLORS.primaryBright : COLORS.primaryBright}
                />
            </View>
            <Text style={styles.bottomNavText}>{title}</Text>
        </Pressable>
    );
});

const RangeTogglePill = React.memo(function RangeTogglePill({
    active,
    label,
    onPress,
}: {
    active: boolean;
    label: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.rangePill,
                active && styles.rangePillActive,
                pressed && styles.pressed,
            ]}
        >
            <Text style={[styles.rangePillText, active && styles.rangePillTextActive]}>
                {label}
            </Text>
        </Pressable>
    );
});

export default function AdminHomeScreen() {
    const { profile, logout } = useAuth();
    const router = useRouter();

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [todayEvents, setTodayEvents] = useState<DailyEventDoc[]>([]);
    const [weekEvents, setWeekEvents] = useState<DailyEventDoc[]>([]);

    const [refreshing, setRefreshing] = useState(false);
    const [refreshTick, setRefreshTick] = useState(0);
    const [leadsRangeMode, setLeadsRangeMode] = useState<LeadsRangeMode>("week");

    const actions: AdminAction[] = useMemo(
        () => [
            {
                title: "Usuarios",
                subtitle: "Cobradores, roles y estado",
                icon: "people-outline",
                route: "/admin/users",
            },
            {
                title: "Clientes",
                subtitle: "Base total y asignaciones",
                icon: "briefcase-outline",
                route: "/admin/clients",
            },
            {
                title: "Leads",
                subtitle: "Por revisar, incompletos y no aptos",
                icon: "funnel-outline",
                route: "/admin/leads",
            },
            {
                title: "Conta",
                subtitle: "Inversión semanal y ganancia real",
                icon: "stats-chart-outline",
                route: "/admin/accounting",
            },
        ],
        []
    );

    const weekRange = useMemo(() => weekRangeKeys(new Date()), []);
    const monthRange = useMemo(() => monthRangeKeys(new Date()), []);

    const reloadUsers = useCallback(async () => {
        const u = await listUsers("user");
        setUsers(u ?? []);
    }, []);

    useEffect(() => {
        void reloadUsers();
    }, [reloadUsers]);

    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);

    useEffect(() => {
        const tk = todayKey();
        const unsub = subscribeDailyEventsByRange(
            tk,
            tk,
            (list) => setTodayEvents(list ?? []),
            (err) => console.log("[AdminHome] today events err:", err?.code, err?.message)
        );
        return () => unsub();
    }, [refreshTick]);

    useEffect(() => {
        const unsub = subscribeDailyEventsByRange(
            weekRange.startKey,
            weekRange.endKey,
            (list) => setWeekEvents(list ?? []),
            (err) => console.log("[AdminHome] week events err:", err?.code, err?.message)
        );
        return () => unsub();
    }, [refreshTick, weekRange.startKey, weekRange.endKey]);

    const userById = useMemo(() => {
        const map = new Map<string, UserDoc>();
        for (const u of users) {
            map.set(u.id, u);
        }
        return map;
    }, [users]);

    const clientById = useMemo(() => {
        const map = new Map<string, ClientDoc>();
        for (const c of clients) {
            map.set(c.id, c);
        }
        return map;
    }, [clients]);

    const pendingNow = useMemo(() => {
        let count = 0;
        for (const c of clients) {
            if (c.status !== "pending") continue;
            if (!String(c.assignedTo ?? "").trim()) continue;
            count += 1;
        }
        return count;
    }, [clients]);

    const shouldCountEvent = useCallback(
        (e: DailyEventDoc) => {
            const cid = String((e as any)?.clientId ?? "").trim();
            if (!cid) return false;

            const client = clientById.get(cid);
            if (!client) return false;

            return client.status === e.type;
        },
        [clientById]
    );

    const todayStats = useMemo(() => {
        const latest = latestEventByClient(todayEvents);

        let visited = 0;
        let rejected = 0;
        const perUserVisits: Record<string, number> = {};
        const perUserAmount: Record<string, number> = {};

        for (const e of latest.values()) {
            if (!shouldCountEvent(e)) continue;

            if (e.type === "visited") {
                visited += 1;
                perUserVisits[e.userId] = (perUserVisits[e.userId] ?? 0) + 1;
            } else if (e.type === "rejected") {
                rejected += 1;
            }
        }

        for (const [uid, cnt] of Object.entries(perUserVisits)) {
            perUserAmount[uid] = cnt * getRatePerVisit(userById.get(uid));
        }

        const amountTotal = Object.values(perUserAmount).reduce((a, b) => a + b, 0);

        let topUid: string | null = null;
        let topAmount = 0;
        for (const [uid, amt] of Object.entries(perUserAmount)) {
            if (amt > topAmount) {
                topAmount = amt;
                topUid = uid;
            }
        }

        return {
            visited,
            rejected,
            amountTotal,
            topUid,
            topAmount,
        };
    }, [todayEvents, shouldCountEvent, userById]);

    const weekStats = useMemo(() => {
        const latest = latestEventByClient(weekEvents);

        let visited = 0;
        let rejected = 0;
        const perUserVisits: Record<string, number> = {};
        const perUserAmount: Record<string, number> = {};

        for (const e of latest.values()) {
            if (!shouldCountEvent(e)) continue;

            if (e.type === "visited") {
                visited += 1;
                perUserVisits[e.userId] = (perUserVisits[e.userId] ?? 0) + 1;
            } else if (e.type === "rejected") {
                rejected += 1;
            }
        }

        for (const [uid, cnt] of Object.entries(perUserVisits)) {
            perUserAmount[uid] = cnt * getRatePerVisit(userById.get(uid));
        }

        const amountTotal = Object.values(perUserAmount).reduce((a, b) => a + b, 0);

        return {
            visited,
            rejected,
            amountTotal,
        };
    }, [weekEvents, shouldCountEvent, userById]);

    const topUserLabel = useMemo(() => {
        if (!todayStats.topUid) return "—";
        const user = userById.get(todayStats.topUid);
        const name = user?.name?.trim() || "Usuario";
        return `${name} · R$ ${todayStats.topAmount.toFixed(2)}`;
    }, [todayStats.topUid, todayStats.topAmount, userById]);

    const weeklyLeadStats = useMemo(() => {
        return buildLeadStatsForRange(clients, weekRange.startMs, weekRange.endMs);
    }, [clients, weekRange.startMs, weekRange.endMs]);

    const monthlyLeadStats = useMemo(() => {
        return buildLeadStatsForRange(clients, monthRange.startMs, monthRange.endMs);
    }, [clients, monthRange.startMs, monthRange.endMs]);

    const visibleLeadStats = leadsRangeMode === "week" ? weeklyLeadStats : monthlyLeadStats;

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await reloadUsers();
            setRefreshTick((t) => t + 1);
        } finally {
            setRefreshing(false);
        }
    }, [reloadUsers]);

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            <ImageBackground
                source={bgMap}
                style={styles.bg}
                imageStyle={styles.bgImage}
                resizeMode="cover"
            >
                <View style={styles.overlay}>
                    <View style={styles.screen}>
                        <ScrollView
                            contentContainerStyle={styles.scrollContent}
                            refreshControl={
                                <RefreshControl
                                    refreshing={refreshing}
                                    onRefresh={onRefresh}
                                    tintColor="#FFFFFF"
                                />
                            }
                            showsVerticalScrollIndicator={false}
                            removeClippedSubviews
                        >
                            <View style={styles.header}>
                                <View style={styles.headerLeft}>
                                    <Text style={styles.hTitle}>Admin</Text>
                                    <Text style={styles.hSub} numberOfLines={1}>
                                        Hola, <Text style={styles.hSubStrong}>{profile?.name ?? "—"}</Text>
                                    </Text>
                                </View>

                                <Pressable
                                    onPress={logout}
                                    style={({ pressed }) => [
                                        styles.logoutBtn,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="log-out-outline"
                                        size={20}
                                        color={COLORS.bad}
                                    />
                                </Pressable>
                            </View>

                            <View style={styles.quickRow}>
                                <Pressable
                                    onPress={() => router.push({ pathname: "/admin/report" as any })}
                                    style={({ pressed }) => [
                                        styles.quickCard,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <View style={styles.quickTop}>
                                        <View style={styles.sectionIconWrap}>
                                            <Ionicons
                                                name="cash-outline"
                                                size={18}
                                                color={COLORS.primaryBright}
                                            />
                                        </View>

                                        <View style={[styles.badge, styles.badgeOk]}>
                                            <Text style={[styles.badgeText, styles.badgeTextOk]}>
                                                HOY
                                            </Text>
                                        </View>
                                    </View>

                                    <Text style={styles.quickTitle}>Cobranza de hoy</Text>
                                    <Text style={styles.quickMoney} numberOfLines={1}>
                                        R$ {todayStats.amountTotal.toFixed(2)}
                                    </Text>

                                    <View style={styles.tinyRow}>
                                        <TinyStat
                                            icon="checkmark-circle-outline"
                                            color={COLORS.ok}
                                            value={todayStats.visited}
                                            label="Visitados"
                                        />
                                        <TinyStat
                                            icon="close-circle-outline"
                                            color={COLORS.bad}
                                            value={todayStats.rejected}
                                            label="Rechazados"
                                        />
                                        <TinyStat
                                            icon="time-outline"
                                            color={COLORS.warn}
                                            value={pendingNow}
                                            label="Pendientes"
                                        />
                                    </View>

                                    <Text style={styles.quickSubMuted} numberOfLines={1}>
                                        Top: {topUserLabel}
                                    </Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => router.push({ pathname: "/admin/history" as any })}
                                    style={({ pressed }) => [
                                        styles.quickCard,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <View style={styles.quickTop}>
                                        <View style={styles.sectionIconWrap}>
                                            <Ionicons
                                                name="calendar-outline"
                                                size={18}
                                                color={COLORS.primaryBright}
                                            />
                                        </View>

                                        <View style={[styles.badge, styles.badgePrimary]}>
                                            <Text style={[styles.badgeText, styles.badgeTextPrimary]}>
                                                SEMANA
                                            </Text>
                                        </View>
                                    </View>

                                    <Text style={styles.quickTitle}>Cierre semanal</Text>
                                    <Text style={styles.quickMoney} numberOfLines={1}>
                                        R$ {weekStats.amountTotal.toFixed(2)}
                                    </Text>

                                    <View style={styles.tinyRow}>
                                        <TinyStat
                                            icon="checkmark-circle-outline"
                                            color={COLORS.ok}
                                            value={weekStats.visited}
                                            label="Visitados"
                                        />
                                        <TinyStat
                                            icon="close-circle-outline"
                                            color={COLORS.bad}
                                            value={weekStats.rejected}
                                            label="Rechazados"
                                        />
                                        <TinyStat
                                            icon="time-outline"
                                            color={COLORS.warn}
                                            value={pendingNow}
                                            label="Pendientes"
                                        />
                                    </View>

                                    <Text style={styles.quickSubMuted} numberOfLines={1}>
                                        Lunes → Domingo
                                    </Text>
                                </Pressable>
                            </View>

                            <Pressable
                                onPress={() => router.push({ pathname: "/admin/leads" as any })}
                                style={({ pressed }) => [
                                    styles.leadsBanner,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <View style={styles.leadsBannerTop}>
                                    <View style={styles.leadsBannerIconWrap}>
                                        <Ionicons
                                            name="funnel-outline"
                                            size={18}
                                            color={COLORS.primaryBright}
                                        />
                                    </View>

                                    <View style={styles.leadsBannerRight}>
                                        <View style={styles.leadsToggleRow}>
                                            <RangeTogglePill
                                                label="Semana"
                                                active={leadsRangeMode === "week"}
                                                onPress={() => setLeadsRangeMode("week")}
                                            />
                                            <RangeTogglePill
                                                label="Mes"
                                                active={leadsRangeMode === "month"}
                                                onPress={() => setLeadsRangeMode("month")}
                                            />
                                        </View>

                                        <View style={[styles.badge, styles.badgePrimarySoft]}>
                                            <Text
                                                style={[
                                                    styles.badgeText,
                                                    styles.badgeTextPrimarySoft,
                                                ]}
                                            >
                                                META LEADS
                                            </Text>
                                        </View>
                                    </View>
                                </View>

                                <View style={styles.leadsStatsRow}>
                                    <TinyStat
                                        icon="help-circle-outline"
                                        color={COLORS.info}
                                        value={visibleLeadStats.pendingReview}
                                        label="Revisión"
                                    />
                                    <TinyStat
                                        icon="document-text-outline"
                                        color={COLORS.warn}
                                        value={visibleLeadStats.incomplete}
                                        label="Incompletos"
                                    />
                                    <TinyStat
                                        icon="ban-outline"
                                        color={COLORS.bad}
                                        value={visibleLeadStats.notSuitable}
                                        label="No aptos"
                                    />
                                    <TinyStat
                                        icon="checkmark-done-outline"
                                        color={COLORS.ok}
                                        value={visibleLeadStats.verified}
                                        label="Verificados"
                                    />
                                </View>

                                <Text style={styles.quickSubMuted} numberOfLines={1}>
                                    {leadsRangeMode === "week" ? "Semana actual" : "Mes actual"} · Cola activa:{" "}
                                    {visibleLeadStats.activeQueue} · Total: {visibleLeadStats.total}
                                </Text>
                            </Pressable>
                        </ScrollView>

                        <View style={styles.bottomNavBar}>
                            {actions.map((a) => (
                                <BottomNavItem
                                    key={a.route}
                                    title={a.title}
                                    icon={a.icon}
                                    onPress={() => router.push({ pathname: a.route as any })}
                                    active={a.route === "/admin/leads" ? false : false}
                                />
                            ))}
                        </View>
                    </View>
                </View>
            </ImageBackground>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },

    bg: {
        flex: 1,
    },

    bgImage: {
        opacity: 0.46,
    },

    overlay: {
        flex: 1,
        backgroundColor: "rgba(3,10,20,0.54)",
        paddingHorizontal: 16,
    },

    screen: {
        flex: 1,
    },

    scrollContent: {
        paddingBottom: 106,
    },

    header: {
        paddingTop: 10,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },

    headerLeft: {
        flex: 1,
        gap: 3,
    },

    hTitle: {
        color: COLORS.text,
        fontSize: 24,
        fontWeight: "900",
        letterSpacing: 0.4,
    },

    hSub: {
        color: "#D7E2EE",
        fontSize: 13,
        fontWeight: "700",
    },

    hSubStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },

    pressed: {
        transform: [{ scale: 0.99 }],
        opacity: 0.96,
    },

    quickRow: {
        flexDirection: "row",
        gap: 12,
        marginTop: 6,
        marginBottom: 14,
    },

    quickCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
        gap: 7,
        overflow: "hidden",
    },

    quickTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },

    sectionIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 12,
        backgroundColor: "rgba(90,200,250,0.09)",
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.20)",
        alignItems: "center",
        justifyContent: "center",
    },

    badge: {
        paddingHorizontal: 10,
        height: 27,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },

    badgeText: {
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0.4,
    },

    badgeOk: {
        backgroundColor: "rgba(34,197,94,0.12)",
        borderColor: "rgba(34,197,94,0.34)",
    },

    badgeTextOk: {
        color: "#86EFAC",
    },

    badgePrimary: {
        backgroundColor: "rgba(124,58,237,0.16)",
        borderColor: "rgba(124,58,237,0.35)",
    },

    badgeTextPrimary: {
        color: "#D8B4FE",
    },

    badgePrimarySoft: {
        backgroundColor: "rgba(96,165,250,0.12)",
        borderColor: "rgba(96,165,250,0.28)",
    },

    badgeTextPrimarySoft: {
        color: "#BFDBFE",
    },

    quickTitle: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
        marginTop: 2,
    },

    quickMoney: {
        color: COLORS.text,
        fontSize: 17,
        fontWeight: "900",
        marginTop: 1,
    },

    tinyRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 5,
    },

    tinyStatWrap: {
        flex: 1,
        height: 34,
        borderRadius: 13,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 8,
    },

    tinyStatValue: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },

    quickSubMuted: {
        color: COLORS.softText,
        fontSize: 11,
        fontWeight: "800",
        opacity: 0.94,
        marginTop: 2,
    },

    leadsBanner: {
        backgroundColor: COLORS.card,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        gap: 10,
        marginBottom: 8,
        overflow: "hidden",
    },

    leadsBannerTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
    },

    leadsBannerRight: {
        flex: 1,
        alignItems: "flex-end",
        gap: 8,
    },

    leadsBannerIconWrap: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(10, 22, 40, 0.82)",
        borderWidth: 1,
        borderColor: COLORS.borderSoft,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: COLORS.primary,
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
        elevation: 2,
    },

    leadsToggleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },

    rangePill: {
        minHeight: 30,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.04)",
        alignItems: "center",
        justifyContent: "center",
    },

    rangePillActive: {
        backgroundColor: "rgba(90,200,250,0.14)",
        borderColor: "rgba(90,200,250,0.24)",
    },

    rangePillText: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "900",
    },

    rangePillTextActive: {
        color: COLORS.text,
    },

    leadsStatsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },

    bottomNavBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 10,
        height: 66,
        borderRadius: 20,
        backgroundColor: COLORS.navBg,
        borderWidth: 1,
        borderColor: COLORS.navBorder,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 8,
    },

    bottomNavItem: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingVertical: 6,
        borderRadius: 16,
    },

    bottomNavItemActive: {
        backgroundColor: "rgba(255,255,255,0.03)",
    },

    bottomNavIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 12,
        backgroundColor: COLORS.navItem,
        borderWidth: 1,
        borderColor: COLORS.borderSoft,
        alignItems: "center",
        justifyContent: "center",
    },

    bottomNavIconWrapActive: {
        backgroundColor: COLORS.navItemActive,
    },

    logoutBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: COLORS.logoutBg,
        borderWidth: 1,
        borderColor: COLORS.logoutBorder,
        alignItems: "center",
        justifyContent: "center",
    },

    bottomNavText: {
        color: COLORS.text,
        fontSize: 10,
        fontWeight: "800",
    },
});