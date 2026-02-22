import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Modal,
    Platform,
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
import { subscribeEarningsByRange, type EarningsSummary } from "../../data/repositories/earningsRepo";
import { listUsers } from "../../data/repositories/usersRepo";

import type { ClientDoc, DailyEventDoc, UserDoc } from "../../types/models";

// ----------------------
// Date helpers
// ----------------------
function formatDayKeyFromDate(dt: Date) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseDayKeyToDate(dayKey: string) {
    const t = dayKey.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date();
    const [yy, mm, dd] = t.split("-").map((x) => parseInt(x, 10));
    return new Date(yy, (mm || 1) - 1, dd || 1);
}

function isValidDayKey(s: string) {
    const t = s.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
    const [yy, mm, dd] = t.split("-").map((x) => parseInt(x, 10));
    if (mm < 1 || mm > 12) return false;
    if (dd < 1 || dd > 31) return false;
    return true;
}

function weekdayEsFromDayKey(dayKey: string) {
    const [y, m, d] = dayKey.split("-").map((x) => parseInt(x, 10));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const names = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    return names[dt.getDay()] ?? dayKey;
}

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

function money(n: number) {
    const v = Number.isFinite(n) ? n : 0;
    return v.toFixed(2);
}

/**
 * ✅ Semana local: Lunes 00:00 → Domingo 23:59 (en dayKeys inclusivo)
 * Retorna startKey (lunes) y endKey (domingo) en formato YYYY-MM-DD
 */
