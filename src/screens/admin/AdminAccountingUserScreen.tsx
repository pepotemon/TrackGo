// src/screens/admin/AdminAccountingUserScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

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

    const rows = useMemo(() => {
        const latest = latestEventByClient(weekEvents);

        if (normalizedGroups.length > 0) {
            const byGroupId = new Map<
                string,
                {
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
                }
            >();

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

        const base = users.map((u) => ({
            id: u.id,
            title: u?.name?.trim() || u?.email?.trim() || "Usuario",
            subtitle: u?.email?.trim() || "",
            memberNames: [u?.name?.trim() || u?.email?.trim() || "Usuario"],
            memberIds: [u.id],
            avgRate: getRatePerVisit(u),
            visits: 0,
            gross: 0,
            assigned: clamp2(safeNumber((allocations as any)?.[u.id] ?? 0)),
            shared: false,
        }));

        const byUid = new Map<string, (typeof base)[number]>();
        for (const r of base) byUid.set(r.id, r);

        for (const e of latest.values()) {
            if (!shouldCountEvent(e)) continue;
            if ((e as any).type !== "visited") continue;

            const uid = String((e as any)?.userId ?? "").trim();
            if (!uid) continue;

            const row = byUid.get(uid);
            if (!row) continue;

            row.visits += 1;
            row.gross = clamp2(row.gross + row.avgRate);
        }

        return base
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
    }, [weekEvents, shouldCountEvent, normalizedGroups, userById, users, allocations]);

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

    return (
        <SafeAreaView
            style={styles.safe}
            edges={["left", "right", "bottom"]}
        >
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

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
                    <View style={styles.kpiCard}>
                        <Text style={styles.kpiLabel}>Bruta</Text>
                        <Text style={styles.kpiValue}>R$ {money(totals.gross)}</Text>
                        <Text style={styles.kpiHint}>{totals.visits} visitados</Text>
                    </View>

                    <View style={styles.kpiCard}>
                        <Text style={styles.kpiLabel}>Asignado</Text>
                        <Text style={styles.kpiValue}>R$ {money(totals.assigned)}</Text>
                        <Text style={styles.kpiHint}>Total doc: R$ {money(weekAmount)}</Text>
                    </View>

                    <View style={styles.kpiCard}>
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
                    </View>
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
                                            <View style={styles.pill}>
                                                <Text style={styles.pillLabel}>Bruta</Text>
                                                <Text style={styles.pillValue}>R$ {money(r.gross)}</Text>
                                            </View>

                                            <View style={styles.pill}>
                                                <Text style={styles.pillLabel}>Asign</Text>
                                                <Text style={styles.pillValue}>R$ {money(r.assigned)}</Text>
                                            </View>

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

                                            <View
                                                style={[
                                                    styles.realPill,
                                                    tone === "pos"
                                                        ? styles.realPos
                                                        : tone === "neg"
                                                            ? styles.realNeg
                                                            : styles.realNeu,
                                                ]}
                                            >
                                                <Text style={styles.realValue}>R$ {money(r.real)}</Text>
                                                <Text style={styles.realSub}>Ganancia real</Text>
                                            </View>
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
        paddingHorizontal: 16,
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
        paddingHorizontal: 4,
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
});