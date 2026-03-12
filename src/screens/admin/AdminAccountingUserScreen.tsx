// src/screens/admin/AdminAccountingUserScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Modal,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AdminBackground from "../../components/admin/AdminBackground";

import { subscribeAdminClients } from "../../data/repositories/clientsRepo";
import { subscribeDailyEventsByRange } from "../../data/repositories/dailyEventsRepo";
import {
    subscribeWeeklyInvestment,
    type WeeklyInvestmentAllocations,
    type WeeklyInvestmentGroup,
} from "../../data/repositories/investmentsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, DailyEventDoc, UserDoc } from "../../types/models";

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

type MetricMode = "gross" | "assigned" | "real";

type RowItem = {
    id: string;
    title: string;
    subtitle: string;
    memberNames: string[];
    memberIds: string[];
    visits: number;
    gross: number;
    assigned: number;
    avgRate: number;
    shared: boolean;
    real: number;
    roi: number | null;
};

type MemberBreakdown = {
    userId: string;
    name: string;
    email: string;
    visits: number;
    gross: number;
    assigned: number;
    real: number;
    rate: number;
};

type DetailSection = {
    id: string;
    title: string;
    subtitle: string;
    visits: number;
    gross: number;
    assigned: number;
    real: number;
    roi: number | null;
    members: MemberBreakdown[];
};

