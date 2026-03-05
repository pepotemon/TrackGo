import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Modal,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { assignClient, subscribeAdminClients } from "../../data/repositories/clientsRepo";
import { subscribeDailyEventsByRange } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, DailyEventDoc, UserDoc } from "../../types/models";

// ----------------------
// DayKey helpers
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

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toMillis === "function") return v.toMillis();
    if (typeof v === "string") {
        const n = Number(v);
        return isFinite(n) ? n : 0;
    }
    return 0;
}

// ✅ dedupe: último evento por cliente (por createdAt)
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

type RejectReason = "clavo" | "localizacion" | "otro";

function normalizeReason(raw?: string): RejectReason | undefined {
    if (!raw) return undefined;
    const r = String(raw).toLowerCase().trim();
    if (r === "clavo") return "clavo";
    if (r === "localizacion" || r === "localización" || r === "localizacao" || r === "localização")
        return "localizacion";
    if (r === "otro" || r === "outro") return "otro";
    return undefined;
}

function reasonLabel(r?: RejectReason) {
    if (r === "clavo") return "Clavo";
    if (r === "localizacion") return "Localización";
    if (r === "otro") return "Otro";
    return "—";
}
function reasonIcon(r?: RejectReason) {
    if (r === "clavo") return "alert-circle-outline";
    if (r === "localizacion") return "navigate-outline";
    if (r === "otro") return "help-circle-outline";
    return "information-circle-outline";
}

type Row = {
    userId: string;
    name: string;
    email?: string;

    ratePerVisit: number;

    assignedToday: number; // ✅ SOLO asignados HOY (assignedDayKey === todayKey)
    pending: number; // ✅ estado actual

    visitedToday: number; // ✅ desde dailyEvents (hoy) filtrado
    rejectedToday: number; // ✅ desde dailyEvents (hoy) filtrado

    amountToday: number;
};

type ListMode = "visited" | "pending" | "rejected";

type GroupSection = {
    userId: string;
    title: string;
    subtitle?: string;
    data: ClientDoc[];
};

