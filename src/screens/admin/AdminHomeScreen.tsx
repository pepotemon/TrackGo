// app/admin/index.tsx (o donde tengas este Home)
// ✅ FIX: el contador de rejected/visited (hoy y semana) ya NO se infla con:
// - eventos de clientes ELIMINADOS
// - eventos viejos de clientes REASIGNADOS / RESTAURADOS (porque ya no coinciden con el status actual del client)

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../auth/useAuth";
import { subscribeAdminClients } from "../../data/repositories/clientsRepo";
import { subscribeDailyEventsByRange } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, DailyEventDoc, UserDoc } from "../../types/models";

type AdminAction = {
    title: string;
    subtitle: string;
    icon: any;
    route: "/admin/users" | "/admin/clients" | "/admin/accounting";
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

    // ✅ Clientes realtime (estado actual)
    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);





    // ✅ Events realtime HOY
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

    // ✅ Events realtime SEMANA
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

    // ✅ Pendientes reales (estado actual en clients)
    const pendingNow = useMemo(() => {
        return clients.filter((c) => c.status === "pending").length;
    }, [clients]);

    /**
     * ✅ FILTRO ANTI-INFLADO
     * Solo contamos el evento si:
     * 1) el cliente todavía existe (no fue eliminado)
     * 2) el estado actual del cliente COINCIDE con el type del evento más reciente dentro del rango
     */
    const shouldCountEvent = useCallback(
        (e: DailyEventDoc) => {
            const cid = (e as any)?.clientId;
            if (!cid) return false;

            const c = clientById.get(cid);
            if (!c) return false; // eliminado

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
            setRefreshTick((t) => t + 1); // resuscribe events
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

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.hTitle}>Admin</Text>
                        <Text style={styles.hSub} numberOfLines={1}>
                            Hola, <Text style={styles.hSubStrong}>{profile?.name ?? "—"}</Text>
                        </Text>
                    </View>

                    <Pressable onPress={logout} style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}>
                        <Ionicons name="log-out-outline" size={18} color={COLORS.text} />
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

                <View style={styles.list}>
                    {actions.map((a) => (
                        <Pressable
                            key={a.route}
                            onPress={() => router.push({ pathname: a.route as any })}
                            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
                        >
                            <View style={styles.itemLeft}>
                                <View style={styles.itemIconWrap}>
                                    <Ionicons name={a.icon} size={20} color={COLORS.text} />
                                </View>

                                <View style={styles.itemTextWrap}>
                                    <Text style={styles.itemTitle}>{a.title}</Text>
                                    <Text style={styles.itemSub} numberOfLines={1}>
                                        {a.subtitle}
                                    </Text>
                                </View>
                            </View>

                            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                        </Pressable>
                    ))}
                </View>

                <Text style={styles.footer}>© {new Date().getFullYear()} TrackGo Admin</Text>
            </ScrollView>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",

    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",

    primarySoft: "#C4B5FD",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg, paddingHorizontal: 16 },
    scrollContent: { paddingBottom: 18 },

    header: {
        paddingTop: 10,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerLeft: { flex: 1, gap: 3 },
    hTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.5 },
    hSub: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },
    hSubStrong: { color: COLORS.text, fontWeight: "900" },

    logoutBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    quickRow: { flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 14 },
    quickCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
        gap: 6,
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
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 8,
    },
    tinyStatValue: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

    quickSubMuted: { color: COLORS.muted, fontSize: 11, fontWeight: "800", opacity: 0.85, marginTop: 2 },

    list: { gap: 12 },

    item: {
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        paddingVertical: 14,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    itemLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
    itemIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 16,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    itemTextWrap: { flex: 1, gap: 2 },
    itemTitle: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    itemSub: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },

    footer: {
        marginTop: 16,
        marginBottom: 10,
        textAlign: "center",
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        opacity: 0.9,
    },
});