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
import AdminBackground from "../../components/admin/AdminBackground";

import { assignClient, subscribeAdminClients } from "../../data/repositories/clientsRepo";
import { subscribeDailyEventsByRange } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, DailyEventDoc, RejectedReason, UserDoc } from "../../types/models";

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

function normalizeReason(raw?: string): RejectedReason | undefined {
    if (!raw) return undefined;
    const r = String(raw).toLowerCase().trim();

    if (r === "clavo") return "clavo";

    if (
        r === "localizacion" ||
        r === "localización" ||
        r === "localizacao" ||
        r === "localização"
    ) {
        return "localizacion";
    }

    if (r === "zona_riesgosa" || r === "zona riesgosa" || r === "zona peligrosa") {
        return "zona_riesgosa";
    }

    if (
        r === "ingresos_insuficientes" ||
        r === "ingresos insuficientes" ||
        r === "sin ingresos suficientes"
    ) {
        return "ingresos_insuficientes";
    }

    if (r === "muy_endeudado" || r === "muy endeudado" || r === "endeudado") {
        return "muy_endeudado";
    }

    if (
        r === "informacion_dudosa" ||
        r === "información dudosa" ||
        r === "datos dudosos"
    ) {
        return "informacion_dudosa";
    }

    if (r === "no_le_interesa" || r === "no le interesa" || r === "no interesado") {
        return "no_le_interesa";
    }

    if (
        r === "no_estaba_cerrado" ||
        r === "no estaba / cerrado" ||
        r === "no estaba" ||
        r === "cerrado"
    ) {
        return "no_estaba_cerrado";
    }

    if (r === "fuera_de_ruta" || r === "fuera de ruta") {
        return "fuera_de_ruta";
    }

    if (r === "otro" || r === "outro") return "otro";

    return undefined;
}

function reasonLabel(r?: RejectedReason) {
    if (r === "clavo") return "Clavo";
    if (r === "localizacion") return "Localización";
    if (r === "zona_riesgosa") return "Zona riesgosa";
    if (r === "ingresos_insuficientes") return "Ingresos insuficientes";
    if (r === "muy_endeudado") return "Muy endeudado";
    if (r === "informacion_dudosa") return "Información dudosa";
    if (r === "no_le_interesa") return "No le interesa";
    if (r === "no_estaba_cerrado") return "No estaba / cerrado";
    if (r === "fuera_de_ruta") return "Fuera de ruta";
    if (r === "otro") return "Otro";
    return "—";
}

function reasonIcon(r?: RejectedReason) {
    if (r === "clavo") return "alert-circle-outline";
    if (r === "localizacion") return "navigate-outline";
    if (r === "zona_riesgosa") return "warning-outline";
    if (r === "ingresos_insuficientes") return "cash-outline";
    if (r === "muy_endeudado") return "trending-down-outline";
    if (r === "informacion_dudosa") return "help-circle-outline";
    if (r === "no_le_interesa") return "close-circle-outline";
    if (r === "no_estaba_cerrado") return "storefront-outline";
    if (r === "fuera_de_ruta") return "map-outline";
    if (r === "otro") return "help-circle-outline";
    return "information-circle-outline";
}

function extractRejectReasonFromClient(c: ClientDoc): RejectedReason | undefined {
    const anyC: any = c as any;

    const raw =
        (anyC?.rejectReason ??
            anyC?.rejectedReason ??
            anyC?.statusReason ??
            anyC?.rejectedMeta?.reason ??
            anyC?.statusMeta?.reason) as string | undefined;

    return normalizeReason(raw);
}

