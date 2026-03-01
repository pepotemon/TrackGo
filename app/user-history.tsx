import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../src/auth/useAuth";
import { dayKeyFromMs, subscribeDailyEventsByRangeForUser } from "../src/data/repositories/dailyEventsRepo";
import type { DailyEventDoc } from "../src/types/models";

/** yyyy-mm-dd local */
function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function mondayOfWeek(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const jsDay = x.getDay(); // 0=Dom..6=Sáb
    const diffToMonday = jsDay === 0 ? 6 : jsDay - 1;
    x.setDate(x.getDate() - diffToMonday);
    return x;
}

function weekRangeKeysFromMonday(monday: Date) {
    const start = new Date(monday);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { startKey: dayKeyFromDate(start), endKey: dayKeyFromDate(end) };
}

function addDaysKey(dateKey: string, deltaDays: number) {
    const [y, m, d] = dateKey.split("-").map((x) => parseInt(x, 10));
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    dt.setHours(0, 0, 0, 0);
    dt.setDate(dt.getDate() + deltaDays);
    return dayKeyFromDate(dt);
}

type WeekAgg = {
    weekStartKey: string;
    weekEndKey: string;
    visited: number;
    rejected: number;
    total: number;
};

export default function UserHistoryScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { firebaseUser, profile, loading } = useAuth();

    const params = useLocalSearchParams<{ startKey?: string; endKey?: string }>();
    const initialStartKey = (params?.startKey ?? "").toString();
    const initialEndKey = (params?.endKey ?? "").toString();

    const todayKey = useMemo(() => dayKeyFromMs(Date.now()), []);
    const fallbackWeek = useMemo(() => {
        const mon = mondayOfWeek(new Date());
        return weekRangeKeysFromMonday(mon);
    }, []);

    const [weekStartKey, setWeekStartKey] = useState<string>(initialStartKey || fallbackWeek.startKey);
    const [weekEndKey, setWeekEndKey] = useState<string>(initialEndKey || fallbackWeek.endKey);

    const [weekEvents, setWeekEvents] = useState<DailyEventDoc[]>([]);
    const [historyEvents, setHistoryEvents] = useState<DailyEventDoc[]>([]);
    const [err, setErr] = useState<string | null>(null);

    const HISTORY_DAYS = 365;

    const historyRange = useMemo(() => {
        const end = todayKey;
        const start = addDaysKey(todayKey, -HISTORY_DAYS);
        return { startKey: start, endKey: end };
    }, [todayKey]);

    useEffect(() => {
        if (loading) return;

        if (!firebaseUser) {
            router.replace({ pathname: "/login" as any });
            return;
        }
        if (!profile || !profile.active) {
            router.replace({ pathname: "/no-access" as any });
            return;
        }
        if (profile.role !== "user") {
            router.replace({ pathname: "/admin" as any });
            return;
        }
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active]);

    useEffect(() => {
        if (!firebaseUser?.uid) return;

        const unsub = subscribeDailyEventsByRangeForUser(
            weekStartKey,
            weekEndKey,
            firebaseUser.uid,
            (list) => {
                setErr(null);
                setWeekEvents(list ?? []);
            },
            (e) => setErr(`${e?.code ?? "error"}: ${e?.message ?? ""}`)
        );

        return () => unsub();
    }, [firebaseUser?.uid, weekStartKey, weekEndKey]);

    useEffect(() => {
        if (!firebaseUser?.uid) return;

        const unsub = subscribeDailyEventsByRangeForUser(
            historyRange.startKey,
            historyRange.endKey,
            firebaseUser.uid,
            (list) => {
                setErr(null);
                setHistoryEvents(list ?? []);
            },
            (e) => setErr(`${e?.code ?? "error"}: ${e?.message ?? ""}`)
        );

        return () => unsub();
    }, [firebaseUser?.uid, historyRange.startKey, historyRange.endKey]);

    const latestByClient = (events: DailyEventDoc[]) => {
        const last = new Map<string, DailyEventDoc>();
        for (const e of events) {
            if (e.type !== "visited" && e.type !== "rejected" && e.type !== "pending") continue;
            if (!e.clientId) continue;
            const prev = last.get(e.clientId);
            if (!prev || (e.createdAt ?? 0) > (prev.createdAt ?? 0)) last.set(e.clientId, e);
        }
        return last;
    };

    const weekSummary = useMemo(() => {
        const last = latestByClient(weekEvents);
        let visited = 0;
        let rejected = 0;
        for (const e of last.values()) {
            if (e.type === "visited") visited++;
            if (e.type === "rejected") rejected++;
        }
        return { visited, rejected, total: visited + rejected };
    }, [weekEvents]);

    const historySummary = useMemo(() => {
        const last = latestByClient(historyEvents);
        let visited = 0;
        let rejected = 0;
        for (const e of last.values()) {
            if (e.type === "visited") visited++;
            if (e.type === "rejected") rejected++;
        }
        return { visited, rejected, total: visited + rejected };
    }, [historyEvents]);

    const weeksAgg = useMemo(() => {
        const perWeekLastByClient = new Map<string, Map<string, DailyEventDoc>>();

        for (const e of historyEvents) {
            if (e.type !== "visited" && e.type !== "rejected") continue;
            if (!e.clientId) continue;

            const ts = (e.createdAt ?? 0) as number;
            if (!ts) continue;

            const mon = mondayOfWeek(new Date(ts));
            const wkStartKey = dayKeyFromDate(mon);

            if (!perWeekLastByClient.has(wkStartKey)) perWeekLastByClient.set(wkStartKey, new Map());
            const m = perWeekLastByClient.get(wkStartKey)!;

            const prev = m.get(e.clientId);
            if (!prev || (e.createdAt ?? 0) > (prev.createdAt ?? 0)) m.set(e.clientId, e);
        }

        const arr: WeekAgg[] = [];
        for (const [wkStartKey, map] of perWeekLastByClient.entries()) {
            let visited = 0;
            let rejected = 0;
            for (const e of map.values()) {
                if (e.type === "visited") visited++;
                if (e.type === "rejected") rejected++;
            }
            arr.push({
                weekStartKey: wkStartKey,
                weekEndKey: addDaysKey(wkStartKey, 6),
                visited,
                rejected,
                total: visited + rejected,
            });
        }

        arr.sort((a, b) => (a.weekStartKey < b.weekStartKey ? 1 : -1));
        return arr.slice(0, 12);
    }, [historyEvents]);

    const goPrevWeek = () => {
        setWeekStartKey(addDaysKey(weekStartKey, -7));
        setWeekEndKey(addDaysKey(weekEndKey, -7));
    };

    const goNextWeek = () => {
        setWeekStartKey(addDaysKey(weekStartKey, 7));
        setWeekEndKey(addDaysKey(weekEndKey, 7));
    };

    const StatPill = ({
        label,
        value,
        tone,
    }: {
        label: string;
        value: number;
        tone: "visited" | "rejected" | "neutral";
    }) => {
        const bg =
            tone === "visited"
                ? "rgba(34,197,94,0.10)"
                : tone === "rejected"
                    ? "rgba(248,113,113,0.10)"
                    : "rgba(255,255,255,0.06)";
        const border =
            tone === "visited"
                ? "rgba(34,197,94,0.30)"
                : tone === "rejected"
                    ? "rgba(248,113,113,0.30)"
                    : "rgba(255,255,255,0.10)";
        const tint = tone === "visited" ? COLORS.visited : tone === "rejected" ? COLORS.rejected : COLORS.text;

        return (
            <View style={[styles.statPill, { backgroundColor: bg, borderColor: border }]}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={[styles.statValue, { color: tint }]}>{value}</Text>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

            <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 8) }]}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
                    accessibilityLabel="Volver"
                >
                    <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                </Pressable>

                <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.hTitle}>Historial</Text>
                    <Text style={styles.hSub}>
                        Semana: <Text style={styles.hStrong}>{weekStartKey}</Text> → <Text style={styles.hStrong}>{weekEndKey}</Text>
                    </Text>
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                    <Pressable
                        onPress={goPrevWeek}
                        style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
                        accessibilityLabel="Semana anterior"
                    >
                        <Ionicons name="arrow-back-outline" size={18} color={COLORS.text} />
                    </Pressable>
                    <Pressable
                        onPress={goNextWeek}
                        style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
                        accessibilityLabel="Semana siguiente"
                    >
                        <Ionicons name="arrow-forward-outline" size={18} color={COLORS.text} />
                    </Pressable>
                </View>
            </View>

            {err ? (
                <View style={styles.errBox}>
                    <Ionicons name="alert-circle-outline" size={18} color={COLORS.rejected} />
                    <Text style={styles.errText}>{err}</Text>
                </View>
            ) : null}

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.card}>
                    <View style={styles.cardRow}>
                        <Text style={styles.cardTitle}>Resumen de la semana</Text>
                        <View style={styles.badgeSoft}>
                            <Ionicons name="calendar-outline" size={14} color={COLORS.muted} />
                            <Text style={styles.badgeSoftText}>Lun→Dom</Text>
                        </View>
                    </View>

                    <View style={styles.statsRow}>
                        <StatPill label="Visitados" value={weekSummary.visited} tone="visited" />
                        <StatPill label="Rechazados" value={weekSummary.rejected} tone="rejected" />
                        <StatPill label="Total" value={weekSummary.total} tone="neutral" />
                    </View>


                </View>

                <View style={styles.card}>
                    <View style={styles.cardRow}>
                        <Text style={styles.cardTitle}>Total histórico</Text>
                        <View style={styles.badgeSoft}>
                            <Ionicons name="time-outline" size={14} color={COLORS.muted} />
                            <Text style={styles.badgeSoftText}>Últimos {HISTORY_DAYS} días</Text>
                        </View>
                    </View>

                    <View style={styles.statsRow}>
                        <StatPill label="Visitados" value={historySummary.visited} tone="visited" />
                        <StatPill label="Rechazados" value={historySummary.rejected} tone="rejected" />
                        <StatPill label="Total" value={historySummary.total} tone="neutral" />
                    </View>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Semanas recientes</Text>

                    {!weeksAgg.length ? (
                        <View style={styles.empty}>
                            <Ionicons name="bar-chart-outline" size={22} color={COLORS.muted} />
                            <Text style={styles.emptyText}>No hay datos todavía en este rango.</Text>
                        </View>
                    ) : (
                        <View style={{ gap: 10 }}>
                            {weeksAgg.map((w) => (
                                <View key={w.weekStartKey} style={styles.weekRow}>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text style={styles.weekTitle}>
                                            {w.weekStartKey} → {w.weekEndKey}
                                        </Text>
                                        <Text style={styles.weekSub}>
                                            <Text style={{ color: COLORS.visited, fontWeight: "900" }}>{w.visited}</Text> visitados ·{" "}
                                            <Text style={{ color: COLORS.rejected, fontWeight: "900" }}>{w.rejected}</Text> rechazados
                                        </Text>
                                    </View>

                                    <View style={styles.weekTotalPill}>
                                        <Text style={styles.weekTotalText}>{w.total}</Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                <View style={{ height: 18 }} />
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
    visited: "#22C55E",
    rejected: "#F87171",
    pending: "#FBBF24",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    header: {
        paddingHorizontal: 16,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    headerBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    headerBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.95 },

    hTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
    hSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    hStrong: { color: COLORS.text, fontWeight: "900" },

    errBox: {
        marginHorizontal: 16,
        marginBottom: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.35)",
        backgroundColor: "rgba(248,113,113,0.10)",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    errText: { flex: 1, color: COLORS.text, fontWeight: "800", fontSize: 12 },

    content: { paddingHorizontal: 16, paddingBottom: 22, gap: 12 },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 12,
    },
    cardTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
    cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },

    badgeSoft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    badgeSoftText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },

    statsRow: { flexDirection: "row", gap: 10 },
    statPill: {
        flex: 1,
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderWidth: 1,
        gap: 6,
    },
    statLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    statValue: { color: COLORS.text, fontSize: 18, fontWeight: "900" },

    hint: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.9 },

    weekRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    weekTitle: { color: COLORS.text, fontWeight: "900", fontSize: 13 },
    weekSub: { color: COLORS.muted, fontWeight: "800", fontSize: 12 },

    weekTotalPill: {
        minWidth: 42,
        height: 34,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    weekTotalText: { color: COLORS.text, fontWeight: "900" },

    empty: { marginTop: 6, alignItems: "center", gap: 8, paddingVertical: 14 },
    emptyText: { color: COLORS.muted, fontWeight: "800" },
});