export default function AdminDailyReportScreen() {
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [todayEvents, setTodayEvents] = useState<DailyEventDoc[]>([]);
    const [rangeEvents, setRangeEvents] = useState<DailyEventDoc[]>([]); // ✅ para motivos
    const [q, setQ] = useState("");

    // ✅ MODAL LISTA
    const [listOpen, setListOpen] = useState(false);
    const [listMode, setListMode] = useState<ListMode>("visited");
    const [listQ, setListQ] = useState("");

    // ✅ MODAL REASIGNAR
    const [assignOpen, setAssignOpen] = useState(false);
    const [assignClientId, setAssignClientId] = useState<string | null>(null);
    const [assignSearch, setAssignSearch] = useState("");
    const [busyClientId, setBusyClientId] = useState<string | null>(null);

    const tk = useMemo(() => todayKey(), []);

    // clients realtime
    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);

    // events realtime HOY (para contadores/listas)
    useEffect(() => {
        const unsub = subscribeDailyEventsByRange(
            tk,
            tk,
            (list) => setTodayEvents(list ?? []),
            (err) => console.log("[AdminDailyReport] today events err:", err?.code, err?.message)
        );
        return () => unsub();
    }, [tk]);

    // events realtime RANGO (para etiquetas de motivos)
    useEffect(() => {
        const end = new Date();
        end.setHours(0, 0, 0, 0);

        const start = new Date(end);
        start.setDate(start.getDate() - 180);

        const startKey = dayKeyFromDate(start);
        const endKey = dayKeyFromDate(end);

        const unsub = subscribeDailyEventsByRange(
            startKey,
            endKey,
            (list) => setRangeEvents(list ?? []),
            (err) => console.log("[AdminDailyReport] range events err:", err?.code, err?.message)
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

    const usersById = useMemo(() => {
        const m = new Map<string, UserDoc>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);

    // --------------------------
    // ✅ DATA base
    // --------------------------
    const clientsById = useMemo(() => {
        const m = new Map<string, ClientDoc>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    // ✅ hoy: último evento por cliente
    const lastEventTodayByClient = useMemo(() => {
        return latestEventByClient(todayEvents);
    }, [todayEvents]);

    // ✅ rango: último evento por cliente (motivos)
    const lastEventRangeByClient = useMemo(() => {
        return latestEventByClient(rangeEvents);
    }, [rangeEvents]);

    // ✅ motivo del rechazo por clientId (desde rango)
    const rejectedReasonByClientId = useMemo(() => {
        const m = new Map<string, RejectReason>();

        for (const [cid, ev] of lastEventRangeByClient.entries()) {
            const anyEv: any = ev as any;
            if (anyEv?.type !== "rejected") continue;

            const raw =
                (anyEv?.reason ??
                    anyEv?.rejectReason ??
                    anyEv?.rejectedReason ??
                    anyEv?.meta?.reason) as string | undefined;

            const norm = normalizeReason(raw);
            if (norm) m.set(cid, norm);
        }

        return m;
    }, [lastEventRangeByClient]);

    // ✅ FIX HOME-STYLE:
    // Solo contamos un evento si:
    // 1) cliente existe
    // 2) estado actual del cliente coincide con e.type
    const shouldCountEvent = useCallback(
        (e: DailyEventDoc) => {
            const cid = (e as any)?.clientId as string | undefined;
            if (!cid) return false;

            const c = clientsById.get(cid);
            if (!c) return false; // eliminado

            // ojo: c.status debe ser "visited" | "rejected" | "pending"
            return (c as any).status === (e as any).type;
        },
        [clientsById]
    );

    // --------------------------
    // ✅ Rows + Totales
    // --------------------------
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

                assignedToday: 0,
                pending: 0,

                visitedToday: 0,
                rejectedToday: 0,

                amountToday: 0,
            };
        }

        // 1) assignedToday + pending desde CLIENTS
        // - assignedToday: SOLO si assignedDayKey === hoy
        // - pending: estado actual
        for (const c of clients) {
            const uid = c.assignedTo;
            if (!uid) continue;

            if (!byUser[uid]) {
                byUser[uid] = {
                    userId: uid,
                    name: "(sin perfil)",
                    email: "",
                    ratePerVisit: 0,

                    assignedToday: 0,
                    pending: 0,

                    visitedToday: 0,
                    rejectedToday: 0,

                    amountToday: 0,
                };
            }

            const row = byUser[uid];

            const assignedDayKey = String((c as any).assignedDayKey ?? "");
            if (assignedDayKey === tk) row.assignedToday += 1;

            if ((c as any).status === "pending") row.pending += 1;
        }

        // 2) visitedToday / rejectedToday desde DAILY EVENTS (hoy) ✅ filtrado HOME-STYLE
        for (const ev of lastEventTodayByClient.values()) {
            if (!shouldCountEvent(ev)) continue;

            const uid = (ev as any)?.userId as string | undefined;
            if (!uid) continue;

            if (!byUser[uid]) {
                byUser[uid] = {
                    userId: uid,
                    name: "(sin perfil)",
                    email: "",
                    ratePerVisit: 0,

                    assignedToday: 0,
                    pending: 0,

                    visitedToday: 0,
                    rejectedToday: 0,

                    amountToday: 0,
                };
            }

            if ((ev as any)?.type === "visited") byUser[uid].visitedToday += 1;
            if ((ev as any)?.type === "rejected") byUser[uid].rejectedToday += 1;
        }

        // 3) amount
        for (const r of Object.values(byUser)) {
            r.amountToday = r.visitedToday * (r.ratePerVisit ?? 0);
        }

        const all = Object.values(byUser);

        // filter
        const qt2 = q.trim().toLowerCase();
        const filtered = !qt2
            ? all
            : all.filter((r) => {
                const hay = `${safeText(r.name)} ${safeText(r.email)}`;
                return hay.includes(qt2);
            });

        // sort
        return filtered.sort(
            (a, b) => b.visitedToday + b.rejectedToday - (a.visitedToday + a.rejectedToday)
        );
    }, [clients, users, lastEventTodayByClient, q, shouldCountEvent, tk]);

    const totals = useMemo(() => {
        return rows.reduce(
            (acc, r) => {
                acc.assignedToday += r.assignedToday;
                acc.pending += r.pending;
                acc.visitedToday += r.visitedToday;
                acc.rejectedToday += r.rejectedToday;
                acc.amountToday += r.amountToday;
                return acc;
            },
            {
                assignedToday: 0,
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

    // ✅ FIX: que TODOS (incl. Asignados) sean el MISMO componente (Pressable)
    // y no usar style callback en <View> (eso rompía la simetría del "Asignados")
    const StatIconPressable = ({
        icon,
        color,
        value,
        label,
        onPress,
        disabled,
    }: {
        icon: any;
        color: string;
        value: number;
        label: string;
        onPress?: () => void;
        disabled?: boolean;
    }) => {
        const clickable = !!onPress && !disabled;

        return (
            <Pressable
                onPress={onPress}
                disabled={!onPress || disabled}
                style={({ pressed }) => [
                    styles.statIconWrap,
                    pressed && clickable ? styles.statIconWrapPressed : null,
                    disabled ? { opacity: 0.55 } : null,
                ]}
                accessibilityLabel={`${label}: ${value}`}
            >
                <View
                    style={[
                        styles.statIcon,
                        { borderColor: color + "55", backgroundColor: color + "12" },
                    ]}
                >
                    <Ionicons name={icon} size={16} color={color} />
                </View>
                <Text style={styles.statValue}>{value}</Text>
            </Pressable>
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

    // --------------------------
    // ✅ DATA para modales
    // --------------------------
    const visitedIdsByUser = useMemo(() => {
        const m = new Map<string, Set<string>>();
        for (const ev of lastEventTodayByClient.values()) {
            if ((ev as any)?.type !== "visited") continue;
            if (!shouldCountEvent(ev)) continue;

            const uid = (ev as any)?.userId as string | undefined;
            const cid = (ev as any)?.clientId as string | undefined;
            if (!uid || !cid) continue;

            if (!m.has(uid)) m.set(uid, new Set<string>());
            m.get(uid)!.add(cid);
        }
        return m;
    }, [lastEventTodayByClient, shouldCountEvent]);

    // ✅ RECHAZADOS: agrupar por assignedTo ACTUAL
    const rejectedByAssignedTo = useMemo(() => {
        const m = new Map<string, ClientDoc[]>();
        for (const ev of lastEventTodayByClient.values()) {
            if ((ev as any)?.type !== "rejected") continue;
            if (!shouldCountEvent(ev)) continue;

            const cid = (ev as any)?.clientId as string | undefined;
            if (!cid) continue;

            const c = clientsById.get(cid);
            if (!c) continue;

            const uid = c.assignedTo;
            if (!uid) continue;

            if (!m.has(uid)) m.set(uid, []);
            m.get(uid)!.push(c);
        }
        return m;
    }, [lastEventTodayByClient, clientsById, shouldCountEvent]);

    const pendingByUser = useMemo(() => {
        const m = new Map<string, ClientDoc[]>();
        for (const c of clients) {
            if ((c as any).status !== "pending") continue;
            const uid = c.assignedTo;
            if (!uid) continue;
            if (!m.has(uid)) m.set(uid, []);
            m.get(uid)!.push(c);
        }
        return m;
    }, [clients]);

    const filterClientByListQ = (c: ClientDoc) => {
        const qt2 = listQ.trim().toLowerCase();
        if (!qt2) return true;

        const name = safeText((c as any).name);
        const business = safeText((c as any).business);
        const hay =
            safeText(c.phone) +
            " " +
            safeText(c.address) +
            " " +
            safeText(c.mapsUrl) +
            " " +
            name +
            " " +
            business;

        return hay.includes(qt2);
    };

    const buildSections = (mode: ListMode): GroupSection[] => {
        const out: GroupSection[] = [];

        for (const r of rows) {
            const uid = r.userId;
            let list: ClientDoc[] = [];

            if (mode === "visited") {
                const ids = visitedIdsByUser.get(uid);
                if (ids && ids.size) {
                    for (const id of ids) {
                        const c = clientsById.get(id);
                        if (c) list.push(c);
                    }
                }
            } else if (mode === "rejected") {
                list = (rejectedByAssignedTo.get(uid) ?? []).slice();
            } else if (mode === "pending") {
                list = (pendingByUser.get(uid) ?? []).slice();
            }

            list = list.filter(filterClientByListQ);
            if (list.length === 0) continue;

            out.push({
                userId: uid,
                title: r.name,
                subtitle: r.email ? r.email : undefined,
                data: list,
            });
        }

        return out;
    };

    const modalSections = useMemo(() => buildSections(listMode), [
        listMode,
        rows,
        visitedIdsByUser,
        rejectedByAssignedTo,
        pendingByUser,
        clientsById,
        listQ,
    ]);

    const openList = (mode: ListMode) => {
        setListMode(mode);
        setListQ("");
        setListOpen(true);
    };

    const closeList = () => {
        setListOpen(false);
        setListQ("");
    };

    const openAssignForClient = (clientId: string) => {
        setAssignClientId(clientId);
        setAssignSearch("");
        setAssignOpen(true);
    };

    const closeAssign = () => {
        setAssignOpen(false);
        setAssignClientId(null);
        setAssignSearch("");
    };

    // ✅ reasignar: update optimista (assignedTo + pending)
    const doAssign = async (toUserId: string) => {
        const cid = assignClientId;
        if (!cid) return;

        try {
            setBusyClientId(cid);

            setClients((prev) =>
                prev.map((c) => {
                    if (c.id !== cid) return c;
                    return {
                        ...(c as any),
                        assignedTo: toUserId,
                        status: "pending",
                    } as ClientDoc;
                })
            );

            await assignClient(cid, toUserId as any);

            closeAssign();
        } catch (e: any) {
            console.log("[assignClient] error:", e?.message ?? e);
        } finally {
            setBusyClientId(null);
        }
    };

    const filteredUsersForAssign = useMemo(() => {
        const qt2 = assignSearch.trim().toLowerCase();
        const base = users.slice().sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)));
        if (!qt2) return base;
        return base.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)}`;
            return hay.includes(qt2);
        });
    }, [users, assignSearch]);

    const findAssignedName = (uid?: string) => {
        if (!uid) return "—";
        const u = usersById.get(uid);
        return (u?.name ?? "").trim() || (u?.email ?? "").trim() || uid;
    };

    const RejectTag = ({ reason }: { reason?: RejectReason }) => {
        if (!reason) return null;
        return (
            <View style={styles.rejectTag}>
                <Ionicons name={reasonIcon(reason) as any} size={14} color={COLORS.rejectedSoft} />
                <Text style={styles.rejectTagText}>{reasonLabel(reason)}</Text>
            </View>
        );
    };

    const ClientRowModal = ({ c, allowReassign }: { c: ClientDoc; allowReassign: boolean }) => {
        const name = ((c as any).name ?? "").trim();
        const business = ((c as any).business ?? "").trim();
        const phone = (c.phone ?? "").trim();
        const assignedLabel = findAssignedName(c.assignedTo);
        const busy = busyClientId === c.id;

        const rejectReason = rejectedReasonByClientId.get(c.id);

        return (
            <View style={styles.modalClientCard}>
                <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.modalClientPhone} numberOfLines={1}>
                        {phone || "—"}
                    </Text>
                    {name ? <Text style={styles.modalClientMeta} numberOfLines={1}>{name}</Text> : null}
                    {business ? <Text style={styles.modalClientMeta} numberOfLines={1}>{business}</Text> : null}

                    {listMode === "rejected" ? (
                        rejectReason ? (
                            <RejectTag reason={rejectReason} />
                        ) : (
                            <View style={styles.rejectTagMuted}>
                                <Ionicons name="information-circle-outline" size={14} color={COLORS.muted} />
                                <Text style={styles.rejectTagTextMuted}>Rechazo: sin motivo guardado</Text>
                            </View>
                        )
                    ) : null}

                    <Text style={styles.modalClientAssigned} numberOfLines={1}>
                        Asignado: <Text style={styles.modalClientAssignedStrong}>{assignedLabel}</Text>
                    </Text>
                </View>

                {allowReassign ? (
                    <Pressable
                        onPress={() => openAssignForClient(c.id)}
                        disabled={busy}
                        style={({ pressed }) => [
                            styles.modalReassignBtn,
                            pressed && !busy ? styles.modalReassignBtnPressed : null,
                            busy ? { opacity: 0.6 } : null,
                        ]}
                        accessibilityLabel="Reasignar"
                    >
                        <Ionicons name="swap-horizontal-outline" size={18} color={COLORS.text} />
                    </Pressable>
                ) : (
                    <View style={styles.modalReassignPlaceholder} />
                )}
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
                        <Text style={styles.hMuted}>{totals.assignedToday}</Text>
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

            {/* Icons-only summary row */}
            <View style={styles.statsRow}>
                <StatIconPressable
                    icon="checkmark-circle-outline"
                    color={COLORS.visited}
                    value={totals.visitedToday}
                    label="Visitados"
                    onPress={() => openList("visited")}
                    disabled={totals.visitedToday <= 0}
                />
                <StatIconPressable
                    icon="close-circle-outline"
                    color={COLORS.rejected}
                    value={totals.rejectedToday}
                    label="Rechazados"
                    onPress={() => openList("rejected")}
                    disabled={totals.rejectedToday <= 0}
                />
                <StatIconPressable
                    icon="time-outline"
                    color={COLORS.pending}
                    value={totals.pending}
                    label="Pendientes"
                    onPress={() => openList("pending")}
                    disabled={totals.pending <= 0}
                />
                <StatIconPressable
                    icon="people-outline"
                    color={COLORS.muted2}
                    value={totals.assignedToday}
                    label="Asignados (hoy)"
                />
            </View>

            {/* Search */}
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
                    const total = item.assignedToday; // ✅ SOLO asignados HOY
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
                                    <Text style={[styles.miniText, { color: COLORS.text }]}>{item.assignedToday}</Text>
                                </View>
                            </View>

                            <View style={styles.actionsRow}>
                                <View style={styles.rateChip}>
                                    <Ionicons name="cash-outline" size={14} color={COLORS.muted} />
                                    <Text style={styles.rateText}>R$ {money(item.ratePerVisit)}</Text>
                                    <Text style={styles.rateTextMuted}>/visita</Text>
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
                        <Text style={styles.emptyText}>{q.trim() ? "Sin resultados." : "Sin datos aún."}</Text>
                    </View>
                }
            />

            {/* ✅ MODAL LISTA AGRUPADA POR USUARIO */}
            <Modal visible={listOpen} transparent animationType="fade" onRequestClose={closeList}>
                <Pressable style={styles.modalBackdrop} onPress={closeList} />

                <View style={[styles.modalCard, { paddingBottom: Math.max(14, insets.bottom + 12) }]}>
                    <View style={styles.modalHeader}>
                        <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.modalTitle}>
                                {listMode === "visited"
                                    ? "Visitados (hoy)"
                                    : listMode === "pending"
                                        ? "Pendientes"
                                        : "Rechazados (hoy)"}
                            </Text>
                            <Text style={styles.modalSub}>
                                {modalSections.reduce((a, s) => a + (s.data?.length ?? 0), 0)} cliente
                                {modalSections.reduce((a, s) => a + (s.data?.length ?? 0), 0) === 1 ? "" : "s"}
                            </Text>
                        </View>

                        <Pressable onPress={closeList} style={({ pressed }) => [styles.modalClose, pressed && styles.modalClosePressed]}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    </View>

                    <View style={styles.modalSearch}>
                        <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                        <TextInput
                            value={listQ}
                            onChangeText={setListQ}
                            placeholder="Buscar cliente, negocio, teléfono…"
                            placeholderTextColor={COLORS.muted}
                            style={styles.modalSearchInput}
                        />
                        {!!listQ ? (
                            <Pressable onPress={() => setListQ("")} style={styles.modalSearchClear}>
                                <Ionicons name="close" size={18} color={COLORS.text} />
                            </Pressable>
                        ) : null}
                    </View>

                    <FlatList
                        data={modalSections}
                        keyExtractor={(s) => s.userId}
                        contentContainerStyle={{ paddingTop: 6, paddingBottom: 10, gap: 10 }}
                        renderItem={({ item: section }) => (
                            <View style={styles.modalSectionCard}>
                                <View style={styles.modalSectionHeader}>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text style={styles.modalSectionTitle} numberOfLines={1}>
                                            {section.title}
                                        </Text>
                                        {section.subtitle ? (
                                            <Text style={styles.modalSectionSub} numberOfLines={1}>
                                                {section.subtitle}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <View style={styles.modalCountPill}>
                                        <Text style={styles.modalCountText}>{section.data.length}</Text>
                                    </View>
                                </View>

                                <View style={{ gap: 10, marginTop: 10 }}>
                                    {section.data.map((c) => (
                                        <ClientRowModal
                                            key={c.id}
                                            c={c}
                                            allowReassign={listMode === "pending" || listMode === "rejected"}
                                        />
                                    ))}
                                </View>
                            </View>
                        )}
                        ListEmptyComponent={
                            <View style={styles.modalEmpty}>
                                <Ionicons name="people-outline" size={22} color={COLORS.muted} />
                                <Text style={styles.modalEmptyText}>No hay clientes aquí.</Text>
                            </View>
                        }
                    />


                </View>
            </Modal>

            {/* ✅ MODAL: selector de usuario para reasignar */}
            <Modal visible={assignOpen} transparent animationType="fade" onRequestClose={closeAssign}>
                <Pressable style={styles.modalBackdrop} onPress={closeAssign} />

                <View style={[styles.modalCard, { paddingBottom: Math.max(14, insets.bottom + 12) }]}>
                    <View style={styles.modalHeader}>
                        <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.modalTitle}>Reasignar a usuario</Text>
                            <Text style={styles.modalSub}>Selecciona un cobrador</Text>
                        </View>

                        <Pressable onPress={closeAssign} style={({ pressed }) => [styles.modalClose, pressed && styles.modalClosePressed]}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    </View>

                    <View style={styles.modalSearch}>
                        <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                        <TextInput
                            value={assignSearch}
                            onChangeText={setAssignSearch}
                            placeholder="Buscar usuario (nombre / email)…"
                            placeholderTextColor={COLORS.muted}
                            style={styles.modalSearchInput}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        {!!assignSearch ? (
                            <Pressable onPress={() => setAssignSearch("")} style={styles.modalSearchClear}>
                                <Ionicons name="close" size={18} color={COLORS.text} />
                            </Pressable>
                        ) : null}
                    </View>

                    <FlatList
                        data={filteredUsersForAssign}
                        keyExtractor={(u) => u.id}
                        contentContainerStyle={{ paddingTop: 6, paddingBottom: 10, gap: 10 }}
                        renderItem={({ item }) => (
                            <Pressable onPress={() => doAssign(item.id)} style={({ pressed }) => [styles.userPickRow, pressed && styles.userPickRowPressed]}>
                                <View style={styles.userPickAvatar}>
                                    <Ionicons name="person-outline" size={16} color={COLORS.text} />
                                </View>
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={styles.userPickName} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                    <Text style={styles.userPickEmail} numberOfLines={1}>
                                        {item.email || "—"}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
                            </Pressable>
                        )}
                        ListEmptyComponent={
                            <View style={styles.modalEmpty}>
                                <Ionicons name="person-outline" size={22} color={COLORS.muted} />
                                <Text style={styles.modalEmptyText}>No hay usuarios.</Text>
                            </View>
                        }
                    />

                    <Text style={styles.modalHint}>
                        * Esto cambia el campo assignedTo del cliente (y lo marca pending en UI para que salga de rechazados).
                    </Text>
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

    statsRow: { paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", gap: 10 },
    statIconWrap: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8, // ⬅ mejor simetría
        height: 44,
        borderRadius: 16,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    statIconWrapPressed: { transform: [{ scale: 0.99 }], opacity: 0.95 },
    statIcon: {
        width: 32, // ⬅ mismo ancho visual para todos
        height: 32,
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
    miniStat: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
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

    // -----------------
    // MODALS
    // -----------------
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
    modalCard: {
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 16,
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        gap: 12,
        maxHeight: "82%",
    },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    modalTitle: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    modalSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    modalClose: {
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        alignItems: "center",
        justifyContent: "center",
    },
    modalClosePressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },

    modalSearch: {
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
    modalSearchInput: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "700" },
    modalSearchClear: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },

    modalEmpty: { marginTop: 16, alignItems: "center", gap: 10, paddingVertical: 10 },
    modalEmptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900" },
    modalHint: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.9 },

    modalSectionCard: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        padding: 12,
    },
    modalSectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
    modalSectionTitle: { color: COLORS.text, fontWeight: "900", fontSize: 14 },
    modalSectionSub: { color: COLORS.muted, fontWeight: "800", fontSize: 12 },
    modalCountPill: {
        minWidth: 36,
        height: 28,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        paddingHorizontal: 10,
    },
    modalCountText: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

    modalClientCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    modalClientPhone: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
    modalClientMeta: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    modalClientAssigned: { color: COLORS.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },
    modalClientAssignedStrong: { color: COLORS.text, fontWeight: "900" },

    // tags
    rejectTag: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        backgroundColor: "rgba(248,113,113,0.10)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.30)",
        marginTop: 6,
    },
    rejectTagText: { color: COLORS.rejectedSoft, fontSize: 12, fontWeight: "900" },

    rejectTagMuted: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        marginTop: 6,
    },
    rejectTagTextMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },

    modalReassignBtn: {
        width: 44,
        height: 44,
        borderRadius: 16,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        alignItems: "center",
        justifyContent: "center",
    },
    modalReassignBtnPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },
    modalReassignPlaceholder: { width: 44, height: 44 },

    userPickRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    userPickRowPressed: { transform: [{ scale: 0.99 }], opacity: 0.95 },
    userPickAvatar: {
        width: 38,
        height: 38,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    userPickName: { color: COLORS.text, fontWeight: "900" },
    userPickEmail: { color: COLORS.muted, fontWeight: "800", fontSize: 12 },
});