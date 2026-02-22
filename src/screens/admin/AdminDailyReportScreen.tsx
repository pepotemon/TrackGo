import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { subscribeAdminClients } from "../../data/repositories/clientsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, UserDoc } from "../../types/models";

function startOfTodayMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

type Row = {
    userId: string;
    name: string;
    email?: string;

    ratePerVisit: number;

    assignedTotal: number;
    pending: number;

    visitedToday: number;
    rejectedToday: number;

    amountToday: number; // ✅ money today
};

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

function safeNumber(n: any, fallback = 0) {
    return typeof n === "number" && isFinite(n) ? n : fallback;
}

function getRatePerVisit(u: UserDoc) {
    // compat: ratePerVisit (nuevo) o visitFee (legacy)
    const anyU: any = u as any;
    return safeNumber(anyU.ratePerVisit ?? anyU.visitFee, 0);
}

function money(n: number) {
    const v = Number.isFinite(n) ? n : 0;
    return v.toFixed(2);
}

export default function AdminDailyReportScreen() {
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    // UI
    const [q, setQ] = useState("");

    useEffect(() => {
        const unsub = subscribeAdminClients(setClients);
        return () => unsub();
    }, []);

    const reloadUsers = async () => {
        setUsersLoading(true);
        try {
            const u = await listUsers("user");
            setUsers(u);
        } finally {
            setUsersLoading(false);
        }
    };

    useEffect(() => {
        reloadUsers();
    }, []);

    const todayStart = useMemo(() => startOfTodayMs(), []);

    const rows: Row[] = useMemo(() => {
        const byUser: Record<string, Row> = {};

        // init con users
        for (const u of users) {
            const rate = getRatePerVisit(u);

            byUser[u.id] = {
                userId: u.id,
                name: u.name,
                email: u.email,
                ratePerVisit: rate,

                assignedTotal: 0,
                pending: 0,
                visitedToday: 0,
                rejectedToday: 0,

                amountToday: 0,
            };
        }

        // recorrer clientes y sumar métricas
        for (const c of clients) {
            const uid = c.assignedTo;
            if (!uid) continue;

            if (!byUser[uid]) {
                byUser[uid] = {
                    userId: uid,
                    name: "(sin perfil)",
                    email: "",
                    ratePerVisit: 0,

                    assignedTotal: 0,
                    pending: 0,
                    visitedToday: 0,
                    rejectedToday: 0,

                    amountToday: 0,
                };
            }

            const row = byUser[uid];
            row.assignedTotal += 1;

            if (c.status === "pending") row.pending += 1;

            const statusAt = (c.statusAt ?? 0) as number;
            const isToday = statusAt >= todayStart;

            if (isToday && c.status === "visited") row.visitedToday += 1;
            if (isToday && c.status === "rejected") row.rejectedToday += 1;
        }

        // calcular dinero hoy por usuario
        for (const r of Object.values(byUser)) {
            r.amountToday = r.visitedToday * (r.ratePerVisit ?? 0);
        }

        const all = Object.values(byUser);

        // filtro por búsqueda
        const qt = q.trim().toLowerCase();
        const filtered = !qt
            ? all
            : all.filter((r) => {
                const hay = `${safeText(r.name)} ${safeText(r.email)}`;
                return hay.includes(qt);
            });

        // orden: más completados hoy primero
        return filtered.sort(
            (a, b) =>
                b.visitedToday + b.rejectedToday - (a.visitedToday + a.rejectedToday)
        );
    }, [clients, users, todayStart, q]);

    const totals = useMemo(() => {
        return rows.reduce(
            (acc, r) => {
                acc.assignedTotal += r.assignedTotal;
                acc.pending += r.pending;
                acc.visitedToday += r.visitedToday;
                acc.rejectedToday += r.rejectedToday;
                acc.amountToday += r.amountToday;
                return acc;
            },
            {
                assignedTotal: 0,
                pending: 0,
                visitedToday: 0,
                rejectedToday: 0,
                amountToday: 0,
            }
        );
    }, [rows]);

    const doneToday = totals.visitedToday + totals.rejectedToday;

    const copy = async (text: string) => {
        await Clipboard.setStringAsync(text);
    };

    const IconBtn = ({
        icon,
        onPress,
        disabled,
        label,
    }: {
        icon: any;
        onPress: () => void;
        disabled?: boolean;
        label: string;
    }) => {
        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                style={({ pressed }) => [
                    styles.iconBtn,
                    pressed && !disabled && styles.iconBtnPressed,
                    disabled && styles.iconBtnDisabled,
                ]}
                accessibilityLabel={label}
            >
                <Ionicons name={icon} size={18} color={COLORS.text} />
            </Pressable>
        );
    };

    const MetricPill = ({
        icon,
        label,
        value,
        tone,
    }: {
        icon: any;
        label: string;
        value: number;
        tone: "ok" | "bad" | "warn" | "neutral";
    }) => {
        const st =
            tone === "ok"
                ? styles.pillOk
                : tone === "bad"
                    ? styles.pillBad
                    : tone === "warn"
                        ? styles.pillWarn
                        : styles.pillNeutral;

        const tx =
            tone === "ok"
                ? styles.pillTextOk
                : tone === "bad"
                    ? styles.pillTextBad
                    : tone === "warn"
                        ? styles.pillTextWarn
                        : styles.pillTextNeutral;

        return (
            <View style={[styles.metricPill, st]}>
                <Ionicons name={icon} size={14} color={tx.color as any} />
                <Text style={[styles.metricPillText, tx]}>
                    {label}: <Text style={styles.metricStrong}>{value}</Text>
                </Text>
            </View>
        );
    };

    const ProgressBar = ({ done, total }: { done: number; total: number }) => {
        const pct = total <= 0 ? 0 : Math.max(0, Math.min(1, done / total));
        return (
            <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar
                barStyle="light-content"
                translucent={false}
                backgroundColor={COLORS.bg}
            />

            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 8) }]}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.hTitle}>Resumen de hoy</Text>

                    <Text style={styles.hSub}>
                        Completados hoy{" "}
                        <Text style={styles.hStrong}>{doneToday}</Text> /{" "}
                        <Text style={styles.hStrong}>{totals.assignedTotal}</Text>
                    </Text>
                </View>

                {/* ✅ dinero SOLO HOY */}
                <View style={styles.moneyPill}>
                    <Text style={styles.moneyTop}>Hoy R$ {money(totals.amountToday)}</Text>
                    <Text style={styles.moneySub}>{totals.visitedToday} visitados</Text>
                </View>

                <IconBtn
                    icon={usersLoading ? "sync" : "refresh-outline"}
                    label="Refrescar usuarios"
                    onPress={reloadUsers}
                    disabled={usersLoading}
                />
            </View>

            {/* Totals pills */}
            <View style={styles.totalsRow}>
                <MetricPill
                    icon="checkmark-circle-outline"
                    label="Visitados"
                    value={totals.visitedToday}
                    tone="ok"
                />
                <MetricPill
                    icon="close-circle-outline"
                    label="Rechazados"
                    value={totals.rejectedToday}
                    tone="bad"
                />
                <MetricPill
                    icon="time-outline"
                    label="Pendientes"
                    value={totals.pending}
                    tone="warn"
                />
                <MetricPill
                    icon="people-outline"
                    label="Asignados"
                    value={totals.assignedTotal}
                    tone="neutral"
                />
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar cobrador (nombre / email)…"
                    placeholderTextColor={COLORS.muted}
                    style={styles.searchInput}
                />
                {!!q ? (
                    <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                        <Ionicons name="close" size={18} color={COLORS.text} />
                    </Pressable>
                ) : null}
            </View>

            <FlatList
                data={rows}
                keyExtractor={(r) => r.userId}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => {
                    const done = item.visitedToday + item.rejectedToday;
                    const total = item.assignedTotal;
                    const pct = total <= 0 ? 0 : Math.round((done / total) * 100);

                    return (
                        <View style={styles.card}>
                            <View style={styles.cardTop}>
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={styles.userName} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                    {item.email ? (
                                        <Text style={styles.userEmail} numberOfLines={1}>
                                            {item.email}
                                        </Text>
                                    ) : (
                                        <Text style={styles.userEmailMuted}>(sin email)</Text>
                                    )}
                                </View>

                                <View style={{ alignItems: "flex-end", gap: 6 }}>
                                    <View style={styles.pctPill}>
                                        <Text style={styles.pctText}>{pct}%</Text>
                                    </View>

                                    <View style={styles.amountPill}>
                                        <Text style={styles.amountText}>R$ {money(item.amountToday)}</Text>
                                    </View>
                                </View>
                            </View>

                            <ProgressBar done={done} total={Math.max(1, total)} />

                            <View style={styles.metricsRow}>
                                <View style={[styles.smallPill, styles.smallOk]}>
                                    <Text style={[styles.smallPillText, styles.smallOkText]}>
                                        Vis {item.visitedToday}
                                    </Text>
                                </View>
                                <View style={[styles.smallPill, styles.smallBad]}>
                                    <Text style={[styles.smallPillText, styles.smallBadText]}>
                                        Rech {item.rejectedToday}
                                    </Text>
                                </View>
                                <View style={[styles.smallPill, styles.smallWarn]}>
                                    <Text style={[styles.smallPillText, styles.smallWarnText]}>
                                        Pend {item.pending}
                                    </Text>
                                </View>
                                <View style={[styles.smallPill, styles.smallNeutral]}>
                                    <Text style={[styles.smallPillText, styles.smallNeutralText]}>
                                        Asig {item.assignedTotal}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.actionsRow}>
                                <View style={styles.ratePill}>
                                    <Ionicons name="cash-outline" size={14} color={COLORS.muted} />
                                    <Text style={styles.rateText}>
                                        Tarifa R$ {money(item.ratePerVisit)}
                                    </Text>
                                </View>

                                <IconBtn
                                    icon="mail-outline"
                                    label="Copiar email"
                                    disabled={!item.email}
                                    onPress={() => copy(item.email ?? "")}
                                />
                            </View>
                        </View>
                    );
                }}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="analytics-outline" size={24} color={COLORS.muted} />
                        <Text style={styles.emptyText}>
                            {q.trim() ? "No hay resultados con ese filtro." : "No hay datos aún."}
                        </Text>
                    </View>
                }
            />
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
    primary: "#2563EB",
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
    hTitle: {
        color: COLORS.text,
        fontSize: 22,
        fontWeight: "900",
        letterSpacing: 0.5,
    },
    hSub: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        marginTop: 4,
    },
    hStrong: { color: COLORS.text, fontWeight: "900" },

    moneyPill: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "flex-end",
        justifyContent: "center",
        minWidth: 140,
    },
    moneyTop: { color: COLORS.text, fontSize: 12, fontWeight: "900" },
    moneySub: { color: COLORS.muted, fontSize: 11, fontWeight: "900", marginTop: 2 },

    totalsRow: {
        paddingHorizontal: 16,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 10,
    },
    metricPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        height: 34,
        borderRadius: 999,
        borderWidth: 1,
    },
    metricPillText: { color: COLORS.text, fontSize: 12, fontWeight: "900" },
    metricStrong: { color: COLORS.text, fontWeight: "900" },

    pillOk: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.30)" },
    pillBad: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.30)" },
    pillWarn: { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.30)" },
    pillNeutral: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" },

    pillTextOk: { color: "#86EFAC" },
    pillTextBad: { color: "#FCA5A5" },
    pillTextWarn: { color: "#FDE68A" },
    pillTextNeutral: { color: COLORS.text },

    searchWrap: {
        marginHorizontal: 16,
        marginBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 16,
        paddingHorizontal: 12,
        height: 48,
    },
    searchInput: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "700" },
    clearBtn: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 10,
    },
    cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
    userName: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    userEmail: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    userEmailMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.7 },

    pctPill: {
        minWidth: 54,
        height: 30,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(37,99,235,0.14)",
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.35)",
    },
    pctText: { color: "#93C5FD", fontWeight: "900", fontSize: 12 },

    amountPill: {
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(34,197,94,0.10)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.30)",
        alignItems: "center",
        justifyContent: "center",
    },
    amountText: { color: "#86EFAC", fontWeight: "900", fontSize: 12 },

    progressTrack: {
        height: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: "rgba(34,197,94,0.55)" },

    metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    smallPill: { height: 30, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
    smallPillText: { fontSize: 12, fontWeight: "900" },

    smallOk: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.30)" },
    smallOkText: { color: "#86EFAC" },

    smallBad: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.30)" },
    smallBadText: { color: "#FCA5A5" },

    smallWarn: { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.30)" },
    smallWarnText: { color: "#FDE68A" },

    smallNeutral: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" },
    smallNeutralText: { color: COLORS.text },

    actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 2 },
    ratePill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    rateText: { color: COLORS.text, opacity: 0.9, fontSize: 12, fontWeight: "900" },

    iconBtn: {
        width: 44,
        height: 44,
        borderRadius: 16,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    iconBtnPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },
    iconBtnDisabled: { opacity: 0.5 },

    empty: { marginTop: 40, alignItems: "center", gap: 10 },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900" },
});