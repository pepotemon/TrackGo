// src/screens/admin/AdminAccountingUserScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Pressable,
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

/** Último evento por clientId dentro del rango */
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
    const router = useRouter();
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

    // --- load users
    useEffect(() => {
        (async () => {
            const u = await listUsers("user");
            setUsers(u ?? []);
        })();
    }, []);

    // --- clients realtime (para filtro anti-inflado tipo AdminAccountingScreen)
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

    // --- subscribe weekly investment doc
    useEffect(() => {
        if (!weekStartKey) return;

        const unsub = subscribeWeeklyInvestment(
            weekStartKey,
            (doc) => {
                const amt = clamp2(safeNumber((doc as any)?.amount ?? 0));
                const alloc = ((doc as any)?.allocations ?? {}) as WeeklyInvestmentAllocations;

                setWeekAmount(amt);
                setAllocations(alloc && typeof alloc === "object" ? alloc : {});
            },
            () => {
                setWeekAmount(0);
                setAllocations({});
            }
        );

        return () => unsub();
    }, [weekStartKey]);

    // --- subscribe week events
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

    // mismo “anti-inflado” que en la pantalla principal:
    // solo contamos el último evento si coincide con el status actual del cliente
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

    const rows = useMemo(() => {
        // base: todos los users (para que salgan con 0)
        const base = users.map((u) => ({
            uid: u.id,
            name: u?.name?.trim() || u?.email?.trim() || "Usuario",
            email: u?.email?.trim() || "",
            rate: getRatePerVisit(u),
            visits: 0,
            gross: 0,
            assigned: clamp2(safeNumber((allocations as any)?.[u.id] ?? 0)),
        }));

        const byUid = new Map<string, (typeof base)[number]>();
        for (const r of base) byUid.set(r.uid, r);

        const latest = latestEventByClient(weekEvents);

        for (const e of latest.values()) {
            if (!shouldCountEvent(e)) continue;

            if ((e as any).type !== "visited") continue;

            const uid = (e as any)?.userId;
            if (!uid) continue;

            const r = byUid.get(uid);
            if (!r) continue;

            r.visits += 1;
            r.gross = clamp2(r.gross + r.rate);
        }

        return base
            .map((r) => {
                const real = clamp2(r.gross - r.assigned);
                const roi = r.assigned > 0 ? (real / r.assigned) * 100 : null;
                return { ...r, real, roi };
            })
            .sort((a, b) => b.real - a.real);
    }, [users, allocations, weekEvents, shouldCountEvent]);

    const totals = useMemo(() => {
        const visits = rows.reduce((a, b) => a + (b.visits || 0), 0);
        const gross = clamp2(rows.reduce((a, b) => a + (b.gross || 0), 0));
        const assigned = clamp2(rows.reduce((a, b) => a + (b.assigned || 0), 0));
        const real = clamp2(gross - assigned);
        const roi = assigned > 0 ? (real / assigned) * 100 : null;
        return { visits, gross, assigned, real, roi };
    }, [rows]);

    const guardInvalid = !weekStartKey || !weekEndKey;

    return (
        <SafeAreaView style={[styles.safe, { paddingBottom: Math.max(16, insets.bottom) }]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
                >
                    <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                    <Text style={styles.backText}>Volver</Text>
                </Pressable>

                <View style={{ flex: 1 }} />
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
            >
                <View style={styles.card}>
                    <Text style={styles.title}>Contabilidad por usuario</Text>

                    <Text style={styles.sub}>
                        Semana{" "}
                        <Text style={styles.strong}>{weekStartKey || "—"}</Text> →{" "}
                        <Text style={styles.strong}>{weekEndKey || "—"}</Text>
                    </Text>

                    {guardInvalid ? (
                        <Text style={styles.errText}>
                            Falta weekStartKey/weekEndKey. Revisa el router.push params.
                        </Text>
                    ) : null}

                    {weekErr ? (
                        <Text style={styles.errText}>Eventos: {weekErr}</Text>
                    ) : null}
                </View>

                {/* Totales */}
                <View style={styles.kpiRow}>
                    <View style={styles.kpiCard}>
                        <Text style={styles.kpiLabel}>Bruta</Text>
                        <Text style={styles.kpiValue}>R$ {money(totals.gross)}</Text>
                        <Text style={styles.kpiHint}>{totals.visits} visitados</Text>
                    </View>

                    <View style={styles.kpiCard}>
                        <Text style={styles.kpiLabel}>Asignado</Text>
                        <Text style={styles.kpiValue}>R$ {money(totals.assigned)}</Text>
                        <Text style={styles.kpiHint}>
                            Total doc: R$ {money(weekAmount)}
                        </Text>
                    </View>

                    <View style={styles.kpiCard}>
                        <Text style={styles.kpiLabel}>Real</Text>
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

                {/* Lista por usuario */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Usuarios</Text>

                    {rows.length === 0 ? (
                        <Text style={styles.hint}>No hay usuarios o no cargaron todavía.</Text>
                    ) : (
                        <View style={{ gap: 10 }}>
                            {rows.map((r) => {
                                const tone = r.real > 0 ? "pos" : r.real < 0 ? "neg" : "neu";
                                return (
                                    <View key={r.uid} style={styles.userRow}>
                                        <View style={{ flex: 1, gap: 2 }}>
                                            <Text style={styles.userName} numberOfLines={1}>
                                                {r.name}
                                            </Text>
                                            <Text style={styles.userSub} numberOfLines={1}>
                                                {r.email ? r.email : `ID: ${r.uid}`}
                                            </Text>

                                            <Text style={styles.userMeta}>
                                                {r.visits} visitados · tarifa R$ {money(r.rate)}
                                            </Text>
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
                                                <Text style={styles.realSub}>
                                                    {r.roi == null ? "ROI —" : `${r.roi.toFixed(0)}%`}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>

                <View style={styles.noteCard}>
                    <Ionicons name="information-circle-outline" size={18} color={COLORS.muted} />

                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg, padding: 16 },

    header: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
    backBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        height: 38,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    backText: { color: COLORS.text, fontWeight: "900" },

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
    userName: { color: COLORS.text, fontWeight: "900", fontSize: 13 },
    userSub: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 11 },
    userMeta: { marginTop: 6, color: "rgba(255,255,255,0.60)", fontWeight: "800", fontSize: 11 },

    userPills: { alignItems: "flex-end", gap: 8 },
    pill: {
        width: 110,
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

    realPill: {
        width: 110,
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

    noteCard: {
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        alignItems: "flex-start",
        marginBottom: 12,
    },
    noteText: { flex: 1, color: "rgba(255,255,255,0.65)", fontWeight: "700", fontSize: 12, lineHeight: 18 },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
});