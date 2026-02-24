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
import { subscribeDailyEventsByRange } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, DailyEventDoc, UserDoc } from "../../types/models";

// ----------------------
// DayKey helpers (igual que AdminHome)
// ----------------------
function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function todayKey() {
    return dayKeyFromDate(new Date());
}

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

function safeNumber(n: any, fallback = 0) {
    return typeof n === "number" && isFinite(n) ? n : fallback;
}

function getRatePerVisit(u: UserDoc) {
    const anyU: any = u as any;
    return safeNumber(anyU.ratePerVisit ?? anyU.visitFee, 0);
}

function money(n: number) {
    const v = Number.isFinite(n) ? n : 0;
    return v.toFixed(2);
}

// ✅ dedupe: último evento por cliente (por createdAt)
function latestEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();
    for (const e of events) {
        if (!e?.clientId) continue;
        if (e.type !== "visited" && e.type !== "rejected" && e.type !== "pending") continue;

        const prev = map.get(e.clientId);
        const eMs = typeof (e as any)?.createdAt === "number" ? ((e as any).createdAt as number) : 0;
        const pMs = prev && typeof (prev as any)?.createdAt === "number" ? ((prev as any).createdAt as number) : 0;

        if (!prev || eMs >= pMs) map.set(e.clientId, e);
    }
    return map;
}

type Row = {
    userId: string;
    name: string;
    email?: string;

    ratePerVisit: number;

    assignedTotal: number; // ✅ estado actual
    pending: number;       // ✅ estado actual

    visitedToday: number;  // ✅ desde dailyEvents (hoy)
    rejectedToday: number; // ✅ desde dailyEvents (hoy)

    amountToday: number;
};

