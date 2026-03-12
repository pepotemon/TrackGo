import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ImageBackground,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import bgMap from "../assets/bg-map.png";
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
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active, firebaseUser, profile, router]);

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

    const StatBox = ({
        tone,
        icon,
        label,
        value,
    }: {
        tone: "ok" | "bad" | "neutral";
        icon: any;
        label: string;
        value: number;
    }) => (
        <View
            style={[
                styles.statBox,
                tone === "ok" && styles.statBoxOk,
                tone === "bad" && styles.statBoxBad,
                tone === "neutral" && styles.statBoxNeutral,
            ]}
        >
            <View style={styles.statBoxTop}>
                <Ionicons
                    name={icon}
                    size={15}
                    color={tone === "ok" ? COLORS.ok : tone === "bad" ? COLORS.bad : COLORS.text}
                />
                <Text style={styles.statBoxLabel}>{label}</Text>
            </View>
            <Text style={styles.statBoxValue}>{value}</Text>
        </View>
    );

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

            <ImageBackground
                source={bgMap}
                style={styles.bg}
                imageStyle={styles.bgImage}
                resizeMode="cover"
            >
                <View style={styles.overlay}>
                    <View style={[styles.header, { paddingTop: 12 }]}>
                        <View style={styles.headerTextWrap}>
                            <Text style={styles.hTitle}>Historial de actividad</Text>
                        </View>
                    </View>

                    <View style={styles.weekNavCard}>
                        <View style={styles.weekNavTop}>
                            <View style={styles.weekNavIconWrap}>
                                <Ionicons name="calendar-outline" size={16} color={COLORS.text} />
                            </View>

                            <View style={styles.weekNavTextWrap}>
                                <Text style={styles.weekNavTitle}>Semana consultada</Text>
                                <Text style={styles.weekNavSub} numberOfLines={1}>
                                    {weekStartKey} → {weekEndKey}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.weekNavActions}>
                            <Pressable
                                onPress={goPrevWeek}
                                style={({ pressed }) => [styles.weekNavBtn, pressed && styles.pressed]}
                                accessibilityLabel="Semana anterior"
                            >
                                <Ionicons name="chevron-back" size={16} color={COLORS.text} />
                                <Text style={styles.weekNavBtnText}>Anterior</Text>
                            </Pressable>

                            <Pressable
                                onPress={goNextWeek}
                                style={({ pressed }) => [styles.weekNavBtn, pressed && styles.pressed]}
                                accessibilityLabel="Semana siguiente"
                            >
                                <Text style={styles.weekNavBtnText}>Siguiente</Text>
                                <Ionicons name="chevron-forward" size={16} color={COLORS.text} />
                            </Pressable>
                        </View>
                    </View>

                    {err ? (
                        <View style={styles.errBox}>
                            <Ionicons name="alert-circle-outline" size={18} color={COLORS.bad} />
                            <Text style={styles.errText}>{err}</Text>
                        </View>
                    ) : null}

                    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                        <View style={styles.heroCard}>
                            <View style={styles.heroCardTop}>
                                <View style={styles.heroIconWrap}>
                                    <Ionicons name="bar-chart-outline" size={18} color={COLORS.text} />
                                </View>

                                <View style={styles.heroBadge}>
                                    <Text style={styles.heroBadgeText}>RESUMEN SEMANAL</Text>
                                </View>
                            </View>

                            <Text style={styles.heroMainValue}>{weekSummary.total}</Text>
                            <Text style={styles.heroMainLabel}>movimientos registrados</Text>

                            <View style={styles.heroStatsRow}>
                                <StatBox
                                    tone="ok"
                                    icon="checkmark-circle-outline"
                                    label="Visitados"
                                    value={weekSummary.visited}
                                />
                                <StatBox
                                    tone="bad"
                                    icon="close-circle-outline"
                                    label="Rechazados"
                                    value={weekSummary.rejected}
                                />
                            </View>
                        </View>

                        <View style={styles.historyCard}>
                            <View style={styles.historyCardTop}>
                                <View>
                                    <Text style={styles.cardTitle}>Histórico general</Text>
                                    <Text style={styles.cardSub}>Últimos {HISTORY_DAYS} días</Text>
                                </View>

                                <View style={styles.softBadge}>
                                    <Ionicons name="time-outline" size={14} color={COLORS.muted} />
                                    <Text style={styles.softBadgeText}>Acumulado</Text>
                                </View>
                            </View>

                            <View style={styles.historyBigRow}>
                                <View style={styles.historyBigValueWrap}>
                                    <Text style={styles.historyBigValue}>{historySummary.total}</Text>
                                    <Text style={styles.historyBigLabel}>total histórico</Text>
                                </View>

                                <View style={styles.historySideStats}>
                                    <View style={styles.historyMiniLine}>
                                        <Ionicons name="checkmark-circle-outline" size={15} color={COLORS.ok} />
                                        <Text style={styles.historyMiniLabel}>Visitados</Text>
                                        <Text style={styles.historyMiniValue}>{historySummary.visited}</Text>
                                    </View>

                                    <View style={styles.historyMiniLine}>
                                        <Ionicons name="close-circle-outline" size={15} color={COLORS.bad} />
                                        <Text style={styles.historyMiniLabel}>Rechazados</Text>
                                        <Text style={styles.historyMiniValue}>{historySummary.rejected}</Text>
                                    </View>
                                </View>
                            </View>
                        </View>

                        <View style={styles.card}>
                            <View style={styles.cardTopRow}>
                                <View>
                                    <Text style={styles.cardTitle}>Semanas recientes</Text>
                                    <Text style={styles.cardSub}>Vista rápida de desempeño</Text>
                                </View>

                                <View style={styles.softBadge}>
                                    <Ionicons name="layers-outline" size={14} color={COLORS.muted} />
                                    <Text style={styles.softBadgeText}>12 semanas</Text>
                                </View>
                            </View>

                            {!weeksAgg.length ? (
                                <View style={styles.empty}>
                                    <Ionicons name="bar-chart-outline" size={22} color={COLORS.muted} />
                                    <Text style={styles.emptyText}>No hay datos todavía en este rango.</Text>
                                </View>
                            ) : (
                                <View style={styles.timelineList}>
                                    {weeksAgg.map((w, index) => (
                                        <View key={w.weekStartKey} style={styles.timelineRow}>
                                            <View style={styles.timelineRail}>
                                                <View style={styles.timelineDot} />
                                                {index !== weeksAgg.length - 1 ? <View style={styles.timelineLine} /> : null}
                                            </View>

                                            <View style={styles.timelineCard}>
                                                <View style={styles.timelineCardTop}>
                                                    <Text style={styles.timelineTitle}>
                                                        {w.weekStartKey} → {w.weekEndKey}
                                                    </Text>

                                                    <View style={styles.weekTotalPill}>
                                                        <Text style={styles.weekTotalText}>{w.total}</Text>
                                                    </View>
                                                </View>

                                                <View style={styles.timelineMetricsRow}>
                                                    <View style={styles.timelineMetricPill}>
                                                        <Ionicons name="checkmark-circle-outline" size={14} color={COLORS.ok} />
                                                        <Text style={styles.timelineMetricText}>{w.visited} visitados</Text>
                                                    </View>

                                                    <View style={styles.timelineMetricPill}>
                                                        <Ionicons name="close-circle-outline" size={14} color={COLORS.bad} />
                                                        <Text style={styles.timelineMetricText}>{w.rejected} rechazados</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            )}
                        </View>

                        <View style={{ height: 20 }} />
                    </ScrollView>


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

    pressed: {
        transform: [{ scale: 0.98 }],
        opacity: 0.96,
    },

    header: {
        paddingBottom: 10,
    },
    headerTextWrap: {
        gap: 4,
    },
    hTitle: {
        color: COLORS.text,
        fontSize: 24,
        fontWeight: "900",
        textAlign: "center",
    },
    hSub: {
        color: "#CBD5E1",
        fontSize: 12,
        fontWeight: "800",
    },

    weekNavCard: {
        marginBottom: 10,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "rgba(15, 23, 42, 0.78)",
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 10,
    },
    weekNavTop: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    weekNavIconWrap: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        alignItems: "center",
        justifyContent: "center",
    },
    weekNavTextWrap: {
        flex: 1,
        gap: 2,
    },
    weekNavTitle: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    weekNavSub: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },
    weekNavActions: {
        flexDirection: "row",
        gap: 8,
    },
    weekNavBtn: {
        flex: 1,
        height: 38,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 8,
    },
    weekNavBtnText: {
        color: COLORS.text,
        fontSize: 12,
        fontWeight: "900",
    },

    errBox: {
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
    errText: {
        flex: 1,
        color: COLORS.text,
        fontWeight: "800",
        fontSize: 12,
    },

    content: {
        paddingBottom: 24,
        gap: 14,
    },

    heroCard: {
        borderRadius: 22,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "rgba(17, 24, 39, 0.78)",
        padding: 14,
        gap: 14,
        overflow: "hidden",
    },
    heroCardTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    heroIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 16,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        alignItems: "center",
        justifyContent: "center",
    },
    heroBadge: {
        paddingHorizontal: 10,
        height: 26,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        backgroundColor: "rgba(96,165,250,0.12)",
        borderColor: "rgba(96,165,250,0.28)",
    },
    heroBadgeText: {
        color: "#BFDBFE",
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0.4,
    },
    heroMainValue: {
        color: COLORS.text,
        fontSize: 40,
        fontWeight: "900",
        lineHeight: 44,
    },
    heroMainLabel: {
        color: "#CBD5E1",
        fontSize: 13,
        fontWeight: "800",
        marginTop: -8,
    },
    heroStatsRow: {
        flexDirection: "row",
        gap: 10,
    },

    statBox: {
        flex: 1,
        minHeight: 78,
        borderRadius: 16,
        borderWidth: 1,
        padding: 12,
        justifyContent: "space-between",
    },
    statBoxOk: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.22)",
    },
    statBoxBad: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.22)",
    },
    statBoxNeutral: {
        backgroundColor: "rgba(255,255,255,0.05)",
        borderColor: "rgba(255,255,255,0.10)",
    },
    statBoxTop: {
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    statBoxLabel: {
        color: COLORS.text,
        fontSize: 12,
        fontWeight: "800",
    },
    statBoxValue: {
        color: COLORS.text,
        fontSize: 20,
        fontWeight: "900",
    },

    historyCard: {
        borderRadius: 22,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.card,
        padding: 14,
        gap: 14,
    },
    historyCardTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    historyBigRow: {
        flexDirection: "row",
        gap: 12,
        alignItems: "stretch",
    },
    historyBigValueWrap: {
        flex: 1,
        minHeight: 124,
        borderRadius: 18,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
    },
    historyBigValue: {
        color: COLORS.text,
        fontSize: 34,
        fontWeight: "900",
        lineHeight: 38,
    },
    historyBigLabel: {
        color: "#CBD5E1",
        fontSize: 12,
        fontWeight: "800",
        marginTop: 4,
        textAlign: "center",
    },
    historySideStats: {
        flex: 1,
        gap: 10,
        justifyContent: "center",
    },
    historyMiniLine: {
        minHeight: 57,
        borderRadius: 16,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
    },
    historyMiniLabel: {
        flex: 1,
        color: "#CBD5E1",
        fontSize: 12,
        fontWeight: "800",
    },
    historyMiniValue: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 22,
        padding: 14,
        gap: 12,
    },
    cardTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    cardTitle: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },
    cardSub: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        marginTop: 2,
    },

    softBadge: {
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
    softBadgeText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },

    timelineList: {
        gap: 10,
        marginTop: 2,
    },
    timelineRow: {
        flexDirection: "row",
        alignItems: "stretch",
        gap: 10,
    },
    timelineRail: {
        width: 18,
        alignItems: "center",
    },
    timelineDot: {
        width: 10,
        height: 10,
        borderRadius: 999,
        backgroundColor: "#93C5FD",
        marginTop: 16,
    },
    timelineLine: {
        width: 2,
        flex: 1,
        backgroundColor: "rgba(255,255,255,0.10)",
        marginTop: 4,
        marginBottom: -4,
    },
    timelineCard: {
        flex: 1,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        padding: 12,
        gap: 10,
    },
    timelineCardTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    timelineTitle: {
        flex: 1,
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    timelineMetricsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    timelineMetricPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 32,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    timelineMetricText: {
        color: "#CBD5E1",
        fontSize: 12,
        fontWeight: "800",
    },

    weekTotalPill: {
        minWidth: 44,
        height: 34,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    weekTotalText: {
        color: COLORS.text,
        fontWeight: "900",
    },

    empty: {
        marginTop: 6,
        alignItems: "center",
        gap: 8,
        paddingVertical: 14,
    },
    emptyText: {
        color: COLORS.muted,
        fontWeight: "800",
        textAlign: "center",
    },
});