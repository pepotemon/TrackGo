// src/screens/admin/AdminHomeScreen.tsx
// ✅ FIX: el contador de rejected/visited (hoy y semana) ya NO se infla con:
// - eventos de clientes ELIMINADOS
// - eventos viejos de clientes REASIGNADOS / RESTAURADOS (porque ya no coinciden con el status actual del client)

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
    const diffToMonday = jsDay === 0 ? 6 : jsDay - 1; // lunes=0
    const start = new Date(d);
    start.setDate(d.getDate() - diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { startKey: dayKeyFromDate(start), endKey: dayKeyFromDate(end) };
}

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toMillis === "function") return v.toMillis();
    if (typeof v === "string") {
        const n = Number(v);
        return isFinite(n) ? n : 0;
    }
    return 0;
}

/**
 * Último evento por clientId dentro del rango.
 * (Luego filtramos por estado actual del client para evitar inflado)
 */
function latestEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();
    for (const e of events) {
        const cid = (e as any)?.clientId;
        if (!cid) continue;

        const prev = map.get(cid);
        const eMs = toMs((e as any)?.createdAt);
        const pMs = prev ? toMs((prev as any)?.createdAt) : 0;

        if (!prev || eMs >= pMs) map.set(cid, e);
    }
    return map;
}

function getRatePerVisit(u?: UserDoc | null) {
    const anyU: any = u as any;
    const n = anyU?.ratePerVisit ?? anyU?.visitFee ?? 0;
    return typeof n === "number" && isFinite(n) ? n : 0;
}

function isMetaLead(c: ClientDoc) {
    const source = String((c as any)?.source ?? "").trim().toLowerCase();
    return source === "whatsapp_meta";
}