export default function AdminDailyReportScreen() {
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [todayEvents, setTodayEvents] = useState<DailyEventDoc[]>([]);
    const [q, setQ] = useState("");

    // clients realtime
    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);

    // events realtime HOY (igual que AdminHome)
    useEffect(() => {
        const tk = todayKey();
        const unsub = subscribeDailyEventsByRange(
            tk,
            tk,
            (list) => setTodayEvents(list ?? []),
            (err) => console.log("[AdminDailyReport] today events err:", err?.code, err?.message)
        );
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

    // ✅ hoy: último evento por cliente
    const lastEventTodayByClient = useMemo(() => {
        return latestEventByClient(todayEvents);
    }, [todayEvents]);

    const rows: Row[] = useMemo(() => {
        const byUser: Record<string, Row> = {};

        // base: users
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

        // 1) assignedTotal + pending desde CLIENTS (estado actual, no histórico)
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

            // ✅ pendientes: siempre el estado actual del cliente
            if (c.status === "pending") row.pending += 1;
        }

        // 2) visitedToday / rejectedToday desde DAILY EVENTS (hoy) dedupe por cliente
        for (const ev of lastEventTodayByClient.values()) {
            const uid = ev.userId;
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

            if (ev.type === "visited") byUser[uid].visitedToday += 1;
            if (ev.type === "rejected") byUser[uid].rejectedToday += 1;
        }

        // 3) amount
        for (const r of Object.values(byUser)) {
            r.amountToday = r.visitedToday * (r.ratePerVisit ?? 0);
        }

        const all = Object.values(byUser);

        // filter
        const qt = q.trim().toLowerCase();
        const filtered = !qt
            ? all
            : all.filter((r) => {
                const hay = `${safeText(r.name)} ${safeText(r.email)}`;
                return hay.includes(qt);
            });

        // sort: más actividad hoy
        return filtered.sort(
            (a, b) =>
                b.visitedToday + b.rejectedToday - (a.visitedToday + a.rejectedToday)
        );
    }, [clients, users, lastEventTodayByClient, q]);

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

    const StatIcon = ({
        icon,
        color,
        value,
        label,
    }: {
        icon: any;
        color: string;
        value: number;
        label: string;
    }) => {
        return (
            <View style={styles.statIconWrap} accessibilityLabel={`${label}: ${value}`}>
                <View style={[styles.statIcon, { borderColor: color + "55", backgroundColor: color + "12" }]}>
                    <Ionicons name={icon} size={16} color={color} />
                </View>
                <Text style={styles.statValue}>{value}</Text>
            </View>
        );
    };

    const ProgressBar = ({ done, total }: { done: number; total: number }) => {
        // ✅ clamp
        const pct = total <= 0 ? 0 : Math.max(0, Math.min(1, done / total));
        return (
            <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            {/* Compact header */}
            <View style={[styles.header, { paddingTop: 0 }]}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.hTitle}>Hoy</Text>
                    <Text style={styles.hSub}>
                        <Text style={styles.hStrong}>{doneToday}</Text>
                        <Text style={styles.hMuted}> / </Text>
                        <Text style={styles.hMuted}>{totals.assignedTotal}</Text>
                        <Text style={styles.hMuted}> completados</Text>
                    </Text>
                </View>

                <View style={styles.moneyChip}>
                    <Ionicons name="cash-outline" size={14} color={COLORS.money} />
                    <Text style={styles.moneyChipText}>R$ {money(totals.amountToday)}</Text>
                </View>

                <IconBtn
                    icon={usersLoading ? "sync" : "refresh-outline"}
                    label="Refrescar usuarios"
                    onPress={reloadUsers}
                    disabled={usersLoading}
                />
            </View>

            {/* Icons-only summary row (no labels) */}
            <View style={styles.statsRow}>
                <StatIcon icon="checkmark-circle-outline" color={COLORS.visited} value={totals.visitedToday} label="Visitados" />
                <StatIcon icon="close-circle-outline" color={COLORS.rejected} value={totals.rejectedToday} label="Rechazados" />
                <StatIcon icon="time-outline" color={COLORS.pending} value={totals.pending} label="Pendientes" />
                <StatIcon icon="people-outline" color={COLORS.muted2} value={totals.assignedTotal} label="Asignados" />
            </View>

            {/* Search (compact) */}
            <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar (nombre / email)…"
                    placeholderTextColor={COLORS.muted}
                    style={styles.searchInput}
                    autoCorrect={false}
                    autoCapitalize="none"
                />
                {!!q ? (
                    <Pressable onPress={() => setQ("")} style={styles.clearBtn} accessibilityLabel="Limpiar búsqueda">
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
                    const pct = total <= 0 ? 0 : Math.round((Math.min(done, total) / total) * 100);

                    return (
                        <View style={styles.card}>
                            <View style={styles.cardTop}>
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={styles.userName} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                    {!!item.email ? (
                                        <Text style={styles.userEmail} numberOfLines={1}>
                                            {item.email}
                                        </Text>
                                    ) : (
                                        <Text style={styles.userEmailMuted} numberOfLines={1}>
                                            (sin email)
                                        </Text>
                                    )}
                                </View>

                                <View style={{ alignItems: "flex-end", gap: 8 }}>
                                    <View style={styles.pctPill}>
                                        <Ionicons name="stats-chart-outline" size={14} color={COLORS.primarySoft} />
                                        <Text style={styles.pctText}>{pct}%</Text>
                                    </View>

                                    <View style={styles.amountPill}>
                                        <Text style={styles.amountText}>R$ {money(item.amountToday)}</Text>
                                    </View>
                                </View>
                            </View>

                            <ProgressBar done={done} total={Math.max(1, total)} />

                            {/* Metrics row */}
                            <View style={styles.metricsRow}>
                                <View style={[styles.miniStat, styles.miniOk]}>
                                    <Ionicons name="checkmark" size={14} color={COLORS.visitedSoft} />
                                    <Text style={[styles.miniText, { color: COLORS.visitedSoft }]}>{item.visitedToday}</Text>
                                </View>

                                <View style={[styles.miniStat, styles.miniBad]}>
                                    <Ionicons name="close" size={14} color={COLORS.rejectedSoft} />
                                    <Text style={[styles.miniText, { color: COLORS.rejectedSoft }]}>{item.rejectedToday}</Text>
                                </View>

                                <View style={[styles.miniStat, styles.miniWarn]}>
                                    <Ionicons name="time" size={14} color={COLORS.pendingSoft} />
                                    <Text style={[styles.miniText, { color: COLORS.pendingSoft }]}>{item.pending}</Text>
                                </View>

                                <View style={[styles.miniStat, styles.miniNeutral]}>
                                    <Ionicons name="people" size={14} color={COLORS.text} />
                                    <Text style={[styles.miniText, { color: COLORS.text }]}>{item.assignedTotal}</Text>
                                </View>
                            </View>

                            <View style={styles.actionsRow}>
                                <View style={styles.rateChip}>
                                    <Ionicons name="cash-outline" size={14} color={COLORS.muted} />
                                    <Text style={styles.rateText}>R$ {money(item.ratePerVisit)}</Text>
                                    <Text style={styles.rateTextMuted}>/visita</Text>
                                </View>

                                <IconBtn icon="mail-outline" label="Copiar email" disabled={!item.email} onPress={() => copy(item.email ?? "")} />
                            </View>
                        </View>
                    );
                }}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="analytics-outline" size={24} color={COLORS.muted} />
                        <Text style={styles.emptyText}>{q.trim() ? "Sin resultados." : "Sin datos aún."}</Text>
                    </View>
                }
            />
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#0F172A",
    border: "rgba(255,255,255,0.08)",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    muted2: "#C7CEDA",

    visited: "#22C55E",
    rejected: "#F87171",
    pending: "#FBBF24",

    visitedSoft: "#86EFAC",
    rejectedSoft: "#FCA5A5",
    pendingSoft: "#FDE68A",

    primary: "#7C3AED",
    primarySoft: "#C4B5FD",
    money: "#A7F3D0",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    header: {
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    hTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.4 },
    hSub: { marginTop: 2, fontSize: 12, fontWeight: "800" },
    hStrong: { color: COLORS.text, fontWeight: "900" },
    hMuted: { color: COLORS.muted, fontWeight: "900" },

    moneyChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        height: 34,
        borderRadius: 999,
        backgroundColor: "rgba(167,243,208,0.10)",
        borderWidth: 1,
        borderColor: "rgba(167,243,208,0.22)",
    },
    moneyChipText: { color: COLORS.money, fontWeight: "900", fontSize: 12 },

    statsRow: {
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        gap: 10,
    },
    statIconWrap: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        height: 44,
        borderRadius: 16,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    statIcon: {
        width: 30,
        height: 30,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    statValue: { color: COLORS.text, fontWeight: "900", fontSize: 14 },

    searchWrap: {
        marginHorizontal: 16,
        marginBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 16,
        paddingHorizontal: 12,
        height: 46,
    },
    searchInput: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "700" },
    clearBtn: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
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
    userEmailMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.75 },

    pctPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minWidth: 64,
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(124,58,237,0.16)",
        borderWidth: 1,
        borderColor: "rgba(124,58,237,0.32)",
        justifyContent: "center",
    },
    pctText: { color: COLORS.primarySoft, fontWeight: "900", fontSize: 12 },

    amountPill: {
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(34,197,94,0.10)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.22)",
        alignItems: "center",
        justifyContent: "center",
    },
    amountText: { color: COLORS.visitedSoft, fontWeight: "900", fontSize: 12 },

    progressTrack: {
        height: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: "rgba(34,197,94,0.55)" },

    metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
    miniStat: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
    },
    miniText: { fontSize: 12, fontWeight: "900" },

    miniOk: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.22)" },
    miniBad: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.22)" },
    miniWarn: { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.22)" },
    miniNeutral: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.08)" },

    actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 2 },
    rateChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    rateText: { color: COLORS.text, opacity: 0.92, fontSize: 12, fontWeight: "900" },
    rateTextMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },

    iconBtn: {
        width: 44,
        height: 44,
        borderRadius: 16,
        backgroundColor: "rgba(255,255,255,0.04)",
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