type Row = {
    userId: string;
    name: string;
    email?: string;

    ratePerVisit: number;

    assignedToday: number;
    pending: number;

    visitedToday: number;
    rejectedToday: number;

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
    const [rangeEvents, setRangeEvents] = useState<DailyEventDoc[]>([]);
    const [q, setQ] = useState("");

    const [listOpen, setListOpen] = useState(false);
    const [listMode, setListMode] = useState<ListMode>("visited");
    const [listQ, setListQ] = useState("");

    const [assignOpen, setAssignOpen] = useState(false);
    const [assignClientId, setAssignClientId] = useState<string | null>(null);
    const [assignSearch, setAssignSearch] = useState("");
    const [busyClientId, setBusyClientId] = useState<string | null>(null);

    const [moneyOpen, setMoneyOpen] = useState(false);

    const tk = useMemo(() => todayKey(), []);

    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);

    useEffect(() => {
        const unsub = subscribeDailyEventsByRange(
            tk,
            tk,
            (list) => setTodayEvents(list ?? []),
            (err) => console.log("[AdminDailyReport] today events err:", err?.code, err?.message)
        );
        return () => unsub();
    }, [tk]);

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

    const clientsById = useMemo(() => {
        const m = new Map<string, ClientDoc>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    const lastEventTodayByClient = useMemo(() => {
        return latestEventByClient(todayEvents);
    }, [todayEvents]);

    const lastEventRangeByClient = useMemo(() => {
        return latestEventByClient(rangeEvents);
    }, [rangeEvents]);

    const rejectedReasonByClientId = useMemo(() => {
        const m = new Map<string, RejectedReason>();

        for (const c of clients) {
            const fromClient = extractRejectReasonFromClient(c);
            if (fromClient) m.set(c.id, fromClient);
        }

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
    }, [clients, lastEventRangeByClient]);

    /**
     * ✅ MISMA LÓGICA DEL HOME ADMIN
     * Solo cuenta el evento si:
     * 1) el cliente todavía existe
     * 2) el status actual del cliente coincide con el type del evento
     */
    const shouldCountEvent = useCallback(
        (e: DailyEventDoc) => {
            const cid = (e as any)?.clientId as string | undefined;
            if (!cid) return false;

            const c = clientsById.get(cid);
            if (!c) return false;

            return c.status === e.type;
        },
        [clientsById]
    );

    const rows: Row[] = useMemo(() => {
        const byUser: Record<string, Row> = {};

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

        // ✅ asignados hoy + pendientes actuales
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

        // ✅ visitados / rechazados de hoy con filtro anti-inflado
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

        for (const r of Object.values(byUser)) {
            r.amountToday = r.visitedToday * (r.ratePerVisit ?? 0);
        }

        const all = Object.values(byUser);

        const qt2 = q.trim().toLowerCase();
        const filtered = !qt2
            ? all
            : all.filter((r) => {
                const hay = `${safeText(r.name)} ${safeText(r.email)}`;
                return hay.includes(qt2);
            });

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

    const earningRows = useMemo(() => {
        return rows
            .filter((r) => r.visitedToday > 0 || r.amountToday > 0)
            .sort((a, b) => b.amountToday - a.amountToday);
    }, [rows]);

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
                <Ionicons name={icon} size={16} color={COLORS.text} />
            </Pressable>
        );
    };

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
                    disabled ? { opacity: 0.5 } : null,
                ]}
                accessibilityLabel={`${label}: ${value}`}
            >
                <View
                    style={[
                        styles.statIcon,
                        { borderColor: color + "44", backgroundColor: color + "10" },
                    ]}
                >
                    <Ionicons name={icon} size={14} color={color} />
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

    const RejectTag = ({ reason }: { reason?: RejectedReason }) => {
        if (!reason) return null;
        return (
            <View style={styles.rejectTag}>
                <Ionicons name={reasonIcon(reason) as any} size={12} color={COLORS.rejectedSoft} />
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

                    {name ? (
                        <Text style={styles.modalClientMeta} numberOfLines={1}>
                            {name}
                        </Text>
                    ) : null}

                    {business ? (
                        <Text style={styles.modalClientMeta} numberOfLines={1}>
                            {business}
                        </Text>
                    ) : null}

                    {listMode === "rejected" ? (
                        rejectReason ? (
                            <RejectTag reason={rejectReason} />
                        ) : (
                            <View style={styles.rejectTagMuted}>
                                <Ionicons
                                    name="information-circle-outline"
                                    size={12}
                                    color={COLORS.muted}
                                />
                                <Text style={styles.rejectTagTextMuted}>
                                    Rechazo: sin motivo guardado
                                </Text>
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
                        <Ionicons name="swap-horizontal-outline" size={16} color={COLORS.text} />
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
            <AdminBackground>
                <View style={[styles.header, { paddingTop: 2 }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.hTitle}>Hoy</Text>
                        <Text style={styles.hSub}>
                            <Text style={styles.hStrong}>{doneToday}</Text>
                            <Text style={styles.hMuted}> / {totals.assignedToday} completados</Text>
                        </Text>
                    </View>

                    <Pressable
                        onPress={() => setMoneyOpen(true)}
                        style={({ pressed }) => [
                            styles.moneyChip,
                            pressed && styles.moneyChipPressed,
                        ]}
                        accessibilityLabel="Ver visitados e ingresos"
                    >
                        <Ionicons name="cash-outline" size={12} color={COLORS.money} />
                        <Text style={styles.moneyChipText}>R$ {money(totals.amountToday)}</Text>
                    </Pressable>

                    <IconBtn
                        icon={usersLoading ? "sync" : "refresh-outline"}
                        label="Refrescar usuarios"
                        onPress={reloadUsers}
                        disabled={usersLoading}
                    />
                </View>

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

                <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={16} color={COLORS.muted} />
                    <TextInput
                        value={q}
                        onChangeText={setQ}
                        placeholder="Buscar nombre o email…"
                        placeholderTextColor={COLORS.muted}
                        style={styles.searchInput}
                        autoCorrect={false}
                        autoCapitalize="none"
                    />
                    {!!q ? (
                        <Pressable
                            onPress={() => setQ("")}
                            style={styles.clearBtn}
                            accessibilityLabel="Limpiar búsqueda"
                        >
                            <Ionicons name="close" size={16} color={COLORS.text} />
                        </Pressable>
                    ) : null}
                </View>

                <FlatList
                    data={rows}
                    keyExtractor={(r) => r.userId}
                    contentContainerStyle={[
                        styles.listContent,
                        { paddingBottom: Math.max(26, insets.bottom + 14) },
                    ]}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item }) => {
                        const done = item.visitedToday + item.rejectedToday;
                        const total = item.assignedToday;
                        const pct = total <= 0 ? 0 : Math.round((Math.min(done, total) / total) * 100);

                        return (
                            <View style={styles.card}>
                                <View style={styles.cardTop}>
                                    <View style={{ flex: 1, gap: 1 }}>
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

                                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                                        <View style={styles.pctPill}>
                                            <Ionicons
                                                name="stats-chart-outline"
                                                size={12}
                                                color={COLORS.primarySoft}
                                            />
                                            <Text style={styles.pctText}>{pct}%</Text>
                                        </View>

                                        <View style={styles.amountPill}>
                                            <Text style={styles.amountText}>
                                                R$ {money(item.amountToday)}
                                            </Text>
                                        </View>
                                    </View>
                                </View>

                                <ProgressBar done={done} total={Math.max(1, total)} />

                                <View style={styles.metricsRow}>
                                    <View style={[styles.miniStat, styles.miniOk]}>
                                        <Ionicons
                                            name="checkmark"
                                            size={12}
                                            color={COLORS.visitedSoft}
                                        />
                                        <Text style={[styles.miniText, { color: COLORS.visitedSoft }]}>
                                            {item.visitedToday}
                                        </Text>
                                    </View>

                                    <View style={[styles.miniStat, styles.miniBad]}>
                                        <Ionicons
                                            name="close"
                                            size={12}
                                            color={COLORS.rejectedSoft}
                                        />
                                        <Text style={[styles.miniText, { color: COLORS.rejectedSoft }]}>
                                            {item.rejectedToday}
                                        </Text>
                                    </View>

                                    <View style={[styles.miniStat, styles.miniWarn]}>
                                        <Ionicons
                                            name="time"
                                            size={12}
                                            color={COLORS.pendingSoft}
                                        />
                                        <Text style={[styles.miniText, { color: COLORS.pendingSoft }]}>
                                            {item.pending}
                                        </Text>
                                    </View>

                                    <View style={[styles.miniStat, styles.miniNeutral]}>
                                        <Ionicons name="people" size={12} color={COLORS.text} />
                                        <Text style={[styles.miniText, { color: COLORS.text }]}>
                                            {item.assignedToday}
                                        </Text>
                                    </View>
                                </View>

                                <View style={styles.actionsRow}>
                                    <View style={styles.rateChip}>
                                        <Ionicons name="cash-outline" size={12} color={COLORS.muted} />
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
                            <Ionicons name="analytics-outline" size={20} color={COLORS.muted} />
                            <Text style={styles.emptyText}>
                                {q.trim() ? "Sin resultados." : "Sin datos aún."}
                            </Text>
                        </View>
                    }
                />

                <Modal visible={listOpen} transparent animationType="fade" onRequestClose={closeList}>
                    <Pressable style={styles.modalBackdrop} onPress={closeList} />

                    <View style={[styles.modalCard, { paddingBottom: Math.max(12, insets.bottom + 10) }]}>
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
                                    {modalSections.reduce((a, s) => a + (s.data?.length ?? 0), 0) === 1
                                        ? ""
                                        : "s"}
                                </Text>
                            </View>

                            <Pressable
                                onPress={closeList}
                                style={({ pressed }) => [
                                    styles.modalClose,
                                    pressed && styles.modalClosePressed,
                                ]}
                            >
                                <Ionicons name="close" size={16} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <View style={styles.modalSearch}>
                            <Ionicons name="search-outline" size={16} color={COLORS.muted} />
                            <TextInput
                                value={listQ}
                                onChangeText={setListQ}
                                placeholder="Buscar cliente, negocio, teléfono…"
                                placeholderTextColor={COLORS.muted}
                                style={styles.modalSearchInput}
                            />
                            {!!listQ ? (
                                <Pressable onPress={() => setListQ("")} style={styles.modalSearchClear}>
                                    <Ionicons name="close" size={16} color={COLORS.text} />
                                </Pressable>
                            ) : null}
                        </View>

                        <FlatList
                            data={modalSections}
                            keyExtractor={(s) => s.userId}
                            contentContainerStyle={{ paddingTop: 4, paddingBottom: 8, gap: 8 }}
                            showsVerticalScrollIndicator={false}
                            renderItem={({ item: section }) => (
                                <View style={styles.modalSectionCard}>
                                    <View style={styles.modalSectionHeader}>
                                        <View style={{ flex: 1, gap: 1 }}>
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

                                    <View style={{ gap: 8, marginTop: 8 }}>
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
                                    <Ionicons name="people-outline" size={20} color={COLORS.muted} />
                                    <Text style={styles.modalEmptyText}>No hay clientes aquí.</Text>
                                </View>
                            }
                        />
                    </View>
                </Modal>

                <Modal visible={assignOpen} transparent animationType="fade" onRequestClose={closeAssign}>
                    <Pressable style={styles.modalBackdrop} onPress={closeAssign} />

                    <View style={[styles.modalCard, { paddingBottom: Math.max(12, insets.bottom + 10) }]}>
                        <View style={styles.modalHeader}>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text style={styles.modalTitle}>Reasignar a usuario</Text>
                                <Text style={styles.modalSub}>Selecciona un cobrador</Text>
                            </View>

                            <Pressable
                                onPress={closeAssign}
                                style={({ pressed }) => [
                                    styles.modalClose,
                                    pressed && styles.modalClosePressed,
                                ]}
                            >
                                <Ionicons name="close" size={16} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <View style={styles.modalSearch}>
                            <Ionicons name="search-outline" size={16} color={COLORS.muted} />
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
                                    <Ionicons name="close" size={16} color={COLORS.text} />
                                </Pressable>
                            ) : null}
                        </View>

                        <FlatList
                            data={filteredUsersForAssign}
                            keyExtractor={(u) => u.id}
                            contentContainerStyle={{ paddingTop: 4, paddingBottom: 8, gap: 8 }}
                            showsVerticalScrollIndicator={false}
                            renderItem={({ item }) => (
                                <Pressable
                                    onPress={() => doAssign(item.id)}
                                    style={({ pressed }) => [
                                        styles.userPickRow,
                                        pressed && styles.userPickRowPressed,
                                    ]}
                                >
                                    <View style={styles.userPickAvatar}>
                                        <Ionicons name="person-outline" size={14} color={COLORS.text} />
                                    </View>
                                    <View style={{ flex: 1, gap: 1 }}>
                                        <Text style={styles.userPickName} numberOfLines={1}>
                                            {item.name}
                                        </Text>
                                        <Text style={styles.userPickEmail} numberOfLines={1}>
                                            {item.email || "—"}
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
                                </Pressable>
                            )}
                            ListEmptyComponent={
                                <View style={styles.modalEmpty}>
                                    <Ionicons name="person-outline" size={20} color={COLORS.muted} />
                                    <Text style={styles.modalEmptyText}>No hay usuarios.</Text>
                                </View>
                            }
                        />

                        <Text style={styles.modalHint}>
                            * Esto cambia el assignedTo del cliente y lo deja pending en UI.
                        </Text>
                    </View>
                </Modal>

                <Modal visible={moneyOpen} transparent animationType="fade" onRequestClose={() => setMoneyOpen(false)}>
                    <Pressable style={styles.modalBackdrop} onPress={() => setMoneyOpen(false)} />

                    <View style={[styles.modalCard, { paddingBottom: Math.max(12, insets.bottom + 10) }]}>
                        <View style={styles.modalHeader}>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text style={styles.modalTitle}>Visitados e ingresos</Text>
                                <Text style={styles.modalSub}>
                                    {totals.visitedToday} visitado{totals.visitedToday === 1 ? "" : "s"} · R$ {money(totals.amountToday)}
                                </Text>
                            </View>

                            <Pressable
                                onPress={() => setMoneyOpen(false)}
                                style={({ pressed }) => [
                                    styles.modalClose,
                                    pressed && styles.modalClosePressed,
                                ]}
                            >
                                <Ionicons name="close" size={16} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <FlatList
                            data={earningRows}
                            keyExtractor={(r) => `money-${r.userId}`}
                            contentContainerStyle={{ paddingTop: 4, paddingBottom: 8, gap: 8 }}
                            showsVerticalScrollIndicator={false}
                            renderItem={({ item }) => (
                                <View style={styles.moneyRowCard}>
                                    <View style={{ flex: 1, gap: 1 }}>
                                        <Text style={styles.moneyRowName} numberOfLines={1}>
                                            {item.name}
                                        </Text>
                                        <Text style={styles.moneyRowMeta} numberOfLines={1}>
                                            {item.visitedToday} visitado{item.visitedToday === 1 ? "" : "s"} · R$ {money(item.ratePerVisit)}/visita
                                        </Text>
                                    </View>

                                    <View style={styles.moneyRowRight}>
                                        <View style={styles.moneyVisitsPill}>
                                            <Ionicons name="checkmark" size={11} color={COLORS.visitedSoft} />
                                            <Text style={styles.moneyVisitsText}>{item.visitedToday}</Text>
                                        </View>

                                        <View style={styles.moneyAmountPill}>
                                            <Text style={styles.moneyAmountText}>R$ {money(item.amountToday)}</Text>
                                        </View>
                                    </View>
                                </View>
                            )}
                            ListEmptyComponent={
                                <View style={styles.modalEmpty}>
                                    <Ionicons name="cash-outline" size={20} color={COLORS.muted} />
                                    <Text style={styles.modalEmptyText}>Aún no hay ingresos hoy.</Text>
                                </View>
                            }
                        />
                    </View>
                </Modal>
            </AdminBackground>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#0F172A",
    border: "rgba(255,255,255,0.07)",
    text: "#F8FAFC",
    muted: "#94A3B8",
    muted2: "#CBD5E1",

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
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },

    header: {
        paddingHorizontal: 14,
        paddingBottom: 8,
        paddingTop: 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    hTitle: {
        color: COLORS.text,
        fontSize: 19,
        fontWeight: "900",
        letterSpacing: 0.2,
    },
    hSub: {
        marginTop: 1,
        fontSize: 11,
        fontWeight: "800",
    },
    hStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },
    hMuted: {
        color: COLORS.muted,
        fontWeight: "800",
    },

    moneyChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 9,
        height: 30,
        borderRadius: 999,
        backgroundColor: "rgba(167,243,208,0.08)",
        borderWidth: 1,
        borderColor: "rgba(167,243,208,0.18)",
    },
    moneyChipPressed: {
        transform: [{ scale: 0.98 }],
        opacity: 0.96,
    },
    moneyChipText: {
        color: COLORS.money,
        fontWeight: "900",
        fontSize: 11,
    },

    iconBtn: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    iconBtnPressed: {
        transform: [{ scale: 0.97 }],
        opacity: 0.96,
    },
    iconBtnDisabled: {
        opacity: 0.5,
    },

    statsRow: {
        paddingHorizontal: 14,
        paddingBottom: 8,
        flexDirection: "row",
        gap: 8,
    },
    statIconWrap: {
        flex: 1,
        height: 38,
        borderRadius: 13,
        backgroundColor: "rgba(255,255,255,0.035)",
        borderWidth: 1,
        borderColor: COLORS.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    statIconWrapPressed: {
        transform: [{ scale: 0.985 }],
        opacity: 0.96,
    },
    statIcon: {
        width: 24,
        height: 24,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    statValue: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 12,
    },

    searchWrap: {
        marginHorizontal: 14,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: "rgba(255,255,255,0.035)",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        paddingHorizontal: 11,
        height: 40,
    },
    searchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "700",
        paddingVertical: 0,
    },
    clearBtn: {
        width: 28,
        height: 28,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },

    listContent: {
        paddingHorizontal: 14,
        gap: 10,
    },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 16,
        padding: 12,
        gap: 9,
    },
    cardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
    },

    userName: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },
    userEmail: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
    },
    userEmailMuted: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
        opacity: 0.7,
    },

    pctPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        minWidth: 58,
        height: 26,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: "rgba(124,58,237,0.14)",
        borderWidth: 1,
        borderColor: "rgba(124,58,237,0.26)",
        justifyContent: "center",
    },
    pctText: {
        color: COLORS.primarySoft,
        fontWeight: "900",
        fontSize: 11,
    },

    amountPill: {
        height: 26,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: "rgba(34,197,94,0.08)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.18)",
        alignItems: "center",
        justifyContent: "center",
    },
    amountText: {
        color: COLORS.visitedSoft,
        fontWeight: "900",
        fontSize: 11,
    },

    progressTrack: {
        height: 7,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.045)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        backgroundColor: "rgba(34,197,94,0.52)",
    },

    metricsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
    miniStat: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 26,
        paddingHorizontal: 8,
        borderRadius: 999,
        borderWidth: 1,
    },
    miniText: {
        fontSize: 11,
        fontWeight: "900",
    },

    miniOk: {
        backgroundColor: "rgba(34,197,94,0.08)",
        borderColor: "rgba(34,197,94,0.18)",
    },
    miniBad: {
        backgroundColor: "rgba(248,113,113,0.08)",
        borderColor: "rgba(248,113,113,0.18)",
    },
    miniWarn: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.18)",
    },
    miniNeutral: {
        backgroundColor: "rgba(255,255,255,0.045)",
        borderColor: "rgba(255,255,255,0.08)",
    },

    actionsRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 1,
    },
    rateChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 30,
        paddingHorizontal: 9,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.035)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    rateText: {
        color: COLORS.text,
        opacity: 0.94,
        fontSize: 11,
        fontWeight: "900",
    },
    rateTextMuted: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
    },

    empty: {
        marginTop: 34,
        alignItems: "center",
        gap: 8,
    },
    emptyText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
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
        maxHeight: "82%",
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

    modalSearch: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: "rgba(255,255,255,0.035)",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        paddingHorizontal: 11,
        height: 40,
    },
    modalSearchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "700",
        paddingVertical: 0,
    },
    modalSearchClear: {
        width: 28,
        height: 28,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
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
    modalHint: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
        opacity: 0.9,
    },

    modalSectionCard: {
        borderRadius: 15,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        backgroundColor: "rgba(255,255,255,0.025)",
        padding: 10,
    },
    modalSectionHeader: {
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
    modalCountPill: {
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
    modalCountText: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 11,
    },

    modalClientCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        backgroundColor: "rgba(255,255,255,0.025)",
    },
    modalClientPhone: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    modalClientMeta: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
    },
    modalClientAssigned: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
        marginTop: 2,
    },
    modalClientAssignedStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },

    rejectTag: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 8,
        minHeight: 24,
        borderRadius: 999,
        backgroundColor: "rgba(248,113,113,0.08)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.22)",
        marginTop: 5,
    },
    rejectTagText: {
        color: COLORS.rejectedSoft,
        fontSize: 11,
        fontWeight: "900",
        flexShrink: 1,
    },

    rejectTagMuted: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 8,
        height: 24,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.045)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.09)",
        marginTop: 5,
    },
    rejectTagTextMuted: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
    },

    modalReassignBtn: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.09)",
        alignItems: "center",
        justifyContent: "center",
    },
    modalReassignBtnPressed: {
        transform: [{ scale: 0.97 }],
        opacity: 0.96,
    },
    modalReassignPlaceholder: {
        width: 36,
        height: 36,
    },

    userPickRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        backgroundColor: "rgba(255,255,255,0.025)",
    },
    userPickRowPressed: {
        transform: [{ scale: 0.99 }],
        opacity: 0.95,
    },
    userPickAvatar: {
        width: 32,
        height: 32,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.09)",
    },
    userPickName: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    userPickEmail: {
        color: COLORS.muted,
        fontWeight: "700",
        fontSize: 11,
    },

    moneyRowCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        backgroundColor: "rgba(255,255,255,0.025)",
    },
    moneyRowName: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    moneyRowMeta: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
    },
    moneyRowRight: {
        alignItems: "flex-end",
        gap: 6,
    },
    moneyVisitsPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 22,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: "rgba(34,197,94,0.08)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.18)",
    },
    moneyVisitsText: {
        color: COLORS.visitedSoft,
        fontWeight: "900",
        fontSize: 10,
    },
    moneyAmountPill: {
        height: 24,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: "rgba(167,243,208,0.08)",
        borderWidth: 1,
        borderColor: "rgba(167,243,208,0.18)",
        justifyContent: "center",
        alignItems: "center",
    },
    moneyAmountText: {
        color: COLORS.money,
        fontWeight: "900",
        fontSize: 10,
    },
});