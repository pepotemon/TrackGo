import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ImageBackground,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
    type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
    Circle,
    Defs,
    G,
    Line,
    LinearGradient,
    Path,
    Rect,
    Stop,
    Text as SvgText,
} from "react-native-svg";

import bgMap from "../assets/bg-map.png";
import { useAuth } from "../src/auth/useAuth";
import { subscribeUserClients } from "../src/data/repositories/clientsRepo";
import { dayKeyFromMs, subscribeDailyEventsByRangeForUser } from "../src/data/repositories/dailyEventsRepo";
import type { ClientDoc, DailyEventDoc } from "../src/types/models";

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

function latestEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();
    for (const e of events) {
        const cid = (e as any)?.clientId as string | undefined;
        const type = (e as any)?.type as string | undefined;
        if (!cid) continue;
        if (type !== "visited" && type !== "rejected" && type !== "pending") continue;

        const prev = map.get(cid);
        const eMs = toMs((e as any)?.createdAt);
        const pMs = prev ? toMs((prev as any)?.createdAt) : 0;

        if (!prev || eMs >= pMs) map.set(cid, e);
    }
    return map;
}

function weekdayShortFromKey(key: string) {
    const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    const names = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    return names[dt.getDay()] ?? key.slice(5);
}

function clamp2(n: number) {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function buildCatmullRomPath(points: { x: number; y: number }[], tension = 1) {
    if (points.length < 2) return "";
    const p = points;

    const d: string[] = [];
    d.push(`M ${p[0].x.toFixed(2)} ${p[0].y.toFixed(2)}`);

    for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[i - 1] ?? p[i];
        const p1 = p[i];
        const p2 = p[i + 1];
        const p3 = p[i + 2] ?? p2;

        const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension;
        const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension;

        const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension;
        const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension;

        d.push(
            `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(
                2
            )} ${p2.y.toFixed(2)}`
        );
    }

    return d.join(" ");
}

type WeekAgg = {
    weekStartKey: string;
    weekEndKey: string;
    visited: number;
    rejected: number;
    total: number;
    effectiveness: number | null;
};

type ProChartTheme = {
    bg: string;
    border: string;
    grid: string;
    text: string;
    muted: string;
    accent: string;
    accentSoft: string;
};

const CHART_CFG = {
    height: 140,
    paddingX: 10,
    paddingTop: 14,
    paddingBottom: 22,
    gridLines: 3,
    yAxisGutter: 30,
    lineStrokeWidth: 2.6,
    dotRadius: 3.4,
    fontSize: 10,
};

