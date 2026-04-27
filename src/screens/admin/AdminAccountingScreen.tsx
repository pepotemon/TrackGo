// src/screens/admin/AdminAccountingScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    InteractionManager,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
    type LayoutChangeEvent
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AdminBackground from "../../components/admin/AdminBackground";

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

import { getAccountingGrossForUserWeek, getWeeklyBillingSnapshot } from "../../data/billing";
import { subscribeAdminClients } from "../../data/repositories/clientsRepo";
import { subscribeDailyEventsByRange } from "../../data/repositories/dailyEventsRepo";
import {
    subscribeWeeklyInvestment,
    type WeeklyInvestmentAllocations,
    type WeeklyInvestmentGroup,
} from "../../data/repositories/investmentsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, DailyEventDoc, UserDoc } from "../../types/models";

// ------------------------
// Date helpers (Lun–Sáb)
// ------------------------
function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function weekRangeKeysMonToSat(base = new Date()) {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);
    const jsDay = d.getDay(); // 0=Dom..6=Sáb
    const diffToMonday = jsDay === 0 ? 6 : jsDay - 1; // lunes=0
    const start = new Date(d);
    start.setDate(d.getDate() - diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 5); // Lun–Sáb
    return {
        startKey: dayKeyFromDate(start),
        endKey: dayKeyFromDate(end),
        startDate: start,
        endDate: end,
    };
}

function weekRangeFromMondayStartMonToSat(mondayStart: Date) {
    const start = new Date(mondayStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 5); // Lun–Sáb
    end.setHours(0, 0, 0, 0);
    return {
        startKey: dayKeyFromDate(start),
        endKey: dayKeyFromDate(end),
        startDate: start,
        endDate: end,
    };
}