function weekRangeFromDate(date: Date) {
    const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = base.getDay(); // 0 dom, 1 lun...
    const diffToMonday = (day + 6) % 7; // lunes=0, martes=1, ..., domingo=6
    const monday = new Date(base);
    monday.setDate(base.getDate() - diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return {
        startKey: formatDayKeyFromDate(monday),
        endKey: formatDayKeyFromDate(sunday),
    };
}

// ----------------------
// Types
// ----------------------
type UserRow = {
    userId: string;
    name: string;
    email?: string;
    assigned: number;
    visited: number;
    rejected: number;
    pending: number;
};

type DayGroup = {
    dayKey: string;
    label: string;
    users: UserRow[];
    totals: { assigned: number; visited: number; rejected: number; pending: number };
};

export default function AdminWeeklyCloseScreen() {
    const insets = useSafeAreaInsets();

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [clients, setClients] = useState<ClientDoc[]>([]);

    // ✅ default: semana actual (lunes→domingo)
    const initialWeek = useMemo(() => weekRangeFromDate(new Date()), []);
    const [startKey, setStartKey] = useState(initialWeek.startKey);
    const [endKey, setEndKey] = useState(initialWeek.endKey);

    const [selectedUserId, setSelectedUserId] = useState<string>("ALL");

    // ✅ monetización real de la semana (clients.statusAt)
    const [earnings, setEarnings] = useState<EarningsSummary>({
        rows: [],
        totalVisited: 0,
        totalAmount: 0,
    });

    // UI
    const [qUser, setQUser] = useState("");
    const [expandedDay, setExpandedDay] = useState<string | null>(null);

    // Picker
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerTarget, setPickerTarget] = useState<"start" | "end">("start");
    const [pickerDate, setPickerDate] = useState<Date>(new Date());

    const openPicker = (target: "start" | "end") => {
        setPickerTarget(target);
        const base = target === "start" ? startKey : endKey;
        setPickerDate(parseDayKeyToDate(base));
        setPickerOpen(true);
    };

    const closePicker = () => setPickerOpen(false);

    const onPickerChange = (ev: DateTimePickerEvent, date?: Date) => {
        if (Platform.OS === "android") {
            if (ev.type === "dismissed") {
                setPickerOpen(false);
                return;
            }
            const d = date ?? pickerDate;
            setPickerOpen(false);

            const dk = formatDayKeyFromDate(d);

            if (pickerTarget === "start") {
                setStartKey(dk);
                if (dk > endKey) setEndKey(dk);
            } else {
                if (dk < startKey) setEndKey(startKey);
                else setEndKey(dk);
            }
            return;
        }

        if (date) setPickerDate(date);
    };

    const confirmPickerIOS = () => {
        const dk = formatDayKeyFromDate(pickerDate);

        if (pickerTarget === "start") {
            setStartKey(dk);
            if (dk > endKey) setEndKey(dk);
        } else {
            if (dk < startKey) setEndKey(startKey);
            else setEndKey(dk);
        }
        setPickerOpen(false);
    };

    // ----------------------
    // Data subscriptions
    // ----------------------
    useEffect(() => {
        (async () => {
            const u = await listUsers("user");
            setUsers(u);
        })();
    }, []);

    useEffect(() => {
        const unsub = subscribeAdminClients(setClients);
        return () => unsub();
    }, []);

    // ✅ Operativo: eventos por rango (para saber estado final del día por cliente)
    useEffect(() => {
        const s = startKey.trim();
        const e = endKey.trim();
        if (!isValidDayKey(s) || !isValidDayKey(e)) return;

        const unsub = subscribeDailyEventsByRange(s, e, setEvents);
        return () => unsub();
    }, [startKey, endKey]);

    // ✅ Dinero real: por clients.statusAt (NO dailyEvents)
    useEffect(() => {
        const s = startKey.trim();
        const e = endKey.trim();
        if (!isValidDayKey(s) || !isValidDayKey(e)) return;
        if (!users.length) return;

        const unsub = subscribeEarningsByRange(s, e, users, setEarnings);
        return () => unsub();
    }, [startKey, endKey, users]);

    const userInfoById = useMemo(() => {
        const m = new Map<string, { name: string; email?: string }>();
        for (const u of users) m.set(u.id, { name: u.name, email: u.email });
        return m;
    }, [users]);

    // último evento del día por cliente
    const lastEventByDayClient = useMemo(() => {
        const map = new Map<string, DailyEventDoc>();

        for (const e of events) {
            if (e.type !== "visited" && e.type !== "rejected" && e.type !== "pending") continue;
            if (!e.clientId || !e.dayKey) continue;

            const key = `${e.dayKey}|${e.clientId}`;
            const prev = map.get(key);

            if (!prev || (e.createdAt ?? 0) > (prev.createdAt ?? 0)) {
                map.set(key, e);
            }
        }

        return map;
    }, [events]);

    // ----------------------
    // Build day groups (operativo)
    // ----------------------
    const dayGroups: DayGroup[] = useMemo(() => {
        const s = startKey.trim();
        const e = endKey.trim();
        if (!isValidDayKey(s) || !isValidDayKey(e)) return [];

        const userFilter = selectedUserId === "ALL" ? null : selectedUserId;

        const byDay: Record<string, Record<string, { assigned: number; visited: number; rejected: number }>> = {};

        // 1) asignados por día (assignedDayKey)
        for (const c of clients) {
            const uid = c.assignedTo;
            const dk = (c as any).assignedDayKey as string | undefined;
            if (!uid || !dk) continue;

            if (dk < s || dk > e) continue;
            if (userFilter && uid !== userFilter) continue;

            if (!byDay[dk]) byDay[dk] = {};
            if (!byDay[dk][uid]) byDay[dk][uid] = { assigned: 0, visited: 0, rejected: 0 };
            byDay[dk][uid].assigned += 1;
        }

        // 2) estado final del día por cliente
        for (const ev of lastEventByDayClient.values()) {
            const dk = ev.dayKey;
            if (!dk) continue;
            if (dk < s || dk > e) continue;

            const uid = ev.userId;
            if (!uid) continue;
            if (userFilter && uid !== userFilter) continue;

            if (!byDay[dk]) byDay[dk] = {};
            if (!byDay[dk][uid]) byDay[dk][uid] = { assigned: 0, visited: 0, rejected: 0 };

            if (ev.type === "visited") byDay[dk][uid].visited += 1;
            if (ev.type === "rejected") byDay[dk][uid].rejected += 1;
        }

        const dayKeys = Object.keys(byDay).sort((a, b) => (a < b ? 1 : -1));

        return dayKeys.map((dk) => {
            const perUser = byDay[dk];

            const userRows: UserRow[] = Object.entries(perUser).map(([uid, c]) => {
                const info = userInfoById.get(uid);
                const pending = Math.max(0, c.assigned - (c.visited + c.rejected));

                return {
                    userId: uid,
                    name: info?.name ?? "(sin perfil)",
                    email: info?.email,
                    assigned: c.assigned,
                    visited: c.visited,
                    rejected: c.rejected,
                    pending,
                };
            });

            userRows.sort((a, b) => (b.visited + b.rejected) - (a.visited + a.rejected));

            const totals = userRows.reduce(
                (acc, r) => {
                    acc.assigned += r.assigned;
                    acc.visited += r.visited;
                    acc.rejected += r.rejected;
                    acc.pending += r.pending;
                    return acc;
                },
                { assigned: 0, visited: 0, rejected: 0, pending: 0 }
            );

            return {
                dayKey: dk,
                label: `${weekdayEsFromDayKey(dk)} · ${dk}`,
                users: userRows,
                totals,
            };
        });
    }, [clients, lastEventByDayClient, selectedUserId, startKey, endKey, userInfoById]);

    const globalTotals = useMemo(() => {
        return dayGroups.reduce(
            (acc, g) => {
                acc.assigned += g.totals.assigned;
                acc.visited += g.totals.visited;
                acc.rejected += g.totals.rejected;
                acc.pending += g.totals.pending;
                return acc;
            },
            { assigned: 0, visited: 0, rejected: 0, pending: 0 }
        );
    }, [dayGroups]);

    const usersFiltered = useMemo(() => {
        const qt = qUser.trim().toLowerCase();
        if (!qt) return users;
        return users.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, qUser]);

    // ----------------------
    // UI atoms
    // ----------------------
    const Chip = ({
        label,
        active,
        onPress,
    }: {
        label: string;
        active: boolean;
        onPress: () => void;
    }) => (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
        >
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {label}
            </Text>
        </Pressable>
    );

    const Pill = ({ text }: { text: string }) => (
        <View style={styles.pill}>
            <Text style={styles.pillText}>{text}</Text>
        </View>
    );

    const toggleDay = (dk: string) => setExpandedDay((prev) => (prev === dk ? null : dk));

    const setThisWeek = () => {
        const wk = weekRangeFromDate(new Date());
        setStartKey(wk.startKey);
        setEndKey(wk.endKey);
    };

    const validRange = isValidDayKey(startKey) && isValidDayKey(endKey);

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 8) }]}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Cierre semanal</Text>

                    <Text style={styles.subtitle}>
                        {startKey} → {endKey} · Asig <Text style={styles.strong}>{globalTotals.assigned}</Text> · V{" "}
                        <Text style={styles.strong}>{globalTotals.visited}</Text> · R{" "}
                        <Text style={styles.strong}>{globalTotals.rejected}</Text> · Pend{" "}
                        <Text style={styles.strong}>{globalTotals.pending}</Text>
                    </Text>
                </View>

                {/* ✅ pill minimalista con $ semanal */}
                <View style={styles.moneyPill}>
                    <Text style={styles.moneyPillText}>R$ {money(earnings.totalAmount)}</Text>
                    <Text style={styles.moneyPillSub}>{earnings.totalVisited} visits</Text>
                </View>

                <Pressable onPress={setThisWeek} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
                    <Ionicons name="calendar-outline" size={18} color={COLORS.text} />
                </Pressable>
            </View>

            {/* Range + Filters */}
            <View style={styles.card}>
                <View style={styles.cardTopRow}>
                    <Text style={styles.section}>Semana / Rango</Text>

                    <Pressable onPress={setThisWeek} style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]}>
                        <Ionicons name="refresh" size={16} color={COLORS.text} />
                        <Text style={styles.smallBtnText}>Esta semana</Text>
                    </Pressable>
                </View>

                <View style={styles.row2}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.label}>Inicio</Text>

                        <Pressable
                            onPress={() => openPicker("start")}
                            style={({ pressed }) => [styles.dateField, pressed && styles.pressed]}
                        >
                            <Ionicons name="calendar-outline" size={16} color={COLORS.muted} />
                            <Text style={styles.dateText}>{startKey}</Text>
                            <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
                        </Pressable>
                    </View>

                    <View style={{ flex: 1 }}>
                        <Text style={styles.label}>Fin</Text>

                        <Pressable
                            onPress={() => openPicker("end")}
                            style={({ pressed }) => [styles.dateField, pressed && styles.pressed]}
                        >
                            <Ionicons name="calendar-outline" size={16} color={COLORS.muted} />
                            <Text style={styles.dateText}>{endKey}</Text>
                            <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
                        </Pressable>
                    </View>
                </View>

                {!validRange ? <Text style={styles.warn}>Formato inválido. Usa YYYY-MM-DD.</Text> : null}

                <View style={{ height: 10 }} />

                <Text style={styles.section}>Usuario</Text>
                <View style={styles.searchMini}>
                    <Ionicons name="search-outline" size={16} color={COLORS.muted} />
                    <TextInput
                        value={qUser}
                        onChangeText={setQUser}
                        placeholder="Buscar por nombre o email…"
                        placeholderTextColor={COLORS.muted}
                        style={styles.searchMiniInput}
                    />
                    {!!qUser ? (
                        <Pressable onPress={() => setQUser("")} style={styles.clearMini}>
                            <Ionicons name="close" size={16} color={COLORS.text} />
                        </Pressable>
                    ) : null}
                </View>

                <View style={styles.chipsRow}>
                    <Chip label="Todos" active={selectedUserId === "ALL"} onPress={() => setSelectedUserId("ALL")} />
                    {usersFiltered.slice(0, 10).map((u) => (
                        <Chip key={u.id} label={u.name} active={selectedUserId === u.id} onPress={() => setSelectedUserId(u.id)} />
                    ))}
                </View>

                {usersFiltered.length > 10 ? (
                    <Text style={styles.hint}>Mostrando 10 usuarios. Usa la búsqueda para filtrar.</Text>
                ) : null}
            </View>

            {/* List */}
            <FlatList
                data={dayGroups}
                keyExtractor={(g) => g.dayKey}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => {
                    const isExpanded = expandedDay === item.dayKey;

                    return (
                        <View style={styles.dayCard}>
                            <Pressable onPress={() => toggleDay(item.dayKey)} style={({ pressed }) => [styles.dayTop, pressed && styles.pressed]}>
                                <View style={{ flex: 1, gap: 8 }}>
                                    <Text style={styles.dayTitle} numberOfLines={1}>
                                        {item.label}
                                    </Text>

                                    <View style={styles.pillsRow}>
                                        <Pill text={`Asig ${item.totals.assigned}`} />
                                        <Pill text={`V ${item.totals.visited}`} />
                                        <Pill text={`R ${item.totals.rejected}`} />
                                        <Pill text={`Pend ${item.totals.pending}`} />
                                    </View>
                                </View>

                                <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={18} color={COLORS.muted} />
                            </Pressable>

                            {isExpanded ? (
                                <View style={{ paddingTop: 12, gap: 10 }}>
                                    {item.users.map((u) => (
                                        <View key={u.userId} style={styles.userRow}>
                                            <View style={{ flex: 1, gap: 2 }}>
                                                <Text style={styles.userName} numberOfLines={1}>
                                                    {u.name}
                                                </Text>
                                                {u.email ? (
                                                    <Text style={styles.userEmail} numberOfLines={1}>
                                                        {u.email}
                                                    </Text>
                                                ) : (
                                                    <Text style={styles.userEmailMuted}>(sin email)</Text>
                                                )}
                                            </View>

                                            <View style={styles.userRight}>
                                                <Text style={styles.userNums}>
                                                    A {u.assigned} · V {u.visited} · R {u.rejected} · P {u.pending}
                                                </Text>
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                        </View>
                    );
                }}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="time-outline" size={22} color={COLORS.muted} />
                        <Text style={styles.emptyText}>
                            {validRange ? "No hay datos en este rango." : "Corrige el rango para ver resultados."}
                        </Text>
                    </View>
                }
            />

            {/* Picker Android */}
            {pickerOpen && Platform.OS === "android" ? (
                <DateTimePicker
                    value={pickerDate}
                    mode="date"
                    display="calendar"
                    onChange={onPickerChange}
                    maximumDate={new Date(2100, 11, 31)}
                    minimumDate={new Date(2000, 0, 1)}
                />
            ) : null}

            {/* Picker iOS */}
            <Modal visible={pickerOpen && Platform.OS === "ios"} transparent animationType="fade" onRequestClose={closePicker}>
                <Pressable style={styles.modalBackdrop} onPress={closePicker} />

                <View style={styles.modalSheet}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>
                            {pickerTarget === "start" ? "Seleccionar inicio" : "Seleccionar fin"}
                        </Text>

                        <Pressable onPress={closePicker} style={({ pressed }) => [styles.modalIcon, pressed && styles.pressed]}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    </View>

                    <DateTimePicker value={pickerDate} mode="date" display="spinner" onChange={onPickerChange} />

                    <View style={styles.modalActions}>
                        <Pressable onPress={closePicker} style={({ pressed }) => [styles.modalBtn, pressed && styles.pressed]}>
                            <Text style={styles.modalBtnTextMuted}>Cancelar</Text>
                        </Pressable>
                        <Pressable
                            onPress={confirmPickerIOS}
                            style={({ pressed }) => [styles.modalBtn, styles.modalBtnPrimary, pressed && styles.pressed]}
                        >
                            <Text style={styles.modalBtnText}>OK</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    soft: "rgba(255,255,255,0.06)",
    soft2: "rgba(255,255,255,0.10)",
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
    title: {
        color: COLORS.text,
        fontSize: 22,
        fontWeight: "900",
        letterSpacing: 0.3,
    },
    subtitle: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        marginTop: 4,
        lineHeight: 16,
    },
    strong: { color: COLORS.text, fontWeight: "900" },

    moneyPill: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "flex-end",
        justifyContent: "center",
        minWidth: 110,
    },
    moneyPillText: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    moneyPillSub: { color: COLORS.muted, fontSize: 11, fontWeight: "900", marginTop: 2 },

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

    card: {
        marginHorizontal: 16,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 10,
        marginBottom: 12,
    },

    cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

    section: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    label: { color: COLORS.muted, fontSize: 12, fontWeight: "900", marginBottom: 6 },

    smallBtn: {
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: COLORS.soft,
        borderWidth: 1,
        borderColor: COLORS.soft2,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
    },
    smallBtnText: { color: COLORS.text, fontSize: 12, fontWeight: "900" },

    row2: { flexDirection: "row", gap: 10 },

    dateField: {
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 12,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    dateText: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: "900" },

    warn: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    searchMini: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 12,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    searchMiniInput: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: "800" },
    clearMini: {
        width: 30,
        height: 30,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: COLORS.soft,
    },

    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    chip: {
        height: 36,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
        maxWidth: 200,
    },
    chipActive: { backgroundColor: COLORS.soft, borderColor: COLORS.soft2 },
    chipText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    chipTextActive: { color: COLORS.text },
    hint: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    list: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },

    dayCard: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
    },
    dayTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    dayTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900" },

    pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    pill: {
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: COLORS.soft2,
        backgroundColor: COLORS.soft,
        alignItems: "center",
        justifyContent: "center",
    },
    pillText: { color: COLORS.text, fontSize: 12, fontWeight: "900" },

    userRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    userName: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    userEmail: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    userEmailMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.7 },
    userRight: { alignItems: "flex-end" },
    userNums: { color: COLORS.text, opacity: 0.85, fontSize: 12, fontWeight: "900" },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    empty: { marginTop: 30, alignItems: "center", gap: 10, paddingHorizontal: 16 },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900", textAlign: "center" },

    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
    modalSheet: {
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 16,
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
    },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    modalTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
    modalIcon: {
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    modalActions: { flexDirection: "row", gap: 10, marginTop: 12 },
    modalBtn: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    modalBtnPrimary: { backgroundColor: COLORS.soft, borderColor: COLORS.soft2 },
    modalBtnText: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    modalBtnTextMuted: { color: COLORS.muted, fontSize: 13, fontWeight: "900" },
});