function getDerivedLeadQueueStatus(c: ClientDoc): "verified" | "pending_review" | "incomplete" | "not_suitable" {
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

function getLeadQueueStats(clients: ClientDoc[]) {
    let verified = 0;
    let incomplete = 0;
    let notSuitable = 0;
    let pendingReview = 0;

    for (const c of clients) {
        if (!isMetaLead(c)) continue;

        const status = getDerivedLeadQueueStatus(c);
        if (status === "verified") verified += 1;
        else if (status === "pending_review") pendingReview += 1;
        else if (status === "not_suitable") notSuitable += 1;
        else incomplete += 1;
    }

    return {
        verified,
        incomplete,
        notSuitable,
        pendingReview,
        total: verified + incomplete + notSuitable + pendingReview,
        activeQueue: incomplete + notSuitable + pendingReview,
    };
}

export default function AdminHomeScreen() {
    const { profile, logout } = useAuth();
    const router = useRouter();

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [todayEvents, setTodayEvents] = useState<DailyEventDoc[]>([]);
    const [weekEvents, setWeekEvents] = useState<DailyEventDoc[]>([]);

    const [refreshing, setRefreshing] = useState(false);
    const [refreshTick, setRefreshTick] = useState(0);

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
                title: "Leads Meta",
                subtitle: "Por revisar, incompletos y no aptos",
                icon: "funnel-outline",
                route: "/admin/leads",
            },
            {
                title: "Contabilidad",
                subtitle: "Inversión semanal y ganancia real",
                icon: "stats-chart-outline",
                route: "/admin/accounting",
            },
        ],
        []
    );

    const reloadUsers = useCallback(async () => {
        const u = await listUsers("user");
        setUsers(u);
    }, []);

    useEffect(() => {
        reloadUsers();
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
        const { startKey, endKey } = weekRangeKeys(new Date());
        const unsub = subscribeDailyEventsByRange(
            startKey,
            endKey,
            (list) => setWeekEvents(list ?? []),
            (err) => console.log("[AdminHome] week events err:", err?.code, err?.message)
        );
        return () => unsub();
    }, [refreshTick]);

    const userById = useMemo(() => {
        const m = new Map<string, UserDoc>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);

    const clientById = useMemo(() => {
        const m = new Map<string, ClientDoc>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    const pendingNow = useMemo(() => {
        return clients.filter((c) => c.status === "pending").length;
    }, [clients]);

    const leadQueueStats = useMemo(() => getLeadQueueStats(clients), [clients]);

    const shouldCountEvent = useCallback(
        (e: DailyEventDoc) => {
            const cid = (e as any)?.clientId;
            if (!cid) return false;

            const c = clientById.get(cid);
            if (!c) return false;

            return c.status === e.type;
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
            const rate = getRatePerVisit(userById.get(uid));
            perUserAmount[uid] = cnt * rate;
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

        return { visited, rejected, amountTotal, topUid, topAmount };
    }, [todayEvents, userById, shouldCountEvent]);

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
            const rate = getRatePerVisit(userById.get(uid));
            perUserAmount[uid] = cnt * rate;
        }

        const amountTotal = Object.values(perUserAmount).reduce((a, b) => a + b, 0);
        return { visited, rejected, amountTotal };
    }, [weekEvents, userById, shouldCountEvent]);

    const topUserLabel = useMemo(() => {
        if (!todayStats.topUid) return "—";
        const u = userById.get(todayStats.topUid);
        const name = u?.name?.trim() || "Usuario";
        return `${name} · R$ ${todayStats.topAmount.toFixed(2)}`;
    }, [todayStats.topUid, todayStats.topAmount, userById]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await reloadUsers();
            setRefreshTick((t) => t + 1);
        } finally {
            setRefreshing(false);
        }
    }, [reloadUsers]);

    const TinyStat = ({
        icon,
        color,
        value,
        label,
    }: {
        icon: any;
        color: string;
        value: number;
        label: string;
    }) => (
        <View style={styles.tinyStatWrap} accessibilityLabel={`${label}: ${value}`}>
            <Ionicons name={icon} size={14} color={color} />
            <Text style={styles.tinyStatValue}>{value}</Text>
        </View>
    );

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
                        >
                            <View style={styles.header}>
                                <View style={styles.headerLeft}>
                                    <Text style={styles.hTitle}>Admin</Text>
                                    <Text style={styles.hSub} numberOfLines={1}>
                                        Hola, <Text style={styles.hSubStrong}>{profile?.name ?? "—"}</Text>
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.topToolbar}>
                                {actions.map((a) => (
                                    <Pressable
                                        key={a.route}
                                        onPress={() => router.push({ pathname: a.route as any })}
                                        style={({ pressed }) => [styles.topToolBtn, pressed && styles.pressed]}
                                    >
                                        <View style={styles.topToolIconWrap}>
                                            <Ionicons name={a.icon} size={18} color={COLORS.text} />
                                        </View>
                                        <Text style={styles.topToolText} numberOfLines={1}>
                                            {a.title}
                                        </Text>
                                    </Pressable>
                                ))}

                                <Pressable
                                    onPress={logout}
                                    style={({ pressed }) => [styles.topToolBtn, pressed && styles.pressed]}
                                >
                                    <View style={[styles.topToolIconWrap, styles.topToolLogout]}>
                                        <Ionicons name="log-out-outline" size={18} color={COLORS.text} />
                                    </View>
                                    <Text style={styles.topToolText} numberOfLines={1}>
                                        Salir
                                    </Text>
                                </Pressable>
                            </View>

                            <View style={styles.quickRow}>
                                <Pressable
                                    onPress={() => router.push({ pathname: "/admin/report" as any })}
                                    style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}
                                >
                                    <View style={styles.quickTop}>
                                        <Ionicons name="cash-outline" size={18} color={COLORS.text} />
                                        <View style={[styles.badge, styles.badgeOk]}>
                                            <Text style={[styles.badgeText, styles.badgeTextOk]}>HOY</Text>
                                        </View>
                                    </View>

                                    <Text style={styles.quickTitle}>Cobranza de hoy</Text>
                                    <Text style={styles.quickMoney} numberOfLines={1}>
                                        R$ {todayStats.amountTotal.toFixed(2)}
                                    </Text>

                                    <View style={styles.tinyRow}>
                                        <TinyStat icon="checkmark-circle-outline" color={COLORS.ok} value={todayStats.visited} label="Visitados" />
                                        <TinyStat icon="close-circle-outline" color={COLORS.bad} value={todayStats.rejected} label="Rechazados" />
                                        <TinyStat icon="time-outline" color={COLORS.warn} value={pendingNow} label="Pendientes" />
                                    </View>

                                    <Text style={styles.quickSubMuted} numberOfLines={1}>
                                        Top: {topUserLabel}
                                    </Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => router.push({ pathname: "/admin/history" as any })}
                                    style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}
                                >
                                    <View style={styles.quickTop}>
                                        <Ionicons name="calendar-outline" size={18} color={COLORS.text} />
                                        <View style={[styles.badge, styles.badgePrimary]}>
                                            <Text style={[styles.badgeText, styles.badgeTextPrimary]}>SEMANA</Text>
                                        </View>
                                    </View>

                                    <Text style={styles.quickTitle}>Cierre semanal</Text>
                                    <Text style={styles.quickMoney} numberOfLines={1}>
                                        R$ {weekStats.amountTotal.toFixed(2)}
                                    </Text>

                                    <View style={styles.tinyRow}>
                                        <TinyStat icon="checkmark-circle-outline" color={COLORS.ok} value={weekStats.visited} label="Visitados" />
                                        <TinyStat icon="close-circle-outline" color={COLORS.bad} value={weekStats.rejected} label="Rechazados" />
                                        <TinyStat icon="time-outline" color={COLORS.warn} value={pendingNow} label="Pendientes" />
                                    </View>

                                    <Text style={styles.quickSubMuted} numberOfLines={1}>
                                        Lunes → Domingo
                                    </Text>
                                </Pressable>
                            </View>

                            <Pressable
                                onPress={() => router.push({ pathname: "/admin/leads" as any })}
                                style={({ pressed }) => [styles.leadsBanner, pressed && styles.pressed]}
                            >
                                <View style={styles.leadsBannerTop}>
                                    <View style={styles.leadsBannerIconWrap}>
                                        <Ionicons name="funnel-outline" size={18} color={COLORS.text} />
                                    </View>

                                    <View style={[styles.badge, styles.badgePrimarySoft]}>
                                        <Text style={[styles.badgeText, styles.badgeTextPrimarySoft]}>META LEADS</Text>
                                    </View>
                                </View>

                                <View style={styles.leadsStatsRow}>
                                    <TinyStat icon="help-circle-outline" color={COLORS.info} value={leadQueueStats.pendingReview} label="Revisión" />
                                    <TinyStat icon="document-text-outline" color={COLORS.warn} value={leadQueueStats.incomplete} label="Incompletos" />
                                    <TinyStat icon="close-circle-outline" color={COLORS.bad} value={leadQueueStats.notSuitable} label="No aptos" />
                                    <TinyStat icon="checkmark-done-outline" color={COLORS.ok} value={leadQueueStats.verified} label="Verificados" />
                                </View>

                                <Text style={styles.quickSubMuted} numberOfLines={1}>
                                    Cola activa: {leadQueueStats.activeQueue} · Total Meta: {leadQueueStats.total}
                                </Text>
                            </Pressable>
                        </ScrollView>

                        <View pointerEvents="none" style={styles.bottomFadeMask} />

                        <View style={styles.bottomInfoBar}>
                            <Text style={styles.bottomInfoText}>© {new Date().getFullYear()} TrackGo Admin</Text>
                        </View>
                    </View>
                </View>
            </ImageBackground>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "rgba(17, 24, 39, 0.72)",
    border: "rgba(255,255,255,0.08)",
    text: "#F9FAFB",
    muted: "#9CA3AF",

    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",
    info: "#60A5FA",

    primarySoft: "#C4B5FD",
};

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },

    bg: {
        flex: 1,
    },

    bgImage: {
        opacity: 0.55,
    },

    overlay: {
        flex: 1,
        backgroundColor: "rgba(11,18,32,0.40)",
        paddingHorizontal: 16,
    },

    screen: {
        flex: 1,
    },

    scrollContent: {
        paddingBottom: 110,
    },

    header: {
        paddingTop: 10,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerLeft: { flex: 1, gap: 3 },
    hTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.5 },
    hSub: { color: "#D1D5DB", fontSize: 13, fontWeight: "700" },
    hSubStrong: { color: COLORS.text, fontWeight: "900" },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    topToolbar: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 60,
        top: 20
    },
    topToolBtn: {
        width: "10.4%",
        minWidth: 62,
        alignItems: "center",
        gap: 6,
    },
    topToolIconWrap: {
        width: 46,
        height: 46,
        borderRadius: 16,
        backgroundColor: "rgba(15, 23, 42, 0.72)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    topToolLogout: {
        backgroundColor: "rgba(127, 29, 29, 0.28)",
        borderColor: "rgba(248,113,113,0.18)",
    },
    topToolText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "800",
        textAlign: "center",
    },

    quickRow: { flexDirection: "row", gap: 12, marginTop: 2, marginBottom: 14 },
    quickCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
        gap: 6,
        overflow: "hidden",
    },

    quickTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

    badge: {
        paddingHorizontal: 8,
        height: 24,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    badgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.4 },
    badgeOk: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)" },
    badgeTextOk: { color: "#86EFAC" },
    badgePrimary: { backgroundColor: "rgba(124,58,237,0.16)", borderColor: "rgba(124,58,237,0.35)" },
    badgeTextPrimary: { color: COLORS.primarySoft },
    badgePrimarySoft: { backgroundColor: "rgba(96,165,250,0.12)", borderColor: "rgba(96,165,250,0.28)" },
    badgeTextPrimarySoft: { color: "#BFDBFE" },

    quickTitle: { color: COLORS.text, fontSize: 13, fontWeight: "900", marginTop: 2 },
    quickMoney: { color: COLORS.text, fontSize: 16, fontWeight: "900", marginTop: 1 },

    tinyRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 4,
    },
    tinyStatWrap: {
        flex: 1,
        height: 30,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 8,
    },
    tinyStatValue: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

    quickSubMuted: { color: "#CBD5E1", fontSize: 11, fontWeight: "800", opacity: 0.9, marginTop: 2 },

    leadsBanner: {
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        gap: 10,
        marginBottom: 14,
    },
    leadsBannerTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    leadsBannerIconWrap: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(15, 23, 42, 0.72)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    leadsStatsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },

    bottomFadeMask: {
        position: "absolute",
        left: -16,
        right: -16,
        bottom: 0,
        height: 55,
        backgroundColor: "rgba(11,18,32,0.97)",
    },

    bottomInfoBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 10,
        height: 46,
        borderRadius: 14,
        backgroundColor: "rgba(15, 23, 42, 0.82)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
    },

    bottomInfoText: {
        color: "#CBD5E1",
        fontSize: 12,
        fontWeight: "800",
    },
});