function addDays(d: Date, days: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
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

function safeNumber(n: any, fallback = 0): number {
    const v = Number(n);
    return Number.isFinite(v) ? v : fallback;
}

function getRatePerVisit(u?: UserDoc | null) {
    const anyU: any = u as any;
    const n = anyU?.ratePerVisit ?? anyU?.visitFee ?? 0;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function getFrozenAmountFromEvent(
    event: DailyEventDoc,
    user?: UserDoc | null
) {
    const anyE: any = event as any;

    const amount = safeNumber(anyE?.amount, NaN);
    if (Number.isFinite(amount)) return amount;

    const rateApplied = safeNumber(anyE?.rateApplied, NaN);
    if (Number.isFinite(rateApplied)) return rateApplied;

    return getRatePerVisit(user);
}

function clamp2(n: number) {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function money(n: number) {
    const v = Number.isFinite(n) ? n : 0;
    return v.toFixed(2);
}

function isFiniteNumber(n: any): n is number {
    return typeof n === "number" && Number.isFinite(n);
}

function monthDay(keyYYYYMMDD: string) {
    return keyYYYYMMDD?.slice?.(5) ?? keyYYYYMMDD;
}

function monthKeyFromDayKey(keyYYYYMMDD: string) {
    return keyYYYYMMDD?.slice?.(0, 7) ?? "";
}

const MONTHS_SHORT_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatMonthLabelLong(monthKey: string) {
    const [year, month] = String(monthKey || "").split("-");
    const idx = Math.max(1, Math.min(12, Number(month) || 1)) - 1;
    return `${MONTHS_SHORT_ES[idx]} ${year || ""}`.trim();
}

function formatMonthLabelShort(monthKey: string) {
    const [year, month] = String(monthKey || "").split("-");
    const idx = Math.max(1, Math.min(12, Number(month) || 1)) - 1;
    return `${MONTHS_SHORT_ES[idx]}/${String(year || "").slice(-2)}`;
}

// ------------------------
// PRO SVG Charts (with gutter + tooltip)
// ------------------------
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
    height: 132,
    paddingX: 10,
    paddingTop: 14,
    paddingBottom: 22,
    gridLines: 3,
    yAxisGutter: 30,
    lineStrokeWidth: 2.6,
    dotRadius: 3.4,
    barWidth: 12,
    barRadius: 8,
    fontSize: 10,
};

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
            `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(
                2
            )}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
        );
    }

    return d.join(" ");
}

function ProLineChart({
    values,
    labels,
    theme,
    height = CHART_CFG.height,
    strokeWidth = CHART_CFG.lineStrokeWidth,
    dotRadius = CHART_CFG.dotRadius,
    showDots = true,
    xMode = "labels",
    tooltipItems,
}: {
    values: number[];
    labels: string[];
    theme: ProChartTheme;
    height?: number;
    strokeWidth?: number;
    dotRadius?: number;
    showDots?: boolean;
    xMode?: "labels" | "dots";
    tooltipItems?: string[];
}) {
    const [w, setW] = useState(0);
    const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

    useEffect(() => {
        setSelectedIdx(null);
    }, [values.join(","), labels.join(","), xMode]);

    const data = useMemo(() => values.map((v) => (isFiniteNumber(v) ? v : 0)), [values]);
    const max = useMemo(() => Math.max(1, ...data), [data]);
    const min = useMemo(() => Math.min(0, ...data), [data]);

    const inner = useMemo(() => {
        const labelX = CHART_CFG.paddingX;
        const plotLeft = CHART_CFG.paddingX + CHART_CFG.yAxisGutter;
        const plotRight = Math.max(plotLeft + 1, w - CHART_CFG.paddingX);

        const top = CHART_CFG.paddingTop;
        const bottom = CHART_CFG.paddingBottom;

        const iw = Math.max(1, plotRight - plotLeft);
        const ih = Math.max(1, height - top - bottom);

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

        return { labelX, plotLeft, plotRight, top, bottom, iw, ih, pts, scaleY };
    }, [w, height, data, max, min]);

    const path = useMemo(() => {
        if (inner.pts.length < 2) return "";
        return buildCatmullRomPath(inner.pts, 1);
    }, [inner.pts]);

    const areaPath = useMemo(() => {
        if (inner.pts.length < 2) return "";
        const last = inner.pts[inner.pts.length - 1];
        const first = inner.pts[0];
        const baseY = height - CHART_CFG.paddingBottom;
        return `${path} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(
            2
        )} ${baseY.toFixed(2)} Z`;
    }, [path, inner.pts, height]);

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
    }, [inner, max, min]);

    const tooltip = useMemo(() => {
        if (selectedIdx == null) return null;
        const p = inner.pts[selectedIdx];
        if (!p) return null;

        const text =
            tooltipItems?.[selectedIdx] ?? `${labels[selectedIdx] ?? ""} · ${p.v.toFixed(0)}`;

        const maxChars = 34;
        const shown =
            text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;

        const boxW = 180;
        const boxH = 34;

        const margin = 6;
        const x0 = Math.max(
            inner.plotLeft + margin,
            Math.min(p.x - boxW / 2, inner.plotRight - boxW - margin)
        );
        const y0 = Math.max(6, p.y - boxH - 10);

        return { x0, y0, boxW, boxH, shown };
    }, [selectedIdx, inner.pts, inner.plotLeft, inner.plotRight, labels, tooltipItems]);

    return (
        <View onLayout={onLayout} style={{ width: "100%" }}>
            <View style={[styles.svgWrap, { height }]}>
                {w > 0 ? (
                    <Svg width={w} height={height}>
                        <Defs>
                            <LinearGradient id="lineArea" x1="0" y1="0" x2="0" y2="1">
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

                        {areaPath ? <Path d={areaPath} fill="url(#lineArea)" /> : null}

                        {path ? (
                            <Path
                                d={path}
                                fill="none"
                                stroke={theme.accent}
                                strokeWidth={strokeWidth}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        ) : null}

                        {showDots
                            ? inner.pts.map((p, idx) => (
                                <G key={idx}>
                                    <Circle cx={p.x} cy={p.y} r={dotRadius} fill={theme.accent} opacity={0.92} />
                                    <Circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={14}
                                        fill="transparent"
                                        onPress={() => setSelectedIdx(idx)}
                                    />
                                </G>
                            ))
                            : null}

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

                        {xMode === "labels" ? (
                            <G>
                                {labels.map((lab, idx) => {
                                    const n = Math.max(1, labels.length);
                                    const x =
                                        n <= 1
                                            ? inner.plotLeft
                                            : inner.plotLeft + (inner.iw / (n - 1)) * idx;
                                    const y = height - 6;
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
                        ) : (
                            <G>
                                {inner.pts.map((p, idx) => {
                                    const y = height - 10;
                                    return (
                                        <G key={idx}>
                                            <Circle cx={p.x} cy={y} r={3} fill="rgba(255,255,255,0.30)" />
                                            <Circle
                                                cx={p.x}
                                                cy={y}
                                                r={14}
                                                fill="transparent"
                                                onPress={() => setSelectedIdx(idx)}
                                            />
                                        </G>
                                    );
                                })}
                            </G>
                        )}
                    </Svg>
                ) : null}
            </View>
        </View>
    );
}

function ProBarChart({
    values,
    labels,
    theme,
    height = CHART_CFG.height,
    barWidth = CHART_CFG.barWidth,
    radius = CHART_CFG.barRadius,
}: {
    values: number[];
    labels: string[];
    theme: ProChartTheme;
    height?: number;
    barWidth?: number;
    radius?: number;
}) {
    const [w, setW] = useState(0);
    const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

    const data = useMemo(() => values.map((v) => (isFiniteNumber(v) ? v : 0)), [values]);
    const max = useMemo(() => Math.max(1, ...data), [data]);

    const inner = useMemo(() => {
        const labelX = CHART_CFG.paddingX;
        const plotLeft = CHART_CFG.paddingX + CHART_CFG.yAxisGutter;
        const plotRight = Math.max(plotLeft + 1, w - CHART_CFG.paddingX);

        const top = CHART_CFG.paddingTop;
        const bottom = CHART_CFG.paddingBottom;

        const iw = Math.max(1, plotRight - plotLeft);
        const ih = Math.max(1, height - top - bottom);

        const n = data.length;
        const slot = n <= 1 ? iw : iw / n;
        const baseY = top + ih;
        const scaleH = (v: number) => (v <= 0 ? 0 : (v / max) * ih);

        const bars = data.map((v, i) => {
            const h = scaleH(v);
            const cx = plotLeft + slot * i + slot / 2;
            const x = cx - barWidth / 2;
            const y = baseY - h;
            return { x, y, h };
        });

        return { labelX, plotLeft, plotRight, iw, ih, slot, baseY, bars };
    }, [w, height, data, max, barWidth]);

    const yTicks = useMemo(() => {
        const lines = CHART_CFG.gridLines;
        const out: { y: number; val: number }[] = [];
        const top = CHART_CFG.paddingTop;
        const bottom = CHART_CFG.paddingBottom;
        const ih = Math.max(1, height - top - bottom);

        for (let i = 0; i <= lines; i++) {
            const t = i / lines;
            const val = max - max * t;
            const y = top + ih * t;
            out.push({ y, val: clamp2(val) });
        }
        return out;
    }, [height, max]);

    return (
        <View onLayout={onLayout} style={{ width: "100%" }}>
            <View style={[styles.svgWrap, { height }]}>
                {w > 0 ? (
                    <Svg width={w} height={height}>
                        <Defs>
                            <LinearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                                <Stop offset="0%" stopColor={theme.accent} stopOpacity="0.55" />
                                <Stop offset="100%" stopColor={theme.accent} stopOpacity="0.18" />
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

                        <G>
                            {inner.bars.map((b, idx) => (
                                <Rect
                                    key={idx}
                                    x={b.x}
                                    y={b.y}
                                    width={barWidth}
                                    height={Math.max(0, b.h)}
                                    rx={radius}
                                    ry={radius}
                                    fill="url(#barFill)"
                                />
                            ))}
                        </G>

                        <G>
                            {labels.map((lab, idx) => {
                                const n = Math.max(1, labels.length);
                                const slot = n <= 1 ? inner.iw : inner.iw / n;
                                const x = inner.plotLeft + slot * idx + slot / 2;
                                const y = height - 6;
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

// ------------------------
// Screen
// ------------------------
export default function AdminAccountingScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { startKey, endKey, startDate } = useMemo(() => weekRangeKeysMonToSat(new Date()), []);

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [weekEvents, setWeekEvents] = useState<DailyEventDoc[]>([]);
    const [weekErr, setWeekErr] = useState<string | null>(null);

    // inversión semanal (presupuesto)
    const [investment, setInvestment] = useState<number>(0);

    // allocations desde firestore
    const [allocations, setAllocations] = useState<WeeklyInvestmentAllocations>({});
    const [groups, setGroups] = useState<WeeklyInvestmentGroup[]>([]);

    // historial semanas
    const [weeksRange, setWeeksRange] = useState(1); // empieza solo con semana actual
    const [historyEventsByWeek, setHistoryEventsByWeek] = useState<Record<string, DailyEventDoc[]>>({});
    const [historyInvByWeek, setHistoryInvByWeek] = useState<Record<string, number>>({});
    const [historyErr, setHistoryErr] = useState<string | null>(null);

    const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

    const toggleMonth = useCallback((monthKey: string) => {
        setExpandedMonths((prev) => ({
            ...prev,
            [monthKey]: !prev[monthKey],
        }));
    }, []);

    // load users
    useEffect(() => {
        (async () => {
            const u = await listUsers("user");
            setUsers(u ?? []);
        })();
    }, []);

    // clients realtime
    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);

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

    // weekly events realtime (semana actual)
    useEffect(() => {
        setWeekErr(null);
        const unsub = subscribeDailyEventsByRange(
            startKey,
            endKey,
            (list) => {
                setWeekErr(null);
                setWeekEvents(list ?? []);
            },
            (err) => {
                const msg = `${err?.code ?? "error"}: ${err?.message ?? ""}`.trim();
                console.log("[AdminAccounting] week events err:", err?.code, err?.message);
                setWeekErr(msg || "permission-denied");
            }
        );
        return () => unsub();
    }, [startKey, endKey]);

    // weekly investment realtime (doc por semana actual)
    useEffect(() => {
        const unsub = subscribeWeeklyInvestment(
            startKey,
            (doc) => {
                const amt = clamp2(safeNumber((doc as any)?.amount ?? 0));
                const alloc = ((doc as any)?.allocations ?? {}) as WeeklyInvestmentAllocations;
                const rawGroups = Array.isArray((doc as any)?.groups)
                    ? ((doc as any)?.groups as WeeklyInvestmentGroup[])
                    : [];

                setInvestment(amt);
                setAllocations(alloc && typeof alloc === "object" ? alloc : {});
                setGroups(rawGroups);
            },
            () => {
                setInvestment(0);
                setAllocations({});
                setGroups([]);
            }
        );
        return () => unsub();
    }, [startKey]);

    const assignedInvestmentByUser = useMemo(() => {
        const map = new Map<string, number>();

        for (const [uid, value] of Object.entries(allocations || {})) {
            const cleanUid = String(uid || "").trim();
            if (!cleanUid) continue;
            map.set(cleanUid, clamp2((map.get(cleanUid) ?? 0) + safeNumber(value)));
        }

        for (const group of groups || []) {
            const userIds = Array.isArray(group.userIds)
                ? group.userIds.map((x) => String(x || "").trim()).filter(Boolean)
                : [];
            if (!userIds.length) continue;

            const share = clamp2(safeNumber(group.amount) / userIds.length);
            for (const uid of userIds) {
                map.set(uid, clamp2((map.get(uid) ?? 0) + share));
            }
        }

        return map;
    }, [allocations, groups]);

    // Historial 24 semanas (Lun–Sáb)
    const historyWeeks = useMemo(() => {
        const baseMonday = new Date(startDate);
        baseMonday.setHours(0, 0, 0, 0);

        const arr: { startKey: string; endKey: string; startDate: Date; endDate: Date }[] = [];

        for (let i = weeksRange - 1; i >= 0; i--) {
            const monday = addDays(baseMonday, -7 * i);
            const r = weekRangeFromMondayStartMonToSat(monday);

            arr.push({
                startKey: r.startKey,
                endKey: r.endKey,
                startDate: r.startDate,
                endDate: r.endDate,
            });
        }

        return arr; // oldest -> newest
    }, [startDate, weeksRange]);

    useEffect(() => {
        setHistoryErr(null);
        const unsubs: Array<() => void> = [];

        for (const w of historyWeeks) {
            const u1 = subscribeDailyEventsByRange(
                w.startKey,
                w.endKey,
                (list) => {
                    InteractionManager.runAfterInteractions(() => {
                        setHistoryEventsByWeek((prev) => ({
                            ...prev,
                            [w.startKey]: list ?? [],
                        }));
                    });
                },
                (err) => {
                    const msg = `${err?.code ?? "error"}: ${err?.message ?? ""}`.trim();
                    setHistoryErr(msg || "permission-denied");
                }
            );
            unsubs.push(() => u1?.());

            const u2 = subscribeWeeklyInvestment(
                w.startKey,
                (doc) => {
                    const amt = clamp2(safeNumber((doc as any)?.amount ?? 0));
                    setHistoryInvByWeek((prev) => ({
                        ...prev,
                        [w.startKey]: amt,
                    }));
                },
                () => {
                    setHistoryInvByWeek((prev) => ({
                        ...prev,
                        [w.startKey]: 0,
                    }));
                }
            );
            unsubs.push(() => u2?.());
        }

        return () => {
            for (const u of unsubs) u();
        };
    }, [historyWeeks]);

    // anti-inflado: SOLO semana actual
    const shouldCountEventCurrentWeek = useCallback(
        (e: DailyEventDoc) => {
            const cid = (e as any)?.clientId;
            if (!cid) return false;
            const c = clientById.get(cid);
            if (!c) return false;
            return c.status === e.type;
        },
        [clientById]
    );

    const weekStats = useMemo(() => {
        const latest = latestEventByClient(weekEvents);

        let visited = 0;
        let rejected = 0;
        let subscriptionGross = 0;
        let subscriptionCost = 0;
        let subscriptionAssignedInvestment = 0;
        let subscriptionPaidUsers = 0;
        let subscriptionUnpaidUsers = 0;
        let weeklySubscriptionUsers = 0;

        const perUserVisits: Record<string, number> = {};
        const perUserPerVisitAmount: Record<string, number> = {};
        const perUserAccountingAmount: Record<string, number> = {};

        for (const e of latest.values()) {
            if (!shouldCountEventCurrentWeek(e)) continue;

            if (e.type === "visited") {
                visited += 1;
                perUserVisits[e.userId] = (perUserVisits[e.userId] ?? 0) + 1;
            } else if (e.type === "rejected") {
                rejected += 1;
            }
        }

        for (const e of latest.values()) {
            if (!shouldCountEventCurrentWeek(e)) continue;
            if (e.type !== "visited") continue;

            const uid = e.userId;
            const amount = getFrozenAmountFromEvent(e, userById.get(uid));
            perUserPerVisitAmount[uid] = clamp2((perUserPerVisitAmount[uid] ?? 0) + amount);
        }

        for (const u of users) {
            if (u.role !== "user") continue;

            const perVisitGross = perUserPerVisitAmount[u.id] ?? 0;
            const billing = getWeeklyBillingSnapshot(u, startKey);
            const accountingGross = getAccountingGrossForUserWeek(u, startKey, perVisitGross);

            perUserAccountingAmount[u.id] = accountingGross;

            if (billing.isWeeklySubscription) {
                weeklySubscriptionUsers += 1;
                if (billing.paid) {
                    subscriptionPaidUsers += 1;
                    subscriptionGross = clamp2(subscriptionGross + billing.gross);
                    const assignedInvestment = clamp2(assignedInvestmentByUser.get(u.id) ?? 0);
                    const effectiveCost = assignedInvestment > 0 ? assignedInvestment : billing.cost;
                    subscriptionAssignedInvestment = clamp2(
                        subscriptionAssignedInvestment + assignedInvestment
                    );
                    subscriptionCost = clamp2(subscriptionCost + effectiveCost);
                } else {
                    subscriptionUnpaidUsers += 1;
                }
            }
        }

        const perVisitGross = clamp2(Object.values(perUserPerVisitAmount).reduce((a, b) => a + b, 0));
        const gross = clamp2(Object.values(perUserAccountingAmount).reduce((a, b) => a + b, 0));

        let topUid: string | null = null;
        let topAmount = 0;
        for (const [uid, amt] of Object.entries(perUserAccountingAmount)) {
            if (amt > topAmount) {
                topAmount = amt;
                topUid = uid;
            }
        }

        return {
            visited,
            rejected,
            gross,
            perVisitGross,
            subscriptionGross,
            subscriptionCost,
            subscriptionAssignedInvestment,
            subscriptionPaidUsers,
            subscriptionUnpaidUsers,
            weeklySubscriptionUsers,
            topUid,
            topAmount,
        };
    }, [weekEvents, shouldCountEventCurrentWeek, userById, users, startKey, assignedInvestmentByUser]);

    const totalInvestment = useMemo(
        () => clamp2(investment + Math.max(0, weekStats.subscriptionCost - weekStats.subscriptionAssignedInvestment)),
        [investment, weekStats.subscriptionCost, weekStats.subscriptionAssignedInvestment]
    );

    const perVisitInvestment = useMemo(
        () => clamp2(Math.max(0, investment - weekStats.subscriptionAssignedInvestment)),
        [investment, weekStats.subscriptionAssignedInvestment]
    );

    const perVisitProfit = useMemo(
        () => clamp2(weekStats.perVisitGross - perVisitInvestment),
        [weekStats.perVisitGross, perVisitInvestment]
    );

    const subscriptionProfit = useMemo(
        () => clamp2(weekStats.subscriptionGross - weekStats.subscriptionCost),
        [weekStats.subscriptionGross, weekStats.subscriptionCost]
    );

    const profit = useMemo(
        () => clamp2(perVisitProfit + subscriptionProfit),
        [perVisitProfit, subscriptionProfit]
    );

    const roi = useMemo(() => {
        if (totalInvestment <= 0) return null;
        return (profit / totalInvestment) * 100;
    }, [profit, totalInvestment]);

    const avgPerDay = useMemo(() => clamp2(profit / 6), [profit]);

    const paidSubscriptionRate = useMemo(() => {
        if (weekStats.weeklySubscriptionUsers <= 0) return null;
        return (weekStats.subscriptionPaidUsers / weekStats.weeklySubscriptionUsers) * 100;
    }, [weekStats.subscriptionPaidUsers, weekStats.weeklySubscriptionUsers]);

    const topUserLabel = useMemo(() => {
        if (!weekStats.topUid) return "—";
        const u = userById.get(weekStats.topUid);
        const name = u?.name?.trim() || "Usuario";
        return `${name} · R$ ${weekStats.topAmount.toFixed(2)}`;
    }, [weekStats.topUid, weekStats.topAmount, userById]);

    // Series diaria (Lun–Sáb)
    const dailySeries = useMemo(() => {
        const byDay: Record<string, { visited: number; gross: number }> = {};
        const latest = latestEventByClient(weekEvents);

        for (const e of latest.values()) {
            if (!shouldCountEventCurrentWeek(e)) continue;

            const dk = (e as any)?.dayKey as string | undefined;
            if (!dk) continue;

            if (!byDay[dk]) byDay[dk] = { visited: 0, gross: 0 };

            if (e.type === "visited") {
                byDay[dk].visited += 1;
                byDay[dk].gross += getFrozenAmountFromEvent(e, userById.get(e.userId));
            }
        }

        const start = new Date(startKey + "T00:00:00");
        const keys: string[] = [];
        for (let i = 0; i < 6; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            keys.push(dayKeyFromDate(d));
        }

        return keys.map((dk) => {
            const it = byDay[dk] ?? { visited: 0, gross: 0 };
            return {
                dayKey: dk,
                label: dk.slice(5), // MM-DD
                visited: it.visited,
                gross: clamp2(it.gross),
            };
        });
    }, [weekEvents, shouldCountEventCurrentWeek, userById, startKey]);

    const chartValuesGross = useMemo(() => dailySeries.map((d) => d.gross), [dailySeries]);
    const chartValuesVisited = useMemo(() => dailySeries.map((d) => d.visited), [dailySeries]);
    const chartLabels = useMemo(() => dailySeries.map((d) => d.label), [dailySeries]);

    // Historial semanal: bruta / inversión / real (Lun–Sáb)
    const weeklyHistory = useMemo(() => {
        return historyWeeks.map((w) => {
            const evs = historyEventsByWeek[w.startKey] ?? [];
            const latest = latestEventByClient(evs);

            // historial NO usa client.status actual
            let visited = 0;
            let rejected = 0;
            let subscriptionGross = 0;
            let subscriptionCost = 0;
            let subscriptionPaidUsers = 0;
            let subscriptionUnpaidUsers = 0;

            const perUserVisits: Record<string, number> = {};
            const perUserPerVisitAmount: Record<string, number> = {};
            const perUserAccountingAmount: Record<string, number> = {};

            for (const e of latest.values()) {
                if (e.type === "visited") {
                    visited += 1;
                    perUserVisits[e.userId] = (perUserVisits[e.userId] ?? 0) + 1;
                } else if (e.type === "rejected") {
                    rejected += 1;
                }
            }

            for (const e of latest.values()) {
                if (e.type !== "visited") continue;

                const uid = e.userId;
                const amount = getFrozenAmountFromEvent(e, userById.get(uid));
                perUserPerVisitAmount[uid] = clamp2((perUserPerVisitAmount[uid] ?? 0) + amount);
            }

            for (const u of users) {
                if (u.role !== "user") continue;

                const perVisitGross = perUserPerVisitAmount[u.id] ?? 0;
                const billing = getWeeklyBillingSnapshot(u, w.startKey);
                perUserAccountingAmount[u.id] = getAccountingGrossForUserWeek(
                    u,
                    w.startKey,
                    perVisitGross
                );

                if (billing.isWeeklySubscription) {
                    if (billing.paid) {
                        subscriptionPaidUsers += 1;
                        subscriptionGross = clamp2(subscriptionGross + billing.gross);
                        subscriptionCost = clamp2(subscriptionCost + billing.cost);
                    } else {
                        subscriptionUnpaidUsers += 1;
                    }
                }
            }

            const perVisitGross = clamp2(Object.values(perUserPerVisitAmount).reduce((a, b) => a + b, 0));
            const gross = clamp2(Object.values(perUserAccountingAmount).reduce((a, b) => a + b, 0));
            const inv = clamp2((historyInvByWeek[w.startKey] ?? 0) + subscriptionCost);
            const perVisitInv = clamp2(historyInvByWeek[w.startKey] ?? 0);
            const perVisitReal = clamp2(perVisitGross - perVisitInv);
            const subscriptionReal = clamp2(subscriptionGross - subscriptionCost);
            const real = clamp2(perVisitReal + subscriptionReal);
            const roiVal = inv > 0 ? (real / inv) * 100 : null;
            const monthKey = monthKeyFromDayKey(w.startKey);

            return {
                startKey: w.startKey,
                endKey: w.endKey,
                label: monthDay(w.startKey),
                monthKey,
                monthLabelLong: formatMonthLabelLong(monthKey),
                visited,
                rejected,
                gross,
                perVisitGross,
                subscriptionGross,
                subscriptionCost,
                perVisitReal,
                subscriptionReal,
                subscriptionPaidUsers,
                subscriptionUnpaidUsers,
                inv,
                real,
                roi: roiVal,
                hasMovement:
                    visited > 0 ||
                    rejected > 0 ||
                    gross > 0 ||
                    inv > 0 ||
                    real !== 0,
            };
        });
    }, [historyWeeks, historyEventsByWeek, historyInvByWeek, userById, users]);

    const activeMonths = useMemo(() => {
        const map = new Map<
            string,
            {
                monthKey: string;
                labelLong: string;
                labelShort: string;
                gross: number;
                perVisitGross: number;
                subscriptionGross: number;
                subscriptionCost: number;
                perVisitReal: number;
                subscriptionReal: number;
                inv: number;
                real: number;
                visited: number;
                rejected: number;
                subscriptionPaidUsers: number;
                subscriptionUnpaidUsers: number;
                roi: number | null;
                weeks: typeof weeklyHistory;
                hasMovement: boolean;
            }
        >();

        for (const w of weeklyHistory) {
            if (!map.has(w.monthKey)) {
                map.set(w.monthKey, {
                    monthKey: w.monthKey,
                    labelLong: formatMonthLabelLong(w.monthKey),
                    labelShort: formatMonthLabelShort(w.monthKey),
                    gross: 0,
                    perVisitGross: 0,
                    subscriptionGross: 0,
                    subscriptionCost: 0,
                    perVisitReal: 0,
                    subscriptionReal: 0,
                    inv: 0,
                    real: 0,
                    visited: 0,
                    rejected: 0,
                    subscriptionPaidUsers: 0,
                    subscriptionUnpaidUsers: 0,
                    roi: null,
                    weeks: [],
                    hasMovement: false,
                });
            }

            const item = map.get(w.monthKey)!;
            item.gross = clamp2(item.gross + w.gross);
            item.perVisitGross = clamp2(item.perVisitGross + w.perVisitGross);
            item.subscriptionGross = clamp2(item.subscriptionGross + w.subscriptionGross);
            item.subscriptionCost = clamp2(item.subscriptionCost + w.subscriptionCost);
            item.perVisitReal = clamp2(item.perVisitReal + w.perVisitReal);
            item.subscriptionReal = clamp2(item.subscriptionReal + w.subscriptionReal);
            item.inv = clamp2(item.inv + w.inv);
            item.real = clamp2(item.real + w.real);
            item.visited += w.visited;
            item.rejected += w.rejected;
            item.subscriptionPaidUsers += w.subscriptionPaidUsers;
            item.subscriptionUnpaidUsers += w.subscriptionUnpaidUsers;
            item.weeks.push(w);
            item.hasMovement = item.hasMovement || w.hasMovement;
        }

        const out = Array.from(map.values())
            .filter((m) => m.hasMovement)
            .map((m) => ({
                ...m,
                roi: m.inv > 0 ? (m.real / m.inv) * 100 : null,
            }))
            .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

        return out;
    }, [weeklyHistory]);

    const monthlyRealValues = useMemo(() => activeMonths.map((m) => m.real), [activeMonths]);
    const monthlyLabels = useMemo(() => activeMonths.map((m) => m.labelShort), [activeMonths]);
    const monthlyTooltipItems = useMemo(
        () =>
            activeMonths.map(
                (m) =>
                    `${m.labelLong} - Real visitas R$ ${money(m.perVisitReal)} - Real subs R$ ${money(m.subscriptionReal)} - Total R$ ${money(m.real)}`
            ),
        [activeMonths]
    );

    const perfTone = useMemo(() => {
        if (profit > 0) return "pos";
        if (profit < 0) return "neg";
        return "neutral";
    }, [profit]);

    const perfLabel = useMemo(() => {
        if (perfTone === "pos") return "Positivo";
        if (perfTone === "neg") return "Negativo";
        return "Neutro";
    }, [perfTone]);

    const chartTheme: ProChartTheme = useMemo(
        () => ({
            bg: "rgba(255,255,255,0.03)",
            border: "rgba(255,255,255,0.08)",
            grid: "rgba(255,255,255,0.06)",
            text: COLORS.text,
            muted: "rgba(255,255,255,0.45)",
            accent: "rgba(34,197,94,0.95)",
            accentSoft: "rgba(34,197,94,0.30)",
        }),
        []
    );

    const warnTheme: ProChartTheme = useMemo(
        () => ({
            ...chartTheme,
            accent: "rgba(251,191,36,0.95)",
            accentSoft: "rgba(251,191,36,0.28)",
        }),
        [chartTheme]
    );

    const realTheme: ProChartTheme = useMemo(
        () => ({
            ...chartTheme,
            accent: "rgba(96,165,250,0.95)",
            accentSoft: "rgba(96,165,250,0.26)",
        }),
        [chartTheme]
    );

    const openBudgetScreen = useCallback(() => {
        router.push({
            pathname: "/admin/weekly-budget" as any,
            params: { weekStartKey: startKey, weekEndKey: endKey },
        });
    }, [router, startKey, endKey]);

    const goToUserAccounting = useCallback(() => {
        router.push({
            pathname: "/admin/accounting-user" as any,
            params: { weekStartKey: startKey, weekEndKey: endKey },
        });
    }, [router, startKey, endKey]);

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
            <AdminBackground>
                <ScrollView
                    contentContainerStyle={[
                        styles.content,
                        { paddingBottom: Math.max(20, insets.bottom + 16) },
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.header}>
                        <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.title}>Contabilidad</Text>
                            <Text style={styles.sub}>
                                Semana <Text style={styles.strong}>{startKey}</Text> →{" "}
                                <Text style={styles.strong}>{endKey}</Text>
                            </Text>
                            {weekErr ? <Text style={styles.errText}>Eventos: {weekErr}</Text> : null}
                        </View>

                        <View style={styles.headerRight}>
                            <Pressable
                                onPress={openBudgetScreen}
                                style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                                accessibilityLabel="Editar presupuesto semanal"
                            >
                                <Ionicons name="wallet-outline" size={18} color={COLORS.text} />
                            </Pressable>

                            <View style={styles.weekPill}>
                                <Ionicons name="calendar-outline" size={14} color={COLORS.muted} />
                                <Text style={styles.weekPillText}>Lun–Sáb</Text>
                            </View>
                        </View>
                    </View>

                    <Pressable
                        onPress={goToUserAccounting}
                        style={({ pressed }) => [styles.heroCard, pressed && styles.pressed]}
                        accessibilityLabel="Ver contabilidad individual por usuario"
                    >
                        <View style={styles.heroTop}>
                            <View style={{ flex: 1, gap: 4 }}>
                                <Text style={styles.kpiLabel}>Ganancia real semanal</Text>
                                <Text
                                    style={[
                                        styles.heroValue,
                                        perfTone === "pos"
                                            ? styles.valuePos
                                            : perfTone === "neg"
                                                ? styles.valueNeg
                                                : null,
                                    ]}
                                >
                                    R$ {money(profit)}
                                </Text>
                                <Text style={styles.kpiHint}>
                                    Bruta R$ {money(weekStats.gross)} - Inversion R$ {money(totalInvestment)}
                                </Text>
                            </View>

                            <View
                                style={[
                                    styles.perfPill,
                                    perfTone === "pos"
                                        ? styles.perfPillPos
                                        : perfTone === "neg"
                                            ? styles.perfPillNeg
                                            : styles.perfPillNeutral,
                                ]}
                            >
                                <Ionicons
                                    name={
                                        perfTone === "pos"
                                            ? "trending-up-outline"
                                            : perfTone === "neg"
                                                ? "trending-down-outline"
                                                : "remove-outline"
                                    }
                                    size={14}
                                    color={
                                        perfTone === "pos"
                                            ? COLORS.ok
                                            : perfTone === "neg"
                                                ? COLORS.bad
                                                : COLORS.muted
                                    }
                                />
                                <Text
                                    style={[
                                        styles.perfPillText,
                                        perfTone === "pos"
                                            ? styles.perfTextPos
                                            : perfTone === "neg"
                                                ? styles.perfTextNeg
                                                : styles.perfTextNeutral,
                                    ]}
                                >
                                    {perfLabel}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.heroMetaRow}>
                            <View style={styles.heroMetaChip}>
                                <Text style={styles.heroMetaLabel}>Real visitas</Text>
                                <Text
                                    style={[
                                        styles.heroMetaValue,
                                        perVisitProfit > 0 ? styles.valuePos : perVisitProfit < 0 ? styles.valueNeg : null,
                                    ]}
                                >
                                    R$ {money(perVisitProfit)}
                                </Text>
                            </View>
                            <View style={styles.heroMetaChip}>
                                <Text style={styles.heroMetaLabel}>Real subs</Text>
                                <Text
                                    style={[
                                        styles.heroMetaValue,
                                        subscriptionProfit > 0
                                            ? styles.valuePos
                                            : subscriptionProfit < 0
                                                ? styles.valueNeg
                                                : null,
                                    ]}
                                >
                                    R$ {money(subscriptionProfit)}
                                </Text>
                            </View>
                            <View style={styles.heroMetaChip}>
                                <Text style={styles.heroMetaLabel}>ROI</Text>
                                <Text style={styles.heroMetaValue}>
                                    {totalInvestment <= 0 ? "-" : `${roi?.toFixed(1)}%`}
                                </Text>
                            </View>
                            <View style={styles.heroMetaChip}>
                                <Text style={styles.heroMetaLabel}>Prom/dia</Text>
                                <Text style={styles.heroMetaValue}>R$ {money(avgPerDay)}</Text>
                            </View>
                            <View style={styles.heroMetaChipWide}>
                                <Text style={styles.heroMetaLabel}>Top</Text>
                                <Text style={styles.heroMetaValue} numberOfLines={1}>{topUserLabel}</Text>
                            </View>
                        </View>
                    </Pressable>

                    <View style={styles.breakdownGrid}>
                        <View style={styles.metricCard}>
                            <View style={styles.metricIconGreen}>
                                <Ionicons name="people-outline" size={16} color="#86EFAC" />
                            </View>
                            <Text style={styles.kpiLabel}>Ingresos por visitas</Text>
                            <Text style={styles.kpiValue}>R$ {money(weekStats.perVisitGross)}</Text>
                            <Text style={styles.kpiHint}>
                                Real R$ {money(perVisitProfit)} - {weekStats.visited} visitados
                            </Text>
                        </View>

                        <View style={styles.metricCard}>
                            <View style={styles.metricIconBlue}>
                                <Ionicons name="calendar-outline" size={16} color="#93C5FD" />
                            </View>
                            <Text style={styles.kpiLabel}>Suscripciones</Text>
                            <Text style={styles.kpiValue}>R$ {money(weekStats.subscriptionGross)}</Text>
                            <Text style={styles.kpiHint}>
                                Real R$ {money(subscriptionProfit)} - {weekStats.subscriptionPaidUsers}/{weekStats.weeklySubscriptionUsers} pagadas
                            </Text>
                        </View>

                        <View style={styles.metricCard}>
                            <View style={styles.metricIconPurple}>
                                <Ionicons name="wallet-outline" size={16} color="#C4B5FD" />
                            </View>
                            <Text style={styles.kpiLabel}>Inversion total</Text>
                            <Text style={styles.kpiValue}>R$ {money(totalInvestment)}</Text>
                            <Text style={styles.kpiHint}>
                                Visitas R$ {money(perVisitInvestment)} - Subs R$ {money(weekStats.subscriptionCost)}
                            </Text>
                        </View>

                        <View style={styles.metricCard}>
                            <View style={styles.metricIconAmber}>
                                <Ionicons name="alert-circle-outline" size={16} color="#FBBF24" />
                            </View>
                            <Text style={styles.kpiLabel}>Pendientes</Text>
                            <Text style={styles.kpiValue}>{weekStats.subscriptionUnpaidUsers}</Text>
                            <Text style={styles.kpiHint}>
                                {paidSubscriptionRate == null ? "Sin usuarios semanales" : `${paidSubscriptionRate.toFixed(0)}% pago semanal`}
                            </Text>
                        </View>
                    </View>

                    {/* Charts PRO (diario semana actual) */}
                    <View style={styles.card}>
                        <View style={styles.cardTopRow}>
                            <Text style={styles.cardTitle}>Rendimiento</Text>

                            <View style={styles.miniLegend}>
                                <View style={[styles.legendDot, styles.dotGross]} />
                                <Text style={styles.legendText}>R$</Text>
                                <View style={[styles.legendDot, styles.dotVisited]} />
                                <Text style={styles.legendText}>Visitas</Text>
                            </View>
                        </View>

                        <View style={styles.chartBlock}>
                            <Text style={styles.cardSub}>Ingresos por visitas por dia</Text>
                            <View style={styles.svgCard}>
                                <ProBarChart
                                    values={chartValuesGross}
                                    labels={chartLabels}
                                    theme={chartTheme}
                                    barWidth={CHART_CFG.barWidth}
                                />
                            </View>
                        </View>

                        <View style={styles.chartBlock}>
                            <Text style={styles.cardSub}>Visitados por día</Text>
                            <View style={styles.svgCard}>
                                <ProLineChart
                                    values={chartValuesVisited}
                                    labels={chartLabels}
                                    theme={warnTheme}
                                    strokeWidth={CHART_CFG.lineStrokeWidth}
                                    dotRadius={CHART_CFG.dotRadius}
                                    showDots
                                />
                            </View>
                        </View>
                    </View>

                    {/* HISTORIAL: solo meses activos, semanas ocultas por defecto */}
                    <View style={styles.card}>
                        <View style={styles.historyHeaderStatic}>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text style={styles.cardTitle}>Historial</Text>
                                <Text style={styles.cardSub}>
                                    Meses activos con desglose semanal al tocar
                                </Text>

                                <View style={styles.rangeControls}>
                                    <Pressable
                                        onPress={() => setWeeksRange(1)}
                                        style={({ pressed }) => [styles.rangeBtn, pressed && styles.pressed]}
                                    >
                                        <Text style={styles.rangeBtnText}>Actual</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={() => setWeeksRange((prev) => prev + 4)}
                                        style={({ pressed }) => [styles.rangeBtn, pressed && styles.pressed]}
                                    >
                                        <Text style={styles.rangeBtnText}>+4 sem</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={() => setWeeksRange((prev) => prev + 12)}
                                        style={({ pressed }) => [styles.rangeBtn, pressed && styles.pressed]}
                                    >
                                        <Text style={styles.rangeBtnText}>+12 sem</Text>
                                    </Pressable>
                                </View>

                                {historyErr ? <Text style={styles.errText}>Historial: {historyErr}</Text> : null}
                            </View>

                            <View style={styles.historyRight}>
                                <View style={styles.weekPill}>
                                    <Ionicons name="time-outline" size={14} color={COLORS.muted} />
                                    <Text style={styles.weekPillText}>{weeksRange} sem</Text>
                                </View>
                            </View>
                        </View>
                        <View style={styles.chartBlock}>
                            <Text style={styles.cardSub}>Ganancia real por mes activo</Text>
                            <View style={styles.svgCard}>
                                <ProLineChart
                                    values={monthlyRealValues}
                                    labels={monthlyLabels}
                                    theme={realTheme}
                                    strokeWidth={CHART_CFG.lineStrokeWidth}
                                    dotRadius={CHART_CFG.dotRadius}
                                    showDots
                                    xMode="labels"
                                    tooltipItems={monthlyTooltipItems}
                                />
                            </View>
                        </View>

                        <View style={{ gap: 10 }}>
                            {activeMonths
                                .slice()
                                .reverse()
                                .map((month) => {
                                    const monthTone =
                                        month.real > 0 ? "pos" : month.real < 0 ? "neg" : "neutral";
                                    const isOpen = !!expandedMonths[month.monthKey];

                                    return (
                                        <View key={month.monthKey} style={styles.monthGroup}>
                                            <Pressable
                                                onPress={() => toggleMonth(month.monthKey)}
                                                style={({ pressed }) => [
                                                    styles.monthRow,
                                                    pressed && styles.pressed,
                                                ]}
                                            >
                                                <View style={{ flex: 1, gap: 4 }}>
                                                    <View style={styles.monthTopLine}>
                                                        <Text style={styles.monthRowTitle}>
                                                            {month.labelLong}
                                                        </Text>

                                                        <View style={styles.monthMiniMeta}>
                                                            <Text style={styles.monthMiniMetaText}>
                                                                {month.weeks.length} sem
                                                            </Text>
                                                        </View>
                                                    </View>

                                                    <Text style={styles.weekRowSub} numberOfLines={1}>
                                                        {month.visited} visitados · {month.rejected} rechazados ·
                                                        Visitas R$ {money(month.perVisitGross)} - Subs R$ {money(month.subscriptionGross)} - Inv R$ {money(month.inv)}
                                                    </Text>
                                                </View>

                                                <View style={styles.monthRight}>
                                                    <View
                                                        style={[
                                                            styles.weekRealPill,
                                                            monthTone === "pos"
                                                                ? styles.weekRealPos
                                                                : monthTone === "neg"
                                                                    ? styles.weekRealNeg
                                                                    : styles.weekRealNeu,
                                                        ]}
                                                    >
                                                        <Text style={styles.weekRealText}>
                                                            R$ {money(month.real)}
                                                        </Text>
                                                        <Text style={styles.weekRealSmall}>
                                                            {month.roi == null
                                                                ? "ROI —"
                                                                : `${month.roi.toFixed(0)}%`}
                                                        </Text>
                                                    </View>

                                                    <View style={styles.monthChevron}>
                                                        <Ionicons
                                                            name={isOpen ? "chevron-up" : "chevron-down"}
                                                            size={18}
                                                            color="rgba(255,255,255,0.72)"
                                                        />
                                                    </View>
                                                </View>
                                            </Pressable>

                                            {isOpen ? (
                                                <View style={styles.monthWeeksWrap}>
                                                    {month.weeks
                                                        .slice()
                                                        .reverse()
                                                        .map((w) => {
                                                            const tone =
                                                                w.real > 0
                                                                    ? "pos"
                                                                    : w.real < 0
                                                                        ? "neg"
                                                                        : "neutral";

                                                            return (
                                                                <View key={w.startKey} style={styles.weekRow}>
                                                                    <View style={{ flex: 1, gap: 2 }}>
                                                                        <Text style={styles.weekRowTitle}>
                                                                            {w.startKey} → {w.endKey}
                                                                        </Text>
                                                                        <Text
                                                                            style={styles.weekRowSub}
                                                                            numberOfLines={1}
                                                                        >
                                                                            {w.visited} visitados · {w.rejected} rechazados ·
                                                                            Visitas R$ {money(w.perVisitGross)} - Subs R$ {money(w.subscriptionGross)} - Inv R$ {money(w.inv)}
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
                                                                        <Text style={styles.weekRealText}>
                                                                            R$ {money(w.real)}
                                                                        </Text>
                                                                        <Text style={styles.weekRealSmall}>
                                                                            {w.roi == null
                                                                                ? "ROI —"
                                                                                : `${w.roi.toFixed(0)}%`}
                                                                        </Text>
                                                                    </View>
                                                                </View>
                                                            );
                                                        })}
                                                </View>
                                            ) : null}
                                        </View>
                                    );
                                })}
                        </View>
                    </View>

                    {/* debug opcional */}
                    {/* <Text style={{ color: "#fff" }}>{JSON.stringify(allocations, null, 2)}</Text> */}
                </ScrollView>
            </AdminBackground>
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
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },
    content: { padding: 16, gap: 12 },

    header: { flexDirection: "row", alignItems: "center", gap: 10 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    title: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
    sub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    strong: { color: COLORS.text, fontWeight: "900" },
    errText: { marginTop: 6, color: "#FCA5A5", fontSize: 12, fontWeight: "900" },

    iconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
    },

    heroCard: {
        backgroundColor: "rgba(15,23,42,0.92)",
        borderWidth: 1,
        borderColor: "rgba(96,165,250,0.20)",
        borderRadius: 18,
        padding: 14,
        gap: 12,
    },
    heroTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    heroValue: {
        color: COLORS.text,
        fontSize: 30,
        fontWeight: "900",
    },
    heroMetaRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
    heroMetaChip: {
        minHeight: 42,
        minWidth: 86,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.04)",
        paddingHorizontal: 10,
        justifyContent: "center",
        gap: 2,
    },
    heroMetaChipWide: {
        flex: 1,
        minHeight: 42,
        minWidth: 132,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.04)",
        paddingHorizontal: 10,
        justifyContent: "center",
        gap: 2,
    },
    heroMetaLabel: {
        color: COLORS.muted,
        fontSize: 10,
        fontWeight: "900",
    },
    heroMetaValue: {
        color: COLORS.text,
        fontSize: 12,
        fontWeight: "900",
    },

    breakdownGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },
    metricCard: {
        flexGrow: 1,
        flexBasis: "47%",
        minWidth: 150,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 16,
        padding: 12,
        gap: 6,
    },
    metricIconGreen: {
        width: 32,
        height: 32,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(34,197,94,0.10)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.20)",
    },
    metricIconBlue: {
        width: 32,
        height: 32,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(96,165,250,0.10)",
        borderWidth: 1,
        borderColor: "rgba(96,165,250,0.20)",
    },
    metricIconPurple: {
        width: 32,
        height: 32,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(196,181,253,0.10)",
        borderWidth: 1,
        borderColor: "rgba(196,181,253,0.20)",
    },
    metricIconAmber: {
        width: 32,
        height: 32,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(251,191,36,0.10)",
        borderWidth: 1,
        borderColor: "rgba(251,191,36,0.20)",
    },

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
    kpiTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },

    kpiLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    kpiValue: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
    valuePos: { color: "#86EFAC" },
    valueNeg: { color: "#FCA5A5" },

    kpiHint: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.9 },
    kpiHint2: { color: COLORS.muted, fontSize: 11, fontWeight: "800", opacity: 0.85 },

    kpiHintRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    tapHint: {
        width: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.9,
    },

    perfPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 26,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
    },
    perfPillPos: {
        backgroundColor: "rgba(34,197,94,0.12)",
        borderColor: "rgba(34,197,94,0.30)",
    },
    perfPillNeg: {
        backgroundColor: "rgba(248,113,113,0.12)",
        borderColor: "rgba(248,113,113,0.30)",
    },
    perfPillNeutral: {
        backgroundColor: "rgba(255,255,255,0.04)",
        borderColor: "rgba(255,255,255,0.10)",
    },
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
    cardTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    cardTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
    cardSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.92 },

    miniLegend: { flexDirection: "row", alignItems: "center", gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 99 },
    dotGross: { backgroundColor: "rgba(34,197,94,0.75)" },
    dotVisited: { backgroundColor: "rgba(251,191,36,0.75)" },
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

    historyHeaderStatic: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    historyRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },

    monthGroup: { gap: 8 },
    monthRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        backgroundColor: "rgba(255,255,255,0.04)",
    },
    monthTopLine: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    monthRowTitle: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    monthMiniMeta: {
        height: 22,
        paddingHorizontal: 8,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    monthMiniMetaText: {
        color: COLORS.muted,
        fontSize: 10,
        fontWeight: "900",
    },
    monthRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    monthChevron: {
        width: 28,
        height: 28,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },

    monthWeeksWrap: {
        gap: 8,
        paddingLeft: 12,
        borderLeftWidth: 1,
        borderLeftColor: "rgba(255,255,255,0.08)",
        marginLeft: 8,
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
    weekRowSub: {
        color: "rgba(255,255,255,0.55)",
        fontWeight: "800",
        fontSize: 11,
    },

    weekRealPill: {
        width: 108,
        borderRadius: 14,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        alignItems: "flex-end",
        justifyContent: "center",
    },
    weekRealPos: {
        backgroundColor: "rgba(34,197,94,0.12)",
        borderColor: "rgba(34,197,94,0.28)",
    },
    weekRealNeg: {
        backgroundColor: "rgba(248,113,113,0.12)",
        borderColor: "rgba(248,113,113,0.28)",
    },
    weekRealNeu: {
        backgroundColor: "rgba(255,255,255,0.04)",
        borderColor: "rgba(255,255,255,0.10)",
    },
    weekRealText: { color: COLORS.text, fontWeight: "900", fontSize: 12 },
    weekRealSmall: {
        color: "rgba(255,255,255,0.55)",
        fontWeight: "900",
        fontSize: 10,
        marginTop: 2,
    },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    rangeControls: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 6,
    },

    rangeBtn: {
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
    },

    rangeBtnText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "900",
    },
});