function clamp2(n: number) {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function safeNumber(n: any): number {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
}

function money(n: number) {
    const v = Number.isFinite(n) ? n : 0;
    return v.toFixed(2);
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
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export default function AdminAccountingUserScreen() {
    const insets = useSafeAreaInsets();

    const params = useLocalSearchParams<{
        weekStartKey?: string;
        weekEndKey?: string;
    }>();

    const weekStartKey = useMemo(
        () => String(params.weekStartKey ?? "").trim(),
        [params.weekStartKey]
    );
    const weekEndKey = useMemo(
        () => String(params.weekEndKey ?? "").trim(),
        [params.weekEndKey]
    );

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [weekEvents, setWeekEvents] = useState<DailyEventDoc[]>([]);
    const [weekErr, setWeekErr] = useState<string | null>(null);

    const [weekAmount, setWeekAmount] = useState<number>(0);
    const [allocations, setAllocations] = useState<WeeklyInvestmentAllocations>({});
    const [groups, setGroups] = useState<WeeklyInvestmentGroup[]>([]);

    const [detailOpen, setDetailOpen] = useState(false);
    const [detailMode, setDetailMode] = useState<MetricMode>("real");
    const [detailTargetId, setDetailTargetId] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            const u = await listUsers("user");
            setUsers(u ?? []);
        })();
    }, []);

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

    useEffect(() => {
        if (!weekStartKey) return;

        const unsub = subscribeWeeklyInvestment(
            weekStartKey,
            (doc) => {
                const amt = clamp2(safeNumber((doc as any)?.amount ?? 0));
                const alloc = ((doc as any)?.allocations ?? {}) as WeeklyInvestmentAllocations;
                const rawGroups = Array.isArray((doc as any)?.groups)
                    ? ((doc as any)?.groups as WeeklyInvestmentGroup[])
                    : [];

                setWeekAmount(amt);
                setAllocations(alloc && typeof alloc === "object" ? alloc : {});
                setGroups(rawGroups);
            },
            () => {
                setWeekAmount(0);
                setAllocations({});
                setGroups([]);
            }
        );

        return () => unsub();
    }, [weekStartKey]);

    useEffect(() => {
        if (!weekStartKey || !weekEndKey) return;

        setWeekErr(null);

        const unsub = subscribeDailyEventsByRange(
            weekStartKey,
            weekEndKey,
            (list) => {
                setWeekErr(null);
                setWeekEvents(list ?? []);
            },
            (err) => {
                const msg = `${err?.code ?? "error"}: ${err?.message ?? ""}`.trim();
                console.log("[AdminAccountingUser] week events err:", err?.code, err?.message);
                setWeekErr(msg || "permission-denied");
            }
        );

        return () => unsub();
    }, [weekStartKey, weekEndKey]);

    const shouldCountEvent = useCallback(
        (e: DailyEventDoc) => {
            const cid = (e as any)?.clientId;
            if (!cid) return false;
            const c = clientById.get(cid);
            if (!c) return false;
            return c.status === (e as any).type;
        },
        [clientById]
    );

    const normalizedGroups = useMemo(() => {
        const out: WeeklyInvestmentGroup[] = [];

        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const id = String(g?.id ?? `group_${i + 1}`).trim() || `group_${i + 1}`;
            const name = String(g?.name ?? "").trim() || `Grupo ${i + 1}`;
            const amount = clamp2(safeNumber(g?.amount ?? 0));
            const userIds = Array.from(
                new Set(
                    (Array.isArray(g?.userIds) ? g.userIds : [])
                        .map((x) => String(x).trim())
                        .filter(Boolean)
                )
            );

            if (!userIds.length) continue;

            out.push({
                id,
                name,
                amount,
                userIds,
            });
        }

        return out;
    }, [groups]);

    const visitedEventsByUser = useMemo(() => {
        const latest = latestEventByClient(weekEvents);
        const map = new Map<
            string,
            {
                visits: number;
                gross: number;
                rate: number;
            }
        >();

        for (const e of latest.values()) {
            if (!shouldCountEvent(e)) continue;
            if ((e as any).type !== "visited") continue;

            const uid = String((e as any)?.userId ?? "").trim();
            if (!uid) continue;

            const prev = map.get(uid) ?? { visits: 0, gross: 0, rate: getRatePerVisit(userById.get(uid)) };
            const rate = getRatePerVisit(userById.get(uid));

            map.set(uid, {
                visits: prev.visits + 1,
                gross: clamp2(prev.gross + rate),
                rate,
            });
        }

        return map;
    }, [weekEvents, shouldCountEvent, userById]);

    const rows = useMemo<RowItem[]>(() => {
        const latest = latestEventByClient(weekEvents);

        if (normalizedGroups.length > 0) {
            const byGroupId = new Map<string, Omit<RowItem, "real" | "roi">>();
            const userToGroupId = new Map<string, string>();

            for (const g of normalizedGroups) {
                for (const uid of g.userIds) {
                    if (!userToGroupId.has(uid)) userToGroupId.set(uid, g.id);
                }

                const memberNames = g.userIds.map((uid) => {
                    const u = userById.get(uid);
                    return u?.name?.trim() || u?.email?.trim() || uid;
                });

                const rates = g.userIds.map((uid) => getRatePerVisit(userById.get(uid)));
                const avgRate =
                    rates.length > 0 ? clamp2(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;

                byGroupId.set(g.id, {
                    id: g.id,
                    title: g.name,
                    subtitle: memberNames.join(", "),
                    memberNames,
                    memberIds: g.userIds,
                    visits: 0,
                    gross: 0,
                    assigned: clamp2(safeNumber(g.amount)),
                    avgRate,
                    shared: g.userIds.length > 1,
                });
            }

            for (const e of latest.values()) {
                if (!shouldCountEvent(e)) continue;
                if ((e as any).type !== "visited") continue;

                const uid = String((e as any)?.userId ?? "").trim();
                if (!uid) continue;

                const gid = userToGroupId.get(uid);
                if (!gid) continue;

                const row = byGroupId.get(gid);
                if (!row) continue;

                row.visits += 1;
                row.gross = clamp2(row.gross + getRatePerVisit(userById.get(uid)));
            }

            return Array.from(byGroupId.values())
                .map((r) => {
                    const real = clamp2(r.gross - r.assigned);
                    const roi = r.assigned > 0 ? (real / r.assigned) * 100 : null;
                    return { ...r, real, roi };
                })
                .sort((a, b) => {
                    const aScore = a.roi ?? Number.NEGATIVE_INFINITY;
                    const bScore = b.roi ?? Number.NEGATIVE_INFINITY;
                    if (bScore !== aScore) return bScore - aScore;
                    if (b.real !== a.real) return b.real - a.real;
                    if (b.gross !== a.gross) return b.gross - a.gross;
                    return b.visits - a.visits;
                });
        }

        const base: RowItem[] = users.map((u) => {
            const assigned = clamp2(safeNumber((allocations as any)?.[u.id] ?? 0));
            const visits = visitedEventsByUser.get(u.id)?.visits ?? 0;
            const gross = clamp2(visitedEventsByUser.get(u.id)?.gross ?? 0);
            const real = clamp2(gross - assigned);
            const roi = assigned > 0 ? (real / assigned) * 100 : null;

            return {
                id: u.id,
                title: u?.name?.trim() || u?.email?.trim() || "Usuario",
                subtitle: u?.email?.trim() || "",
                memberNames: [u?.name?.trim() || u?.email?.trim() || "Usuario"],
                memberIds: [u.id],
                avgRate: getRatePerVisit(u),
                visits,
                gross,
                assigned,
                shared: false,
                real,
                roi,
            };
        });

        return base.sort((a, b) => {
            const aScore = a.roi ?? Number.NEGATIVE_INFINITY;
            const bScore = b.roi ?? Number.NEGATIVE_INFINITY;
            if (bScore !== aScore) return bScore - aScore;
            if (b.real !== a.real) return b.real - a.real;
            if (b.gross !== a.gross) return b.gross - a.gross;
            return b.visits - a.visits;
        });
    }, [weekEvents, shouldCountEvent, normalizedGroups, userById, users, allocations, visitedEventsByUser]);

    const rowsById = useMemo(() => {
        const m = new Map<string, RowItem>();
        for (const r of rows) m.set(r.id, r);
        return m;
    }, [rows]);

    const totals = useMemo(() => {
        const visits = rows.reduce((a, b) => a + (b.visits || 0), 0);
        const gross = clamp2(rows.reduce((a, b) => a + (b.gross || 0), 0));
        const assigned = clamp2(rows.reduce((a, b) => a + (b.assigned || 0), 0));
        const real = clamp2(gross - assigned);
        const roi = assigned > 0 ? (real / assigned) * 100 : null;
        return { visits, gross, assigned, real, roi };
    }, [rows]);

    const guardInvalid = !weekStartKey || !weekEndKey;
    const usingGroups = normalizedGroups.length > 0;

    const buildMemberBreakdown = useCallback(
        (row: RowItem): MemberBreakdown[] => {
            const memberIds = row.memberIds ?? [];
            const rawAssigneds = memberIds.map((uid) =>
                clamp2(safeNumber((allocations as any)?.[uid] ?? 0))
            );
            const assignedKnown = rawAssigneds.some((v) => v > 0);
            const evenSplit =
                memberIds.length > 0 ? clamp2((row.assigned || 0) / memberIds.length) : 0;

            return memberIds
                .map((uid, idx) => {
                    const u = userById.get(uid);
                    const name = u?.name?.trim() || u?.email?.trim() || uid;
                    const email = u?.email?.trim() || "";
                    const rate = getRatePerVisit(u);
                    const visits = visitedEventsByUser.get(uid)?.visits ?? 0;
                    const gross = clamp2(visitedEventsByUser.get(uid)?.gross ?? 0);
                    const assigned = assignedKnown ? rawAssigneds[idx] : evenSplit;
                    const real = clamp2(gross - assigned);

                    return {
                        userId: uid,
                        name,
                        email,
                        visits,
                        gross,
                        assigned,
                        real,
                        rate,
                    };
                })
                .sort((a, b) => {
                    if (b.real !== a.real) return b.real - a.real;
                    if (b.gross !== a.gross) return b.gross - a.gross;
                    return b.visits - a.visits;
                });
        },
        [allocations, userById, visitedEventsByUser]
    );

    const detailSections = useMemo<DetailSection[]>(() => {
        const sourceRows = detailTargetId ? [rowsById.get(detailTargetId)].filter(Boolean) as RowItem[] : rows;

        return sourceRows.map((row) => ({
            id: row.id,
            title: row.title,
            subtitle: row.subtitle,
            visits: row.visits,
            gross: row.gross,
            assigned: row.assigned,
            real: row.real,
            roi: row.roi,
            members: buildMemberBreakdown(row),
        }));
    }, [detailTargetId, rowsById, rows, buildMemberBreakdown]);

    const openMetricModal = (mode: MetricMode, rowId?: string | null) => {
        setDetailMode(mode);
        setDetailTargetId(rowId ?? null);
        setDetailOpen(true);
    };

    const closeMetricModal = () => {
        setDetailOpen(false);
        setDetailTargetId(null);
    };

    const detailTitle = useMemo(() => {
        const target = detailTargetId ? rowsById.get(detailTargetId) : null;

        if (detailMode === "real") {
            return target ? `Ganancia real · ${target.title}` : "Ganancia real total";
        }
        if (detailMode === "gross") {
            return target ? `Ganancia bruta · ${target.title}` : "Ganancia bruta total";
        }
        return target ? `Asignado · ${target.title}` : "Asignado total";
    }, [detailMode, detailTargetId, rowsById]);

    const detailSub = useMemo(() => {
        const target = detailTargetId ? rowsById.get(detailTargetId) : null;

        if (target) {
            if (detailMode === "real") {
                return `${target.visits} visitados · R$ ${money(target.real)}`;
            }
            if (detailMode === "gross") {
                return `${target.visits} visitados · R$ ${money(target.gross)}`;
            }
            return `${target.memberIds.length} usuario${target.memberIds.length === 1 ? "" : "s"} · R$ ${money(target.assigned)}`;
        }

        if (detailMode === "real") {
            return `${totals.visits} visitados · R$ ${money(totals.real)}`;
        }
        if (detailMode === "gross") {
            return `${totals.visits} visitados · R$ ${money(totals.gross)}`;
        }
        return `${rows.length} ${usingGroups ? "grupo" : "usuario"}${rows.length === 1 ? "" : "s"} · R$ ${money(totals.assigned)}`;
    }, [detailMode, detailTargetId, rowsById, totals, rows.length, usingGroups]);

    const MetricMini = ({
        label,
        value,
        tone,
    }: {
        label: string;
        value: string;
        tone?: "pos" | "neg" | "neu" | "info";
    }) => (
        <View
            style={[
                styles.modalMetricChip,
                tone === "pos"
                    ? styles.modalMetricChipPos
                    : tone === "neg"
                        ? styles.modalMetricChipNeg
                        : tone === "info"
                            ? styles.modalMetricChipInfo
                            : null,
            ]}
        >
            <Text style={styles.modalMetricLabel}>{label}</Text>
            <Text
                style={[
                    styles.modalMetricValue,
                    tone === "pos"
                        ? styles.pos
                        : tone === "neg"
                            ? styles.neg
                            : tone === "info"
                                ? styles.infoText
                                : null,
                ]}
            >
                {value}
            </Text>
        </View>
    );

    const renderMemberCard = (m: MemberBreakdown) => {
        return (
            <View key={m.userId} style={styles.memberCard}>
                <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.memberName} numberOfLines={1}>
                        {m.name}
                    </Text>
                    {!!m.email ? (
                        <Text style={styles.memberSub} numberOfLines={1}>
                            {m.email}
                        </Text>
                    ) : null}
                    <Text style={styles.memberSub}>
                        {m.visits} visitados · tarifa R$ {money(m.rate)}
                    </Text>
                </View>

                <View style={styles.memberRight}>
                    {detailMode === "real" ? (
                        <>
                            <MetricMini label="Bruta" value={`R$ ${money(m.gross)}`} />
                            <MetricMini label="Asign." value={`R$ ${money(m.assigned)}`} />
                            <MetricMini
                                label="Real"
                                value={`R$ ${money(m.real)}`}
                                tone={m.real > 0 ? "pos" : m.real < 0 ? "neg" : "neu"}
                            />
                        </>
                    ) : detailMode === "gross" ? (
                        <>
                            <MetricMini label="Visitas" value={`${m.visits}`} tone="info" />
                            <MetricMini label="Bruta" value={`R$ ${money(m.gross)}`} />
                        </>
                    ) : (
                        <>
                            <MetricMini label="Asign." value={`R$ ${money(m.assigned)}`} tone="info" />
                            <MetricMini label="Visitas" value={`${m.visits}`} />
                        </>
                    )}
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView
            style={styles.safe}
            edges={["left", "right", "bottom"]}
        >
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
            <AdminBackground>
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                        paddingTop: 6,
                        paddingBottom: Math.max(20, insets.bottom + 12),
                    }}
                >
                    <View style={styles.card}>
                        <Text style={styles.title}>
                            {usingGroups ? "Contabilidad por grupo" : "Contabilidad por usuario"}
                        </Text>

                        <Text style={styles.sub}>
                            Semana <Text style={styles.strong}>{weekStartKey || "—"}</Text> →{" "}
                            <Text style={styles.strong}>{weekEndKey || "—"}</Text>
                        </Text>

                        {guardInvalid ? (
                            <Text style={styles.errText}>
                                Falta weekStartKey/weekEndKey. Revisa el router.push params.
                            </Text>
                        ) : null}

                        {weekErr ? <Text style={styles.errText}>Eventos: {weekErr}</Text> : null}

                        <View style={styles.modePill}>
                            <Ionicons
                                name={usingGroups ? "people-outline" : "person-outline"}
                                size={14}
                                color={COLORS.muted}
                            />
                            <Text style={styles.modePillText}>
                                {usingGroups ? "Modo compartido por grupo" : "Modo individual por usuario"}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.kpiRow}>
                        <Pressable
                            onPress={() => openMetricModal("gross")}
                            style={({ pressed }) => [styles.kpiCard, pressed && styles.pressed]}
                        >
                            <Text style={styles.kpiLabel}>Bruta</Text>
                            <Text style={styles.kpiValue}>R$ {money(totals.gross)}</Text>
                            <Text style={styles.kpiHint}>{totals.visits} visitados</Text>
                        </Pressable>

                        <Pressable
                            onPress={() => openMetricModal("assigned")}
                            style={({ pressed }) => [styles.kpiCard, pressed && styles.pressed]}
                        >
                            <Text style={styles.kpiLabel}>Asignado</Text>
                            <Text style={styles.kpiValue}>R$ {money(totals.assigned)}</Text>
                            <Text style={styles.kpiHint}>Total doc: R$ {money(weekAmount)}</Text>
                        </Pressable>

                        <Pressable
                            onPress={() => openMetricModal("real")}
                            style={({ pressed }) => [styles.kpiCard, pressed && styles.pressed]}
                        >
                            <Text
                                style={[
                                    styles.kpiLabel,
                                    totals.real > 0 ? styles.pos : totals.real < 0 ? styles.neg : null,
                                ]}
                            >
                                Real
                            </Text>
                            <Text
                                style={[
                                    styles.kpiValue,
                                    totals.real > 0 ? styles.pos : totals.real < 0 ? styles.neg : null,
                                ]}
                            >
                                R$ {money(totals.real)}
                            </Text>
                            <Text style={styles.kpiHint}>
                                ROI: {totals.roi == null ? "—" : `${totals.roi.toFixed(0)}%`}
                            </Text>
                        </Pressable>
                    </View>

                    <View style={styles.card}>
                        <View style={styles.listHeader}>
                            <Text style={styles.cardTitle}>
                                {usingGroups ? "Grupos / ciudades / campañas" : "Usuarios"}
                            </Text>
                        </View>

                        {rows.length === 0 ? (
                            <Text style={styles.hint}>No hay datos todavía para esta semana.</Text>
                        ) : (
                            <View style={{ gap: 10 }}>
                                {rows.map((r, idx) => {
                                    const tone = r.real > 0 ? "pos" : r.real < 0 ? "neg" : "neu";
                                    const isTop = idx === 0;

                                    return (
                                        <View
                                            key={r.id}
                                            style={[
                                                styles.userRow,
                                                isTop ? styles.userRowTop : null,
                                            ]}
                                        >
                                            <View style={styles.rankBadge}>
                                                <Text style={styles.rankBadgeText}>#{idx + 1}</Text>
                                            </View>

                                            <View style={{ flex: 1, gap: 2 }}>
                                                <Text style={styles.userName}>{r.title}</Text>

                                                <View style={styles.badgesRow}>
                                                    {r.shared ? (
                                                        <View style={styles.sharedBadge}>
                                                            <Ionicons name="people-outline" size={12} color={COLORS.text} />
                                                            <Text style={styles.sharedBadgeText}>Compartido</Text>
                                                        </View>
                                                    ) : null}

                                                    {isTop ? (
                                                        <View style={styles.bestBadge}>
                                                            <Ionicons name="trophy" size={12} color={COLORS.text} />
                                                            <Text style={styles.bestBadgeText}>Mejor</Text>
                                                        </View>
                                                    ) : null}
                                                </View>

                                                <Text style={styles.userSub} numberOfLines={2}>
                                                    {r.subtitle || (r.memberIds[0] ?? "")}
                                                </Text>

                                                <Text style={styles.userMeta}>
                                                    {r.visits} visitados · tarifa prom. R$ {money(r.avgRate)}
                                                </Text>

                                                {r.memberNames.length > 1 ? (
                                                    <Text style={styles.membersText} numberOfLines={3}>
                                                        Miembros: {r.memberNames.join(", ")}
                                                    </Text>
                                                ) : null}
                                            </View>

                                            <View style={styles.userPills}>
                                                <Pressable
                                                    onPress={() => openMetricModal("gross", r.id)}
                                                    style={({ pressed }) => [
                                                        styles.pill,
                                                        pressed && styles.pressed,
                                                    ]}
                                                >
                                                    <Text style={styles.pillLabel}>Bruta</Text>
                                                    <Text style={styles.pillValue}>R$ {money(r.gross)}</Text>
                                                </Pressable>

                                                <Pressable
                                                    onPress={() => openMetricModal("assigned", r.id)}
                                                    style={({ pressed }) => [
                                                        styles.pill,
                                                        pressed && styles.pressed,
                                                    ]}
                                                >
                                                    <Text style={styles.pillLabel}>Asign</Text>
                                                    <Text style={styles.pillValue}>R$ {money(r.assigned)}</Text>
                                                </Pressable>

                                                <View style={styles.roiPill}>
                                                    <Text style={styles.roiLabel}>ROI</Text>
                                                    <Text
                                                        style={[
                                                            styles.roiValue,
                                                            (r.roi ?? 0) > 0 ? styles.pos : (r.roi ?? 0) < 0 ? styles.neg : null,
                                                        ]}
                                                    >
                                                        {r.roi == null ? "—" : `${r.roi.toFixed(0)}%`}
                                                    </Text>
                                                </View>

                                                <Pressable
                                                    onPress={() => openMetricModal("real", r.id)}
                                                    style={({ pressed }) => [
                                                        styles.realPill,
                                                        tone === "pos"
                                                            ? styles.realPos
                                                            : tone === "neg"
                                                                ? styles.realNeg
                                                                : styles.realNeu,
                                                        pressed && styles.pressed,
                                                    ]}
                                                >
                                                    <Text style={styles.realValue}>R$ {money(r.real)}</Text>
                                                    <Text style={styles.realSub}>Ganancia real</Text>
                                                </Pressable>
                                            </View>
                                        </View>
                                    );
                                })}
                            </View>
                        )}
                    </View>
                </ScrollView>

                <Modal
                    visible={detailOpen}
                    transparent
                    animationType="fade"
                    onRequestClose={closeMetricModal}
                >
                    <Pressable style={styles.modalBackdrop} onPress={closeMetricModal} />

                    <View
                        style={[
                            styles.modalCard,
                            { paddingBottom: Math.max(12, insets.bottom + 10) },
                        ]}
                    >
                        <View style={styles.modalHeader}>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text style={styles.modalTitle}>{detailTitle}</Text>
                                <Text style={styles.modalSub}>{detailSub}</Text>
                            </View>

                            <Pressable
                                onPress={closeMetricModal}
                                style={({ pressed }) => [
                                    styles.modalClose,
                                    pressed && styles.modalClosePressed,
                                ]}
                            >
                                <Ionicons name="close" size={16} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <FlatList
                            data={detailSections}
                            keyExtractor={(item) => item.id}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{ paddingTop: 4, paddingBottom: 8, gap: 8 }}
                            renderItem={({ item: section }) => (
                                <View style={styles.modalSection}>
                                    <View style={styles.modalSectionTop}>
                                        <View style={{ flex: 1, gap: 2 }}>
                                            <Text style={styles.modalSectionTitle} numberOfLines={1}>
                                                {section.title}
                                            </Text>
                                            {!!section.subtitle ? (
                                                <Text style={styles.modalSectionSub} numberOfLines={2}>
                                                    {section.subtitle}
                                                </Text>
                                            ) : null}
                                        </View>

                                        <View style={styles.modalSectionCount}>
                                            <Text style={styles.modalSectionCountText}>
                                                {section.members.length}
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.modalSectionMetrics}>
                                        <MetricMini label="Visitas" value={`${section.visits}`} tone="info" />
                                        <MetricMini label="Bruta" value={`R$ ${money(section.gross)}`} />
                                        <MetricMini label="Asign." value={`R$ ${money(section.assigned)}`} />
                                        <MetricMini
                                            label="Real"
                                            value={`R$ ${money(section.real)}`}
                                            tone={section.real > 0 ? "pos" : section.real < 0 ? "neg" : "neu"}
                                        />
                                    </View>

                                    <View style={{ gap: 8, marginTop: 8 }}>
                                        {section.members.map(renderMemberCard)}
                                    </View>
                                </View>
                            )}
                            ListEmptyComponent={
                                <View style={styles.modalEmpty}>
                                    <Ionicons name="analytics-outline" size={20} color={COLORS.muted} />
                                    <Text style={styles.modalEmptyText}>No hay información para mostrar.</Text>
                                </View>
                            }
                        />
                    </View>
                </Modal>
            </AdminBackground>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
        paddingHorizontal: 16,
    },

    pressed: {
        transform: [{ scale: 0.985 }],
        opacity: 0.96,
    },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 8,
        marginBottom: 12,
    },

    title: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
    sub: { color: COLORS.muted, fontWeight: "800", fontSize: 12 },
    strong: { color: COLORS.text, fontWeight: "900" },
    hint: { color: "rgba(255,255,255,0.70)", fontWeight: "700", fontSize: 12, lineHeight: 18 },
    errText: { marginTop: 6, color: "#FCA5A5", fontSize: 12, fontWeight: "900" },

    modePill: {
        marginTop: 4,
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    modePillText: { color: COLORS.muted, fontWeight: "900", fontSize: 11 },

    kpiRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
    kpiCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        gap: 4,
    },
    kpiLabel: { color: COLORS.muted, fontWeight: "900", fontSize: 11 },
    kpiValue: { color: COLORS.text, fontWeight: "900", fontSize: 16 },
    kpiHint: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 11 },

    pos: { color: "#86EFAC" },
    neg: { color: "#FCA5A5" },
    infoText: { color: "#93C5FD" },

    listHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    cardTitle: { color: COLORS.text, fontWeight: "900", fontSize: 14 },

    userRow: {
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    userRowTop: {
        borderColor: "rgba(96,165,250,0.28)",
        backgroundColor: "rgba(96,165,250,0.06)",
    },

    rankBadge: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    rankBadgeText: { color: COLORS.text, fontWeight: "900", fontSize: 11 },

    userName: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 14,
    },
    userSub: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 11 },
    userMeta: { marginTop: 6, color: "rgba(255,255,255,0.60)", fontWeight: "800", fontSize: 11 },
    membersText: { marginTop: 4, color: "rgba(255,255,255,0.48)", fontWeight: "800", fontSize: 10 },

    sharedBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        height: 22,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.14)",
    },
    sharedBadgeText: { color: COLORS.text, fontWeight: "900", fontSize: 10 },

    bestBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        height: 22,
        borderRadius: 999,
        backgroundColor: "rgba(34,197,94,0.14)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.24)",
    },
    bestBadgeText: { color: COLORS.text, fontWeight: "900", fontSize: 10 },

    userPills: { alignItems: "flex-end", gap: 8 },
    pill: {
        width: 90,
        borderRadius: 14,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        backgroundColor: "rgba(255,255,255,0.04)",
        gap: 2,
        alignItems: "flex-end",
    },
    pillLabel: { color: "rgba(255,255,255,0.55)", fontWeight: "900", fontSize: 10 },
    pillValue: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

    roiPill: {
        width: 90,
        borderRadius: 14,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: "rgba(96,165,250,0.24)",
        backgroundColor: "rgba(96,165,250,0.08)",
        gap: 2,
        alignItems: "flex-end",
    },
    roiLabel: { color: "#93C5FD", fontWeight: "900", fontSize: 10 },
    roiValue: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

    realPill: {
        width: 90,
        borderRadius: 14,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        gap: 2,
        alignItems: "flex-end",
    },
    realPos: { backgroundColor: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.28)" },
    realNeg: { backgroundColor: "rgba(248,113,113,0.12)", borderColor: "rgba(248,113,113,0.28)" },
    realNeu: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)" },
    realValue: { color: COLORS.text, fontWeight: "900", fontSize: 12 },
    realSub: { color: "rgba(255,255,255,0.55)", fontWeight: "900", fontSize: 10 },

    badgesRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 4,
    },

    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.56)",
    },
    modalCard: {
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 14,
        backgroundColor: COLORS.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
        gap: 10,
        maxHeight: "84%",
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    modalTitle: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },
    modalSub: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
    },
    modalClose: {
        width: 34,
        height: 34,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.09)",
        alignItems: "center",
        justifyContent: "center",
    },
    modalClosePressed: {
        transform: [{ scale: 0.97 }],
        opacity: 0.96,
    },

    modalSection: {
        borderRadius: 15,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        backgroundColor: "rgba(255,255,255,0.025)",
        padding: 10,
    },
    modalSectionTop: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    modalSectionTitle: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    modalSectionSub: {
        color: COLORS.muted,
        fontWeight: "700",
        fontSize: 11,
    },
    modalSectionCount: {
        minWidth: 30,
        height: 24,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.09)",
        paddingHorizontal: 8,
    },
    modalSectionCountText: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 11,
    },
    modalSectionMetrics: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 8,
    },

    modalMetricChip: {
        minHeight: 26,
        borderRadius: 999,
        paddingHorizontal: 8,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.045)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    modalMetricChipPos: {
        backgroundColor: "rgba(34,197,94,0.08)",
        borderColor: "rgba(34,197,94,0.18)",
    },
    modalMetricChipNeg: {
        backgroundColor: "rgba(248,113,113,0.08)",
        borderColor: "rgba(248,113,113,0.18)",
    },
    modalMetricChipInfo: {
        backgroundColor: "rgba(96,165,250,0.08)",
        borderColor: "rgba(96,165,250,0.18)",
    },
    modalMetricLabel: {
        color: COLORS.muted,
        fontSize: 10,
        fontWeight: "900",
    },
    modalMetricValue: {
        color: COLORS.text,
        fontSize: 10,
        fontWeight: "900",
    },

    memberCard: {
        flexDirection: "row",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        backgroundColor: "rgba(255,255,255,0.025)",
        alignItems: "center",
    },
    memberName: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    memberSub: {
        color: COLORS.muted,
        fontWeight: "700",
        fontSize: 11,
    },
    memberRight: {
        alignItems: "flex-end",
        gap: 6,
    },

    modalEmpty: {
        marginTop: 14,
        alignItems: "center",
        gap: 8,
        paddingVertical: 8,
    },
    modalEmptyText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },
});