function ProLineChart({
    values,
    labels,
    theme,
    tooltipItems,
}: {
    values: number[];
    labels: string[];
    theme: ProChartTheme;
    tooltipItems?: string[];
}) {
    const [w, setW] = useState(0);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

    const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

    useEffect(() => {
        setSelectedIdx(null);
    }, [values.join(","), labels.join(",")]);

    const data = useMemo(() => values.map((v) => (Number.isFinite(v) ? v : 0)), [values]);
    const max = useMemo(() => Math.max(1, ...data), [data]);
    const min = 0;

    const inner = useMemo(() => {
        const labelX = CHART_CFG.paddingX;
        const plotLeft = CHART_CFG.paddingX + CHART_CFG.yAxisGutter;
        const plotRight = Math.max(plotLeft + 1, w - CHART_CFG.paddingX);

        const top = CHART_CFG.paddingTop;
        const bottom = CHART_CFG.paddingBottom;

        const iw = Math.max(1, plotRight - plotLeft);
        const ih = Math.max(1, CHART_CFG.height - top - bottom);

        const n = data.length;
        const stepX = n <= 1 ? 0 : iw / (n - 1);

        const scaleY = (v: number) => {
            const denom = max - min || 1;
            const t = (v - min) / denom;
            return top + (1 - t) * ih;
        };

        const pts = data.map((v, i) => ({
            x: plotLeft + stepX * i,
            y: scaleY(v),
            v,
        }));

        return { labelX, plotLeft, plotRight, iw, pts, scaleY };
    }, [w, data, max]);

    const path = useMemo(() => {
        if (inner.pts.length < 2) return "";
        return buildCatmullRomPath(inner.pts, 1);
    }, [inner.pts]);

    const areaPath = useMemo(() => {
        if (inner.pts.length < 2) return "";
        const last = inner.pts[inner.pts.length - 1];
        const first = inner.pts[0];
        const baseY = CHART_CFG.height - CHART_CFG.paddingBottom;
        return `${path} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${baseY.toFixed(2)} Z`;
    }, [path, inner.pts]);

    const yTicks = useMemo(() => {
        const lines = CHART_CFG.gridLines;
        const out: { y: number; val: number }[] = [];
        for (let i = 0; i <= lines; i++) {
            const t = i / lines;
            const val = max - (max - min) * t;
            const y = inner.scaleY(val);
            out.push({ y, val: clamp2(val) });
        }
        return out;
    }, [inner, max]);

    const tooltip = useMemo(() => {
        if (selectedIdx == null) return null;
        const p = inner.pts[selectedIdx];
        if (!p) return null;

        const text = tooltipItems?.[selectedIdx] ?? `${labels[selectedIdx] ?? ""} · ${p.v.toFixed(0)}`;
        const shown = text.length > 32 ? text.slice(0, 31) + "…" : text;

        const boxW = 170;
        const boxH = 34;

        const x0 = Math.max(
            inner.plotLeft + 6,
            Math.min(p.x - boxW / 2, inner.plotRight - boxW - 6)
        );
        const y0 = Math.max(6, p.y - boxH - 10);

        return { x0, y0, boxW, boxH, shown };
    }, [selectedIdx, inner.pts, inner.plotLeft, inner.plotRight, labels, tooltipItems]);

    return (
        <View onLayout={onLayout} style={{ width: "100%" }}>
            <View style={[styles.svgWrap, { height: CHART_CFG.height }]}>
                {w > 0 ? (
                    <Svg width={w} height={CHART_CFG.height}>
                        <Defs>
                            <LinearGradient id="lineAreaHistory" x1="0" y1="0" x2="0" y2="1">
                                <Stop offset="0%" stopColor={theme.accentSoft} stopOpacity="0.55" />
                                <Stop offset="100%" stopColor={theme.accentSoft} stopOpacity="0.02" />
                            </LinearGradient>
                        </Defs>

                        <G>
                            {yTicks.map((t, idx) => (
                                <G key={idx}>
                                    <Line
                                        x1={inner.plotLeft}
                                        x2={inner.plotRight}
                                        y1={t.y}
                                        y2={t.y}
                                        stroke={theme.grid}
                                        strokeWidth={1}
                                    />
                                    <SvgText
                                        x={inner.labelX}
                                        y={t.y - 4}
                                        fill={theme.muted}
                                        fontSize={CHART_CFG.fontSize}
                                        fontWeight="700"
                                    >
                                        {t.val.toFixed(0)}
                                    </SvgText>
                                </G>
                            ))}
                        </G>

                        {areaPath ? <Path d={areaPath} fill="url(#lineAreaHistory)" /> : null}

                        {path ? (
                            <Path
                                d={path}
                                fill="none"
                                stroke={theme.accent}
                                strokeWidth={CHART_CFG.lineStrokeWidth}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        ) : null}

                        {inner.pts.map((p, idx) => (
                            <G key={idx}>
                                <Circle cx={p.x} cy={p.y} r={CHART_CFG.dotRadius} fill={theme.accent} opacity={0.92} />
                                <Circle cx={p.x} cy={p.y} r={14} fill="transparent" onPress={() => setSelectedIdx(idx)} />
                            </G>
                        ))}

                        {tooltip ? (
                            <G>
                                <Rect
                                    x={tooltip.x0}
                                    y={tooltip.y0}
                                    width={tooltip.boxW}
                                    height={tooltip.boxH}
                                    rx={10}
                                    ry={10}
                                    fill="rgba(15,23,42,0.92)"
                                    stroke="rgba(255,255,255,0.10)"
                                    strokeWidth={1}
                                />
                                <SvgText
                                    x={tooltip.x0 + 10}
                                    y={tooltip.y0 + 21}
                                    fill="rgba(255,255,255,0.90)"
                                    fontSize={11}
                                    fontWeight="800"
                                >
                                    {tooltip.shown}
                                </SvgText>
                            </G>
                        ) : null}

                        <G>
                            {labels.map((lab, idx) => {
                                const n = Math.max(1, labels.length);
                                const x =
                                    n <= 1
                                        ? inner.plotLeft
                                        : inner.plotLeft + (inner.iw / (n - 1)) * idx;
                                const y = CHART_CFG.height - 6;
                                return (
                                    <SvgText
                                        key={lab + idx}
                                        x={x}
                                        y={y}
                                        fill={theme.muted}
                                        fontSize={CHART_CFG.fontSize}
                                        fontWeight="800"
                                        textAnchor="middle"
                                    >
                                        {lab}
                                    </SvgText>
                                );
                            })}
                        </G>
                    </Svg>
                ) : null}
            </View>
        </View>
    );
}

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

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [weekEvents, setWeekEvents] = useState<DailyEventDoc[]>([]);
    const [historyEvents, setHistoryEvents] = useState<DailyEventDoc[]>([]);
    const [err, setErr] = useState<string | null>(null);
    const [historyListOpen, setHistoryListOpen] = useState(false);

    const HISTORY_DAYS = 365;
    const HISTORY_WEEKS = 12;

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
        const unsub = subscribeUserClients(firebaseUser.uid, (list) => setClients(list ?? []));
        return () => unsub();
    }, [firebaseUser?.uid]);

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

    const clientById = useMemo(() => {
        const m = new Map<string, ClientDoc>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    const shouldCountEvent = useCallback(
        (e: DailyEventDoc) => {
            const cid = (e as any)?.clientId as string | undefined;
            if (!cid) return false;

            const c = clientById.get(cid);
            if (!c) return false;

            return c.status === e.type;
        },
        [clientById]
    );

    const weekSummary = useMemo(() => {
        const last = latestEventByClient(weekEvents);

        let visited = 0;
        let rejected = 0;

        for (const e of last.values()) {
            if (!shouldCountEvent(e)) continue;
            if (e.type === "visited") visited++;
            if (e.type === "rejected") rejected++;
        }

        const total = visited + rejected;
        const effectiveness = total > 0 ? (visited / total) * 100 : null;

        return { visited, rejected, total, effectiveness };
    }, [weekEvents, shouldCountEvent]);

    const historySummary = useMemo(() => {
        const last = latestEventByClient(historyEvents);

        let visited = 0;
        let rejected = 0;

        for (const e of last.values()) {
            if (!shouldCountEvent(e)) continue;
            if (e.type === "visited") visited++;
            if (e.type === "rejected") rejected++;
        }

        const total = visited + rejected;
        const effectiveness = total > 0 ? (visited / total) * 100 : null;

        return { visited, rejected, total, effectiveness };
    }, [historyEvents, shouldCountEvent]);

    const daySeries = useMemo(() => {
        const byDay: Record<string, { visited: number; rejected: number }> = {};

        const latest = latestEventByClient(weekEvents);
        for (const e of latest.values()) {
            if (!shouldCountEvent(e)) continue;

            const dk = String((e as any)?.dayKey ?? "");
            if (!dk) continue;

            if (!byDay[dk]) byDay[dk] = { visited: 0, rejected: 0 };

            if (e.type === "visited") byDay[dk].visited += 1;
            if (e.type === "rejected") byDay[dk].rejected += 1;
        }

        const keys: string[] = [];
        let cursor = weekStartKey;
        while (cursor <= weekEndKey) {
            keys.push(cursor);
            cursor = addDaysKey(cursor, 1);
        }

        return keys.map((dk) => {
            const it = byDay[dk] ?? { visited: 0, rejected: 0 };
            return {
                dayKey: dk,
                label: weekdayShortFromKey(dk),
                visited: it.visited,
                rejected: it.rejected,
                total: it.visited + it.rejected,
            };
        });
    }, [weekEvents, shouldCountEvent, weekStartKey, weekEndKey]);

    const bestDay = useMemo(() => {
        if (!daySeries.length) return null;
        let top = daySeries[0];
        for (const d of daySeries) {
            if (d.total > top.total) top = d;
        }
        if (top.total <= 0) return null;
        return top;
    }, [daySeries]);

    const weeksAgg = useMemo(() => {
        const perWeekLastByClient = new Map<string, Map<string, DailyEventDoc>>();

        for (const e of historyEvents) {
            const type = (e as any)?.type as string | undefined;
            const cid = (e as any)?.clientId as string | undefined;
            if (type !== "visited" && type !== "rejected") continue;
            if (!cid) continue;
            if (!shouldCountEvent(e)) continue;

            const ts = toMs((e as any)?.createdAt);
            if (!ts) continue;

            const mon = mondayOfWeek(new Date(ts));
            const wkStartKey = dayKeyFromDate(mon);

            if (!perWeekLastByClient.has(wkStartKey)) {
                perWeekLastByClient.set(wkStartKey, new Map());
            }

            const m = perWeekLastByClient.get(wkStartKey)!;
            const prev = m.get(cid);
            const eMs = toMs((e as any)?.createdAt);
            const pMs = prev ? toMs((prev as any)?.createdAt) : 0;

            if (!prev || eMs >= pMs) m.set(cid, e);
        }

        const arr: WeekAgg[] = [];
        for (const [wkStartKey, map] of perWeekLastByClient.entries()) {
            let visited = 0;
            let rejected = 0;

            for (const e of map.values()) {
                if (e.type === "visited") visited++;
                if (e.type === "rejected") rejected++;
            }

            const total = visited + rejected;
            arr.push({
                weekStartKey: wkStartKey,
                weekEndKey: addDaysKey(wkStartKey, 6),
                visited,
                rejected,
                total,
                effectiveness: total > 0 ? (visited / total) * 100 : null,
            });
        }

        arr.sort((a, b) => (a.weekStartKey < b.weekStartKey ? 1 : -1));
        return arr.slice(0, HISTORY_WEEKS);
    }, [historyEvents, shouldCountEvent]);

    const periodTone = useMemo(() => {
        if (weekSummary.total <= 0) return "neutral";
        if ((weekSummary.effectiveness ?? 0) >= 70) return "pos";
        if ((weekSummary.effectiveness ?? 0) < 40) return "neg";
        return "neutral";
    }, [weekSummary]);

    const periodLabel = useMemo(() => {
        if (periodTone === "pos") return "Buen ritmo";
        if (periodTone === "neg") return "Bajo ritmo";
        return "Normal";
    }, [periodTone]);

    const goPrevWeek = () => {
        setWeekStartKey(addDaysKey(weekStartKey, -7));
        setWeekEndKey(addDaysKey(weekEndKey, -7));
    };

    const goNextWeek = () => {
        const nextStart = addDaysKey(weekStartKey, 7);
        if (nextStart > todayKey) return;

        let nextEnd = addDaysKey(weekEndKey, 7);
        if (nextEnd > todayKey) nextEnd = todayKey;

        setWeekStartKey(nextStart);
        setWeekEndKey(nextEnd);
    };

    const goCurrentWeek = () => {
        setWeekStartKey(fallbackWeek.startKey);
        setWeekEndKey(fallbackWeek.endKey);
    };

    const chartTheme: ProChartTheme = useMemo(
        () => ({
            bg: "rgba(255,255,255,0.03)",
            border: "rgba(255,255,255,0.08)",
            grid: "rgba(255,255,255,0.06)",
            text: COLORS.text,
            muted: "rgba(255,255,255,0.45)",
            accent: "rgba(96,165,250,0.95)",
            accentSoft: "rgba(96,165,250,0.26)",
        }),
        []
    );

    const weekTrendValues = useMemo(() => daySeries.map((d) => d.total), [daySeries]);
    const weekTrendLabels = useMemo(() => daySeries.map((d) => d.label), [daySeries]);
    const weekTrendTooltips = useMemo(
        () => daySeries.map((d) => `${d.dayKey} · ${d.total} gestionados`),
        [daySeries]
    );

    const StatBox = ({
        tone,
        icon,
        label,
        value,
    }: {
        tone: "ok" | "bad" | "neutral";
        icon: any;
        label: string;
        value: number | string;
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
                    <ScrollView
                        contentContainerStyle={[
                            styles.content,
                            { paddingBottom: Math.max(20, insets.bottom + 16) },
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.header}>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text style={styles.title}>Actividad</Text>
                                {err ? <Text style={styles.errText}>Eventos: {err}</Text> : null}
                            </View>

                            <View style={styles.headerRight}>
                                <View style={styles.weekPill}>
                                    <Ionicons name="calendar-outline" size={14} color={COLORS.muted} />
                                    <Text style={styles.weekPillText}>Lun–Dom</Text>
                                </View>
                            </View>
                        </View>

                        <View style={styles.navCard}>
                            <View style={styles.navTop}>
                                <View style={styles.navIconWrap}>
                                    <Ionicons name="time-outline" size={18} color={COLORS.text} />
                                </View>

                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={styles.navTitle}>Semana consultada</Text>
                                    <Text style={styles.navSub} numberOfLines={1}>
                                        {weekStartKey} → {weekEndKey}
                                    </Text>
                                </View>

                                <Pressable
                                    onPress={goCurrentWeek}
                                    style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
                                >
                                    <Ionicons name="refresh-outline" size={14} color={COLORS.text} />
                                    <Text style={styles.resetBtnText}>Actual</Text>
                                </Pressable>
                            </View>

                            <View style={styles.navActions}>
                                <Pressable
                                    onPress={goPrevWeek}
                                    style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
                                    accessibilityLabel="Semana anterior"
                                >
                                    <Ionicons name="chevron-back" size={16} color={COLORS.text} />
                                    <Text style={styles.navBtnText}>Anterior</Text>
                                </Pressable>

                                <Pressable
                                    onPress={goNextWeek}
                                    style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
                                    accessibilityLabel="Semana siguiente"
                                >
                                    <Text style={styles.navBtnText}>Siguiente</Text>
                                    <Ionicons name="chevron-forward" size={16} color={COLORS.text} />
                                </Pressable>
                            </View>
                        </View>

                        <View style={styles.kpiRow}>
                            <View style={styles.kpiCard}>
                                <Text style={styles.kpiLabel}>Gestionados</Text>
                                <Text style={styles.kpiValue}>{weekSummary.total}</Text>
                                <Text style={styles.kpiHint}>
                                    {weekSummary.visited} visitados · {weekSummary.rejected} rechazados
                                </Text>
                                <Text style={styles.kpiHint2} numberOfLines={1}>
                                    Período consultado
                                </Text>
                            </View>

                            <View style={styles.kpiCard}>
                                <View style={styles.kpiTopRow}>
                                    <Text style={styles.kpiLabel}>Efectividad</Text>
                                    <View
                                        style={[
                                            styles.perfPill,
                                            periodTone === "pos"
                                                ? styles.perfPillPos
                                                : periodTone === "neg"
                                                    ? styles.perfPillNeg
                                                    : styles.perfPillNeutral,
                                        ]}
                                    >
                                        <Ionicons
                                            name={
                                                periodTone === "pos"
                                                    ? "trending-up-outline"
                                                    : periodTone === "neg"
                                                        ? "trending-down-outline"
                                                        : "remove-outline"
                                            }
                                            size={14}
                                            color={
                                                periodTone === "pos"
                                                    ? COLORS.ok
                                                    : periodTone === "neg"
                                                        ? COLORS.bad
                                                        : COLORS.muted
                                            }
                                        />
                                        <Text
                                            style={[
                                                styles.perfPillText,
                                                periodTone === "pos"
                                                    ? styles.perfTextPos
                                                    : periodTone === "neg"
                                                        ? styles.perfTextNeg
                                                        : styles.perfTextNeutral,
                                            ]}
                                        >
                                            {periodLabel}
                                        </Text>
                                    </View>
                                </View>

                                <Text
                                    style={[
                                        styles.kpiValue,
                                        periodTone === "pos"
                                            ? styles.valuePos
                                            : periodTone === "neg"
                                                ? styles.valueNeg
                                                : null,
                                    ]}
                                >
                                    {weekSummary.effectiveness == null
                                        ? "—"
                                        : `${weekSummary.effectiveness.toFixed(0)}%`}
                                </Text>

                                <Text style={styles.kpiHint}>
                                    {bestDay ? `Mejor día: ${bestDay.label} · ${bestDay.total}` : "Mejor día: —"}
                                </Text>
                                <Text style={styles.kpiHint2}>
                                    Histórico:{" "}
                                    {historySummary.effectiveness == null
                                        ? "—"
                                        : `${historySummary.effectiveness.toFixed(0)}%`}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.card}>
                            <View style={styles.cardTopRow}>
                                <Text style={styles.cardTitle}>Rendimiento</Text>

                                <View style={styles.miniLegend}>
                                    <View style={[styles.legendDot, styles.dotManaged]} />
                                    <Text style={styles.legendText}>Gestionados</Text>
                                </View>
                            </View>

                            <View style={styles.chartBlock}>
                                <Text style={styles.cardSub}>Tendencia por día</Text>
                                <View style={styles.svgCard}>
                                    <ProLineChart
                                        values={weekTrendValues}
                                        labels={weekTrendLabels}
                                        theme={chartTheme}
                                        tooltipItems={weekTrendTooltips}
                                    />
                                </View>
                            </View>

                            <View style={styles.quickStatsRow}>
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
                                <StatBox
                                    tone="neutral"
                                    icon="analytics-outline"
                                    label="Total"
                                    value={weekSummary.total}
                                />
                            </View>
                        </View>

                        <View style={styles.card}>
                            <Pressable
                                onPress={() => setHistoryListOpen((v) => !v)}
                                style={({ pressed }) => [styles.historyHeader, pressed && styles.pressed]}
                            >
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={styles.cardTitle}>Historial</Text>
                                    <Text style={styles.cardSub}>Últimas {HISTORY_WEEKS} semanas</Text>
                                </View>

                                <View style={styles.historyRight}>
                                    <View style={styles.weekPill}>
                                        <Ionicons name="time-outline" size={14} color={COLORS.muted} />
                                        <Text style={styles.weekPillText}>{HISTORY_WEEKS}w</Text>
                                    </View>

                                    <View style={styles.chevBox}>
                                        <Ionicons
                                            name={historyListOpen ? "chevron-up" : "chevron-down"}
                                            size={18}
                                            color="rgba(255,255,255,0.72)"
                                        />
                                    </View>
                                </View>
                            </Pressable>

                            <View style={styles.historySummaryCard}>
                                <View style={styles.historyBigValueWrap}>
                                    <Text style={styles.historyBigValue}>{historySummary.total}</Text>
                                    <Text style={styles.historyBigLabel}>movimientos válidos</Text>
                                </View>

                                <View style={styles.historySideStats}>
                                    <View style={styles.historyMiniLine}>
                                        <Ionicons
                                            name="checkmark-circle-outline"
                                            size={15}
                                            color={COLORS.ok}
                                        />
                                        <Text style={styles.historyMiniLabel}>Visitados</Text>
                                        <Text style={styles.historyMiniValue}>{historySummary.visited}</Text>
                                    </View>

                                    <View style={styles.historyMiniLine}>
                                        <Ionicons
                                            name="close-circle-outline"
                                            size={15}
                                            color={COLORS.bad}
                                        />
                                        <Text style={styles.historyMiniLabel}>Rechazados</Text>
                                        <Text style={styles.historyMiniValue}>{historySummary.rejected}</Text>
                                    </View>
                                </View>
                            </View>

                            {historyListOpen ? (
                                !weeksAgg.length ? (
                                    <View style={styles.empty}>
                                        <Ionicons name="bar-chart-outline" size={22} color={COLORS.muted} />
                                        <Text style={styles.emptyText}>No hay datos todavía en este rango.</Text>
                                    </View>
                                ) : (
                                    <View style={styles.timelineList}>
                                        {weeksAgg.map((w) => {
                                            const tone =
                                                w.total <= 0
                                                    ? "neutral"
                                                    : (w.effectiveness ?? 0) >= 70
                                                        ? "pos"
                                                        : (w.effectiveness ?? 0) < 40
                                                            ? "neg"
                                                            : "neutral";

                                            return (
                                                <View key={w.weekStartKey} style={styles.weekRow}>
                                                    <View style={{ flex: 1, gap: 2 }}>
                                                        <Text style={styles.weekRowTitle}>
                                                            {w.weekStartKey} → {w.weekEndKey}
                                                        </Text>
                                                        <Text style={styles.weekRowSub} numberOfLines={1}>
                                                            {w.visited} visitados · {w.rejected} rechazados
                                                        </Text>
                                                    </View>

                                                    <View
                                                        style={[
                                                            styles.weekRealPill,
                                                            tone === "pos"
                                                                ? styles.weekRealPos
                                                                : tone === "neg"
                                                                    ? styles.weekRealNeg
                                                                    : styles.weekRealNeu,
                                                        ]}
                                                    >
                                                        <Text style={styles.weekRealText}>{w.total}</Text>
                                                        <Text style={styles.weekRealSmall}>
                                                            {w.effectiveness == null
                                                                ? "—"
                                                                : `${w.effectiveness.toFixed(0)}%`}
                                                        </Text>
                                                    </View>
                                                </View>
                                            );
                                        })}
                                    </View>
                                )
                            ) : null}
                        </View>
                    </ScrollView>
                </View>
            </ImageBackground>
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
    info: "#60A5FA",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    bg: { flex: 1 },

    bgImage: { opacity: 0.55 },

    overlay: {
        flex: 1,
        backgroundColor: "rgba(11,18,32,0.40)",
        paddingHorizontal: 16,
    },

    content: {
        paddingTop: 12,
        gap: 12,
    },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    header: { flexDirection: "row", alignItems: "center", gap: 10 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    title: { color: COLORS.text, fontSize: 22, fontWeight: "900", },
    errText: { marginTop: 6, color: "#FCA5A5", fontSize: 12, fontWeight: "900" },

    weekPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        height: 34,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    weekPillText: { color: COLORS.muted, fontWeight: "900", fontSize: 12 },

    navCard: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        gap: 10,
    },
    navTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    navIconWrap: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
    },
    navTitle: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    navSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    resetBtn: {
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    resetBtnText: { color: COLORS.text, fontSize: 12, fontWeight: "900" },

    navActions: { flexDirection: "row", gap: 8 },
    navBtn: {
        flex: 1,
        height: 38,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 8,
    },
    navBtnText: { color: COLORS.text, fontSize: 12, fontWeight: "900" },

    kpiRow: { flexDirection: "row", gap: 12 },
    kpiCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        gap: 6,
    },
    kpiTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },

    kpiLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    kpiValue: { color: COLORS.text, fontSize: 20, fontWeight: "900" },
    valuePos: { color: "#86EFAC" },
    valueNeg: { color: "#FCA5A5" },

    kpiHint: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.9 },
    kpiHint2: { color: COLORS.muted, fontSize: 11, fontWeight: "800", opacity: 0.85 },

    perfPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 26,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
    },
    perfPillPos: { backgroundColor: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.30)" },
    perfPillNeg: { backgroundColor: "rgba(248,113,113,0.12)", borderColor: "rgba(248,113,113,0.30)" },
    perfPillNeutral: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)" },
    perfPillText: { fontSize: 11, fontWeight: "900" },
    perfTextPos: { color: "#86EFAC" },
    perfTextNeg: { color: "#FCA5A5" },
    perfTextNeutral: { color: COLORS.muted },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        gap: 12,
    },
    cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    cardTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
    cardSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.92 },

    miniLegend: { flexDirection: "row", alignItems: "center", gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 99 },
    dotManaged: { backgroundColor: "rgba(96,165,250,0.82)" },
    legendText: { color: COLORS.muted, fontWeight: "900", fontSize: 11 },

    chartBlock: { gap: 8 },

    svgCard: {
        width: "100%" as any,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.03)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        overflow: "hidden",
    },
    svgWrap: { width: "100%" as any },

    quickStatsRow: { flexDirection: "row", gap: 10 },

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
    statBoxTop: { flexDirection: "row", alignItems: "center", gap: 7 },
    statBoxLabel: { color: COLORS.text, fontSize: 12, fontWeight: "800" },
    statBoxValue: { color: COLORS.text, fontSize: 20, fontWeight: "900" },

    historyHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
    historyRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    historySummaryCard: {
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

    weekRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    weekRowTitle: { color: COLORS.text, fontWeight: "900", fontSize: 12 },
    weekRowSub: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 11 },

    weekRealPill: {
        width: 108,
        borderRadius: 14,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        alignItems: "flex-end",
        justifyContent: "center",
    },
    weekRealPos: { backgroundColor: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.28)" },
    weekRealNeg: { backgroundColor: "rgba(248,113,113,0.12)", borderColor: "rgba(248,113,113,0.28)" },
    weekRealNeu: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)" },
    weekRealText: { color: COLORS.text, fontWeight: "900", fontSize: 12 },
    weekRealSmall: { color: "rgba(255,255,255,0.55)", fontWeight: "900", fontSize: 10, marginTop: 2 },

    chevBox: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },

    timelineList: { gap: 8 },

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