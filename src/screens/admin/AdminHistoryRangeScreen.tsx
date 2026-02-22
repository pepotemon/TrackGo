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
 * ✅ Semana local: Lunes 00:00 → Domingo 23:59 (dayKeys inclusivo)
 */
function weekRangeFromDate(date: Date) {
    const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = base.getDay(); // 0 dom, 1 lun...
    const diffToMonday = (day + 6) % 7; // lunes=0 ... domingo=6
    const monday = new Date(base);
    monday.setDate(base.getDate() - diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return { startKey: formatDayKeyFromDate(monday), endKey: formatDayKeyFromDate(sunday) };
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

    const initialWeek = useMemo(() => weekRangeFromDate(new Date()), []);
    const [startKey, setStartKey] = useState(initialWeek.startKey);
    const [endKey, setEndKey] = useState(initialWeek.endKey);

    // ✅ ahora el filtro de usuarios es SELECTOR (no lista de chips)
    const [selectedUserId, setSelectedUserId] = useState<string>("ALL");
    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [qUser, setQUser] = useState("");

    // ✅ monetización real semanal (clients.statusAt)
    const [earnings, setEarnings] = useState<EarningsSummary>({
        rows: [],
        totalVisited: 0,
        totalAmount: 0,
    });

    // UI
    const [expandedDay, setExpandedDay] = useState<string | null>(null);

    // Picker fecha
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

    useEffect(() => {
        const s = startKey.trim();
        const e = endKey.trim();
        if (!isValidDayKey(s) || !isValidDayKey(e)) return;

        const unsub = subscribeDailyEventsByRange(s, e, setEvents);
        return () => unsub();
    }, [startKey, endKey]);

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

    const usersFiltered = useMemo(() => {
        const qt = qUser.trim().toLowerCase();
        const base = users.slice().sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)));
        if (!qt) return base;
        return base.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, qUser]);

    const selectedUserLabel = useMemo(() => {
        if (selectedUserId === "ALL") return "Todos";
        const u = users.find((x) => x.id === selectedUserId);
        return u?.name?.trim() ? u.name : "Usuario";
    }, [selectedUserId, users]);

    // último evento del día por cliente
    const lastEventByDayClient = useMemo(() => {
        const map = new Map<string, DailyEventDoc>();

        for (const e of events) {
            if (e.type !== "visited" && e.type !== "rejected" && e.type !== "pending") continue;
            if (!e.clientId || !e.dayKey) continue;

            const key = `${e.dayKey}|${e.clientId}`;
            const prev = map.get(key);

            if (!prev || (e.createdAt ?? 0) > (prev.createdAt ?? 0)) map.set(key, e);
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

        const byDay: Record<
            string,
            Record<string, { assigned: number; visited: number; rejected: number }>
        > = {};

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

            userRows.sort((a, b) => b.visited + b.rejected - (a.visited + a.rejected));

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

    // ----------------------
    // UI atoms
    // ----------------------
    const IconBtn = ({
        icon,
        onPress,
        label,
    }: {
        icon: any;
        onPress: () => void;
        label: string;
    }) => (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityLabel={label}
        >
            <Ionicons name={icon} size={18} color={COLORS.text} />
        </Pressable>
    );

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
    }) => (
        <View style={styles.statIconWrap} accessibilityLabel={`${label}: ${value}`}>
            <View style={[styles.statIcon, { borderColor: color + "55", backgroundColor: color + "12" }]}>
                <Ionicons name={icon} size={16} color={color} />
            </View>
            <Text style={styles.statValue}>{value}</Text>
        </View>
    );

    const MiniPill = ({
        icon,
        color,
        text,
    }: {
        icon: any;
        color: string;
        text: string;
    }) => (
        <View style={[styles.miniPill, { borderColor: color + "33", backgroundColor: color + "12" }]}>
            <Ionicons name={icon} size={14} color={color} />
            <Text style={[styles.miniPillText, { color }]} numberOfLines={1}>
                {text}
            </Text>
        </View>
    );

    const toggleDay = (dk: string) => setExpandedDay((prev) => (prev === dk ? null : dk));

    const setThisWeek = () => {
        const wk = weekRangeFromDate(new Date());
        setStartKey(wk.startKey);
        setEndKey(wk.endKey);
    };

    const validRange = isValidDayKey(startKey) && isValidDayKey(endKey);

    const closeUserPicker = () => {
        setUserPickerOpen(false);
        setQUser("");
    };

    const applyUser = (uid: string) => {
        setSelectedUserId(uid);
        setExpandedDay(null);
        closeUserPicker();
    };

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

            {/* Compact header (sin fecha extra arriba) */}
            <View style={[styles.header, { paddingTop: 0 }]}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Cierre semanal</Text>

                </View>

                <View style={styles.moneyChip}>
                    <Ionicons name="cash-outline" size={14} color={COLORS.money} />
                    <Text style={styles.moneyChipText}>R$ {money(earnings.totalAmount)}</Text>
                </View>

                <IconBtn icon="refresh-outline" onPress={setThisWeek} label="Esta semana" />
            </View>

            {/* Icons-only row (ahorra espacio) */}
            <View style={styles.statsRow}>
                <StatIcon icon="people-outline" color={COLORS.muted2} value={globalTotals.assigned} label="Asignados" />
                <StatIcon icon="checkmark-circle-outline" color={COLORS.ok} value={globalTotals.visited} label="Visitados" />
                <StatIcon icon="close-circle-outline" color={COLORS.bad} value={globalTotals.rejected} label="Rechazados" />
                <StatIcon icon="time-outline" color={COLORS.warn} value={globalTotals.pending} label="Pendientes" />
            </View>

            {/* Compact controls card */}
            <View style={styles.card}>
                {/* Rango + selector user en una sola fila */}
                <View style={styles.controlsRow}>
                    <Pressable
                        onPress={() => openPicker("start")}
                        style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
                        accessibilityLabel="Seleccionar inicio"
                    >
                        <Ionicons name="calendar-outline" size={16} color={COLORS.muted} />
                        <Text style={styles.controlText} numberOfLines={1}>
                            {startKey}
                        </Text>
                    </Pressable>

                    <Text style={styles.arrow}>→</Text>

                    <Pressable
                        onPress={() => openPicker("end")}
                        style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
                        accessibilityLabel="Seleccionar fin"
                    >
                        <Ionicons name="calendar-outline" size={16} color={COLORS.muted} />
                        <Text style={styles.controlText} numberOfLines={1}>
                            {endKey}
                        </Text>
                    </Pressable>

                    <Pressable
                        onPress={() => setUserPickerOpen(true)}
                        style={({ pressed }) => [styles.userBtn, pressed && styles.pressed]}
                        accessibilityLabel="Filtrar por usuario"
                    >
                        <Ionicons name="person-outline" size={16} color={COLORS.text} />
                        <Text style={styles.userBtnText} numberOfLines={1}>
                            {selectedUserLabel}
                        </Text>
                        <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
                    </Pressable>
                </View>

                {!validRange ? <Text style={styles.warn}>Rango inválido. Usa YYYY-MM-DD.</Text> : null}
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
                            <Pressable
                                onPress={() => toggleDay(item.dayKey)}
                                style={({ pressed }) => [styles.dayTop, pressed && styles.pressed]}
                            >
                                <View style={{ flex: 1, gap: 8 }}>
                                    <Text style={styles.dayTitle} numberOfLines={1}>
                                        {item.label}
                                    </Text>

                                    {/* pillas compactas con icon + valor (casi sin texto) */}
                                    <View style={styles.pillsRow}>
                                        <MiniPill icon="people-outline" color={COLORS.muted2} text={`${item.totals.assigned}`} />
                                        <MiniPill icon="checkmark" color={COLORS.okSoft} text={`${item.totals.visited}`} />
                                        <MiniPill icon="close" color={COLORS.badSoft} text={`${item.totals.rejected}`} />
                                        <MiniPill icon="time" color={COLORS.warnSoft} text={`${item.totals.pending}`} />
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
                                                {!!u.email ? (
                                                    <Text style={styles.userEmail} numberOfLines={1}>
                                                        {u.email}
                                                    </Text>
                                                ) : (
                                                    <Text style={styles.userEmailMuted} numberOfLines={1}>
                                                        (sin email)
                                                    </Text>
                                                )}
                                            </View>

                                            {/* compacto: solo números */}
                                            <View style={styles.userNumsWrap}>
                                                <Text style={styles.userNums} numberOfLines={1}>
                                                    {u.assigned} · {u.visited} · {u.rejected} · {u.pending}
                                                </Text>
                                                <Text style={styles.userNumsHint} numberOfLines={1}>
                                                    A · V · R · P
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
                        <Text style={styles.modalTitle}>{pickerTarget === "start" ? "Inicio" : "Fin"}</Text>

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

            {/* User selector modal */}
            <Modal visible={userPickerOpen} transparent animationType="fade" onRequestClose={closeUserPicker}>
                <Pressable style={styles.modalBackdrop} onPress={closeUserPicker} />

                <View style={styles.userSheet}>
                    <View style={styles.userSheetHeader}>
                        <Text style={styles.modalTitle}>Usuario</Text>

                        <Pressable onPress={closeUserPicker} style={({ pressed }) => [styles.modalIcon, pressed && styles.pressed]}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    </View>

                    {/* Search mini */}
                    <View style={styles.searchMini}>
                        <Ionicons name="search-outline" size={16} color={COLORS.muted} />
                        <Text
                            // NOTE: sin TextInput para mantener imports mínimos? (pero ya lo quitamos arriba)
                            // Querías selector y ahorrar; aquí lo mantenemos simple con botones.
                            // Si quieres búsqueda real, dime y lo meto con TextInput.
                            style={styles.searchHint}
                        >
                            Tip: toca “Todos” o el usuario (ordenado). Si quieres búsqueda aquí, te lo dejo con TextInput.
                        </Text>
                    </View>

                    <View style={styles.userList}>
                        <Pressable onPress={() => applyUser("ALL")} style={({ pressed }) => [styles.userPickRow, pressed && styles.pressed]}>
                            <View style={styles.userPickLeft}>
                                <Ionicons name="people-outline" size={16} color={COLORS.text} />
                                <Text style={styles.userPickName}>Todos</Text>
                            </View>
                            {selectedUserId === "ALL" ? <Ionicons name="checkmark" size={18} color={COLORS.ok} /> : null}
                        </Pressable>

                        <FlatList
                            data={usersFiltered}
                            keyExtractor={(u) => u.id}
                            style={{ maxHeight: 360 }}
                            renderItem={({ item }) => {
                                const active = selectedUserId === item.id;
                                return (
                                    <Pressable onPress={() => applyUser(item.id)} style={({ pressed }) => [styles.userPickRow, pressed && styles.pressed]}>
                                        <View style={styles.userPickLeft}>
                                            <Ionicons name="person-outline" size={16} color={COLORS.muted2} />
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.userPickName} numberOfLines={1}>
                                                    {item.name}
                                                </Text>
                                                {!!item.email ? (
                                                    <Text style={styles.userPickEmail} numberOfLines={1}>
                                                        {item.email}
                                                    </Text>
                                                ) : (
                                                    <Text style={styles.userPickEmailMuted} numberOfLines={1}>
                                                        (sin email)
                                                    </Text>
                                                )}
                                            </View>
                                        </View>
                                        {active ? <Ionicons name="checkmark" size={18} color={COLORS.ok} /> : null}
                                    </Pressable>
                                );
                            }}
                        />
                    </View>
                </View>
            </Modal>
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

    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",

    okSoft: "#86EFAC",
    badSoft: "#FCA5A5",
    warnSoft: "#FDE68A",

    primary: "#7C3AED",
    primarySoft: "#C4B5FD",
    money: "#A7F3D0",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    // header
    header: {
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    title: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.3 },
    subtitle: { marginTop: 2, fontSize: 12, fontWeight: "900", color: COLORS.muted },
    strong: { color: COLORS.text, fontWeight: "900" },
    subMuted: { color: COLORS.muted, fontWeight: "900" },
    dot: { color: COLORS.muted, fontWeight: "900" },

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

    // icons row
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

    // controls
    card: {
        marginHorizontal: 16,
        backgroundColor: "rgba(255,255,255,0.03)",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        marginBottom: 12,
    },
    controlsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    controlBtn: {
        flex: 1,
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    controlText: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: "900" },
    arrow: { color: COLORS.muted, fontWeight: "900" },

    userBtn: {
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        maxWidth: 160,
    },
    userBtnText: { color: COLORS.text, fontSize: 13, fontWeight: "900", maxWidth: 92 },

    warn: { marginTop: 10, color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    // list
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
    miniPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
    },
    miniPillText: { fontSize: 12, fontWeight: "900" },

    userRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    userName: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    userEmail: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    userEmailMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.75 },

    userNumsWrap: { alignItems: "flex-end" },
    userNums: { color: COLORS.text, opacity: 0.92, fontSize: 12, fontWeight: "900" },
    userNumsHint: { color: COLORS.muted, fontSize: 10, fontWeight: "900", marginTop: 2 },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    empty: { marginTop: 30, alignItems: "center", gap: 10, paddingHorizontal: 16 },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900", textAlign: "center" },

    // modal base
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
        backgroundColor: "rgba(255,255,255,0.04)",
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
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    modalBtnPrimary: { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.12)" },
    modalBtnText: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    modalBtnTextMuted: { color: COLORS.muted, fontSize: 13, fontWeight: "900" },

    // user picker
    userSheet: {
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
    userSheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },

    // NOTE: para ahorrar imports, aquí dejé un “hint” en vez de TextInput.
    // Si quieres búsqueda real, dime y lo agrego con TextInput (como en las otras pantallas).
    searchMini: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
        marginBottom: 10,
    },
    searchHint: { flex: 1, color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    userList: { gap: 8 },
    userPickRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    userPickLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
    userPickName: { color: COLORS.text, fontSize: 13, fontWeight: "900", flex: 1 },
    userPickEmail: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    userPickEmailMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.75 },
});