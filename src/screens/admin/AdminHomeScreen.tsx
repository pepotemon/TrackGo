import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../auth/useAuth";
import { subscribeDailyEventsByRange } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { DailyEventDoc, UserDoc } from "../../types/models";

type AdminAction = {
    title: string;
    subtitle: string;
    icon: any;
    route: "/admin/users" | "/admin/clients";
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

// Semana Lunes → Domingo (común para “cierre semanal”)
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

/**
 * De-dup “por cliente”: si un cliente cambia 5 veces en el rango,
 * solo cuenta el ÚLTIMO evento de ese cliente.
 */
function latestEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();
    for (const e of events) {
        const prev = map.get(e.clientId);
        if (!prev || (e.createdAt ?? 0) > (prev.createdAt ?? 0)) map.set(e.clientId, e);
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
    const insets = useSafeAreaInsets();

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [todayEvents, setTodayEvents] = useState<DailyEventDoc[]>([]);
    const [weekEvents, setWeekEvents] = useState<DailyEventDoc[]>([]);

    const { startKey: weekStartKey, endKey: weekEndKey } = useMemo(
        () => weekRangeKeys(new Date()),
        []
    );

    // ✅ SOLO dejamos Users y Clients abajo
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
        ],
        []
    );

    // users (para tarifas)
    useEffect(() => {
        (async () => {
            const u = await listUsers("user");
            setUsers(u);
        })();
    }, []);

    // Realtime “hoy”
    useEffect(() => {
        const tk = todayKey();
        const unsub = subscribeDailyEventsByRange(tk, tk, setTodayEvents, (err) => {
            console.log("[AdminHome] today events err:", err?.code, err?.message);
        });
        return () => unsub();
    }, []);

    // Realtime “semana”
    useEffect(() => {
        const unsub = subscribeDailyEventsByRange(weekStartKey, weekEndKey, setWeekEvents, (err) => {
            console.log("[AdminHome] week events err:", err?.code, err?.message);
        });
        return () => unsub();
    }, [weekStartKey, weekEndKey]);

    const userById = useMemo(() => {
        const m = new Map<string, UserDoc>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);

    // ---- HOY (dedup por cliente)
    const todayStats = useMemo(() => {
        const latest = latestEventByClient(todayEvents);

        let visited = 0;
        let rejected = 0;
        let pending = 0;

        const perUserVisits: Record<string, number> = {};
        const perUserAmount: Record<string, number> = {};

        for (const e of latest.values()) {
            if (e.type === "visited") {
                visited += 1;
                perUserVisits[e.userId] = (perUserVisits[e.userId] ?? 0) + 1;
            } else if (e.type === "rejected") rejected += 1;
            else if (e.type === "pending") pending += 1;
        }

        // dinero por usuario (solo visited)
        for (const [uid, cnt] of Object.entries(perUserVisits)) {
            const rate = getRatePerVisit(userById.get(uid));
            perUserAmount[uid] = cnt * rate;
        }

        const amountTotal = Object.values(perUserAmount).reduce((a, b) => a + b, 0);

        // top user
        let topUid: string | null = null;
        let topAmount = 0;
        for (const [uid, amt] of Object.entries(perUserAmount)) {
            if (amt > topAmount) {
                topAmount = amt;
                topUid = uid;
            }
        }

        return { visited, rejected, pending, amountTotal, topUid, topAmount };
    }, [todayEvents, userById]);

    // ---- SEMANA (dedup por cliente)
    const weekStats = useMemo(() => {
        const latest = latestEventByClient(weekEvents);

        let visited = 0;
        let rejected = 0;
        let pending = 0;

        const perUserVisits: Record<string, number> = {};
        const perUserAmount: Record<string, number> = {};

        for (const e of latest.values()) {
            if (e.type === "visited") {
                visited += 1;
                perUserVisits[e.userId] = (perUserVisits[e.userId] ?? 0) + 1;
            } else if (e.type === "rejected") rejected += 1;
            else if (e.type === "pending") pending += 1;
        }

        for (const [uid, cnt] of Object.entries(perUserVisits)) {
            const rate = getRatePerVisit(userById.get(uid));
            perUserAmount[uid] = cnt * rate;
        }

        const amountTotal = Object.values(perUserAmount).reduce((a, b) => a + b, 0);

        return { visited, rejected, pending, amountTotal };
    }, [weekEvents, userById]);

    const topUserLabel = useMemo(() => {
        if (!todayStats.topUid) return "—";
        const u = userById.get(todayStats.topUid);
        const name = u?.name?.trim() || "Usuario";
        return `${name} · R$ ${todayStats.topAmount.toFixed(2)}`;
    }, [todayStats.topUid, todayStats.topAmount, userById]);

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 8) }]}>
                <View style={styles.headerLeft}>
                    <Text style={styles.hTitle}>Admin</Text>
                    <Text style={styles.hSub}>
                        Hola, <Text style={styles.hSubStrong}>{profile?.name ?? "—"}</Text>
                    </Text>
                </View>

                <Pressable
                    onPress={logout}
                    style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutBtnPressed]}
                    accessibilityLabel="Cerrar sesión"
                >
                    <Ionicons name="log-out-outline" size={18} color={COLORS.text} />
                </Pressable>
            </View>

            {/* Quick cards (monetización) */}
            <View style={styles.quickRow}>
                {/* HOY */}
                <Pressable
                    onPress={() => router.push({ pathname: "/admin/report" as any })}
                    style={({ pressed }) => [styles.quickCard, pressed && styles.quickCardPressed]}
                >
                    <View style={styles.quickTop}>
                        <Ionicons name="cash-outline" size={18} color={COLORS.text} />
                        <View style={styles.badge}>
                            <Text style={styles.badgeText}>HOY</Text>
                        </View>
                    </View>

                    <Text style={styles.quickTitle}>Cobranza de hoy</Text>
                    <Text style={styles.quickMoney}>R$ {todayStats.amountTotal.toFixed(2)}</Text>

                    <Text style={styles.quickSub}>
                        Visitados {todayStats.visited} · Rechazados {todayStats.rejected} · Pend {todayStats.pending}
                    </Text>

                    <Text style={styles.quickSubMuted}>Top: {topUserLabel}</Text>
                </Pressable>

                {/* SEMANA */}
                <Pressable
                    onPress={() => router.push({ pathname: "/admin/history" as any })}
                    style={({ pressed }) => [styles.quickCard, pressed && styles.quickCardPressed]}
                >
                    <View style={styles.quickTop}>
                        <Ionicons name="calendar-outline" size={18} color={COLORS.text} />
                        <View
                            style={[
                                styles.badge,
                                { backgroundColor: "rgba(124,58,237,0.16)", borderColor: "rgba(124,58,237,0.35)" },
                            ]}
                        >
                            <Text style={[styles.badgeText, { color: "#C4B5FD" }]}>SEMANA</Text>
                        </View>
                    </View>

                    <Text style={styles.quickTitle}>Cierre semanal</Text>
                    <Text style={styles.quickMoney}>R$ {weekStats.amountTotal.toFixed(2)}</Text>

                    <Text style={styles.quickSub}>
                        {weekStartKey} → {weekEndKey}
                    </Text>

                    <Text style={styles.quickSubMuted}>
                        Visitados {weekStats.visited} · Rech {weekStats.rejected} · Pend {weekStats.pending}
                    </Text>
                </Pressable>
            </View>

            {/* Actions (SIN historial/resumen abajo) */}
            <View style={styles.list}>
                {actions.map((a) => (
                    <Pressable
                        key={a.route}
                        onPress={() => router.push({ pathname: a.route as any })}
                        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                    >
                        <View style={styles.itemLeft}>
                            <View style={styles.itemIconWrap}>
                                <Ionicons name={a.icon} size={20} color={COLORS.text} />
                            </View>

                            <View style={styles.itemTextWrap}>
                                <Text style={styles.itemTitle}>{a.title}</Text>
                                <Text style={styles.itemSub}>{a.subtitle}</Text>
                            </View>
                        </View>

                        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                    </Pressable>
                ))}
            </View>

            <Text style={styles.footer}>© {new Date().getFullYear()} TrackGo Admin</Text>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
};

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
        paddingHorizontal: 16,
    },

    header: {
        paddingBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerLeft: { flex: 1, gap: 3 },
    hTitle: {
        color: COLORS.text,
        fontSize: 22,
        fontWeight: "900",
        letterSpacing: 0.5,
    },
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
    logoutBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.95 },

    quickRow: {
        flexDirection: "row",
        gap: 12,
        marginTop: 8,
        marginBottom: 14,
    },
    quickCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        gap: 6,
    },
    quickCardPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    quickTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    badge: {
        paddingHorizontal: 10,
        height: 26,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.35)",
    },
    badgeText: {
        fontSize: 11,
        fontWeight: "900",
        color: "#86EFAC",
        letterSpacing: 0.4,
    },

    quickTitle: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
        marginTop: 2,
    },
    quickMoney: {
        color: COLORS.text,
        fontSize: 18,
        fontWeight: "900",
        marginTop: 2,
    },
    quickSub: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        marginTop: 2,
    },
    quickSubMuted: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        opacity: 0.85,
        marginTop: 2,
    },

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
    itemPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
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