import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    FlatList,
    Linking,
    Modal,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../src/auth/useAuth";
import { subscribeUserClients, updateClientStatus } from "../src/data/repositories/clientsRepo";
import { dayKeyFromMs, subscribeDailyEventsByRangeForUser } from "../src/data/repositories/dailyEventsRepo";
import type { ClientDoc, DailyEventDoc } from "../src/types/models";

type Filter = "pending" | "visited" | "rejected" | "all";
type RejectReason = "clavo" | "localizacion" | "otro";

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

function buildCopyText(c: ClientDoc): string {
    const name = ((c as any).name ?? "").trim();
    const business = ((c as any).business ?? "").trim();
    const phone = (c.phone ?? "").trim();
    const mapsUrl = (c.mapsUrl ?? "").trim();
    const address = (c.address ?? "").trim();

    const lines: string[] = [];
    if (name) lines.push(`Nombre: ${name}`);
    if (business) lines.push(`Negocio: ${business}`);
    if (phone) lines.push(`Teléfono: ${phone}`);
    if (mapsUrl) lines.push(`Maps: ${mapsUrl}`);
    if (address) lines.push(`Dirección: ${address}`);

    return lines.join("\n");
}

function statusLabel(s?: string) {
    if (s === "visited") return "Visitado";
    if (s === "rejected") return "Rechazado";
    return "Pendiente";
}

function statusPillStyle(s?: string) {
    if (s === "visited") return styles.pillVisited;
    if (s === "rejected") return styles.pillRejected;
    return styles.pillPending;
}

function statusPillTextStyle(s?: string) {
    if (s === "visited") return styles.pillTextVisited;
    if (s === "rejected") return styles.pillTextRejected;
    return styles.pillTextPending;
}

function normalizeHttpUrl(raw: string) {
    const u = (raw ?? "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) return `https://${u}`;
    return u;
}

function normalizeBRPhoneToWa(phoneRaw: string) {
    const digits = (phoneRaw ?? "").replace(/[^\d]/g, "");
    if (!digits) return "";
    return digits.startsWith("55") ? digits : `55${digits}`;
}

type Toast = { id: string; text: string; createdAt: number };

function buildNewClientToast(c: ClientDoc) {
    const business = ((c as any).business ?? "").trim();
    const name = ((c as any).name ?? "").trim();
    const label = business || name;
    return label ? `Cliente nuevo · ${label}` : "Cliente nuevo";
}

function pickFirstName(full?: string) {
    const t = (full ?? "").trim();
    if (!t) return "";
    return t.split(/\s+/)[0] ?? "";
}

function notesStorageKey(uid: string) {
    return `trackgo:userNotes:${uid}`;
}

type NotesMap = Record<string, string>;

/** ✅ Semana local: Lunes → Domingo */
function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function weekRangeKeys(base = new Date()) {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);
    const jsDay = d.getDay(); // 0=Dom..6=Sáb
    const diffToMonday = jsDay === 0 ? 6 : jsDay - 1; // lunes=0
    const start = new Date(d);
    start.setDate(d.getDate() - diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { startKey: dayKeyFromDate(start), endKey: dayKeyFromDate(end) };
}

export default function UserHome() {
    const { firebaseUser, profile, loading, logout } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [filter, setFilter] = useState<Filter>("pending");
    const [q, setQ] = useState("");

    const [weekEvents, setWeekEvents] = useState<DailyEventDoc[]>([]);
    const [eventsErr, setEventsErr] = useState<string | null>(null);

    const [toasts, setToasts] = useState<Toast[]>([]);
    const prevClientIdsRef = useRef<Set<string>>(new Set());
    const initialClientsLoadedRef = useRef(false);

    const [notesByClientId, setNotesByClientId] = useState<NotesMap>({});
    const [noteModalOpen, setNoteModalOpen] = useState(false);
    const [noteClientId, setNoteClientId] = useState<string | null>(null);
    const [noteDraft, setNoteDraft] = useState("");
    const saveNotesTimer = useRef<any>(null);

    const helloName = useMemo(() => {
        const n = pickFirstName(profile?.name ?? "");
        return n ? ` · Hola ${n}` : "";
    }, [profile?.name]);

    const todayDayKey = useMemo(() => dayKeyFromMs(Date.now()), []);
    const weekRange = useMemo(() => weekRangeKeys(new Date()), [todayDayKey]);
    const weekLabel = useMemo(() => `${weekRange.startKey} → ${weekRange.endKey}`, [weekRange.startKey, weekRange.endKey]);

    // -------------------------
    // Guard
    // -------------------------
    useEffect(() => {
        if (loading) return;

        if (!firebaseUser) {
            router.replace({ pathname: "/login" as any });
            return;
        }

        if (!profile || !profile.active) {
            router.replace({ pathname: "/no-access" as any });
            return;
        }

        if (profile.role !== "user") {
            router.replace({ pathname: "/admin" as any });
            return;
        }
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active]);

    // -------------------------
    // Load notes
    // -------------------------
    useEffect(() => {
        if (!firebaseUser?.uid) return;

        let mounted = true;
        (async () => {
            try {
                const raw = await AsyncStorage.getItem(notesStorageKey(firebaseUser.uid));
                if (!mounted) return;
                if (!raw) {
                    setNotesByClientId({});
                    return;
                }
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") setNotesByClientId(parsed as NotesMap);
                else setNotesByClientId({});
            } catch {
                setNotesByClientId({});
            }
        })();

        return () => {
            mounted = false;
        };
    }, [firebaseUser?.uid]);

    // -------------------------
    // Persist notes (debounced)
    // -------------------------
    useEffect(() => {
        if (!firebaseUser?.uid) return;

        if (saveNotesTimer.current) clearTimeout(saveNotesTimer.current);

        saveNotesTimer.current = setTimeout(async () => {
            try {
                await AsyncStorage.setItem(notesStorageKey(firebaseUser.uid), JSON.stringify(notesByClientId ?? {}));
            } catch { }
        }, 350);

        return () => {
            if (saveNotesTimer.current) clearTimeout(saveNotesTimer.current);
        };
    }, [notesByClientId, firebaseUser?.uid]);

    // -------------------------
    // Subs clients + toasts
    // -------------------------
    useEffect(() => {
        if (!firebaseUser) return;

        const unsub = subscribeUserClients(firebaseUser.uid, (list) => {
            setClients(list);

            const prev = prevClientIdsRef.current;

            if (!initialClientsLoadedRef.current) {
                initialClientsLoadedRef.current = true;
                prev.clear();
                for (const c of list) prev.add(c.id);
                return;
            }

            const newOnes: ClientDoc[] = [];
            for (const c of list) {
                if (!prev.has(c.id)) newOnes.push(c);
            }

            prev.clear();
            for (const c of list) prev.add(c.id);

            if (newOnes.length) {
                const now = Date.now();
                const nextToasts: Toast[] = newOnes.slice(0, 2).map((c) => ({
                    id: `${c.id}-${now}`,
                    text: buildNewClientToast(c),
                    createdAt: now,
                }));

                setToasts((prevToasts) => [...nextToasts, ...prevToasts].slice(0, 3));

                for (const t of nextToasts) {
                    setTimeout(() => {
                        setToasts((p) => p.filter((x) => x.id !== t.id));
                    }, 3800);
                }
            }

            // cleanup notes
            setNotesByClientId((prevNotes) => {
                const alive = new Set(list.map((c) => c.id));
                let changed = false;
                const next: NotesMap = { ...prevNotes };
                for (const id of Object.keys(next)) {
                    if (!alive.has(id)) {
                        delete next[id];
                        changed = true;
                    }
                }
                return changed ? next : prevNotes;
            });
        });

        return () => unsub();
    }, [firebaseUser?.uid]);

    // -------------------------
    // Subs week events
    // -------------------------
    useEffect(() => {
        if (!firebaseUser?.uid) return;

        const { startKey, endKey } = weekRange;

        const unsub = subscribeDailyEventsByRangeForUser(
            startKey,
            endKey,
            firebaseUser.uid,
            (list) => {
                setEventsErr(null);
                setWeekEvents(list ?? []);
            },
            (err) => {
                setEventsErr(`${err?.code ?? "error"}: ${err?.message ?? ""}`);
            }
        );

        return () => unsub();
    }, [firebaseUser?.uid, weekRange.startKey, weekRange.endKey]);

    const pendingNowCount = useMemo(() => clients.filter((c) => c.status === "pending").length, [clients]);

    const weekLatestByClient = useMemo(() => {
        const last = new Map<string, DailyEventDoc>();

        for (const e of weekEvents) {
            if (e.type !== "visited" && e.type !== "rejected" && e.type !== "pending") continue;
            if (!e.clientId) continue;

            const prev = last.get(e.clientId);
            if (!prev || (e.createdAt ?? 0) > (prev.createdAt ?? 0)) last.set(e.clientId, e);
        }

        return last;
    }, [weekEvents]);

    const weekVisitedIds = useMemo(() => {
        const s = new Set<string>();
        for (const e of weekLatestByClient.values()) if (e.type === "visited" && e.clientId) s.add(e.clientId);
        return s;
    }, [weekLatestByClient]);

    const weekRejectedIds = useMemo(() => {
        const s = new Set<string>();
        for (const e of weekLatestByClient.values()) if (e.type === "rejected" && e.clientId) s.add(e.clientId);
        return s;
    }, [weekLatestByClient]);

    const weekCounts = useMemo(() => {
        let visited = 0;
        let rejected = 0;
        for (const e of weekLatestByClient.values()) {
            if (e.type === "visited") visited += 1;
            if (e.type === "rejected") rejected += 1;
        }
        return { visited, rejected };
    }, [weekLatestByClient]);

    const pendingPriorityMap = useMemo(() => {
        const pendingOnly = clients
            .filter((c) => c.status === "pending")
            .slice()
            .sort((a, b) => {
                const aKey = (a.createdAt ?? a.assignedAt ?? a.updatedAt ?? 0) as number;
                const bKey = (b.createdAt ?? b.assignedAt ?? b.updatedAt ?? 0) as number;
                return aKey - bKey;
            });

        const map = new Map<string, number>();
        pendingOnly.forEach((c, idx) => map.set(c.id, idx + 1));
        return map;
    }, [clients]);

    const counts = useMemo(() => {
        const pending = pendingNowCount;
        const visited = weekCounts.visited;
        const rejected = weekCounts.rejected;
        const total = pending + visited + rejected;
        return { pending, visited, rejected, total };
    }, [pendingNowCount, weekCounts.visited, weekCounts.rejected]);

    const filteredClients = useMemo(() => {
        const queryText = q.trim().toLowerCase();

        const base = clients.filter((c) => {
            if (filter === "pending") {
                if (c.status !== "pending") return false;
            } else if (filter === "visited") {
                if (!weekVisitedIds.has(c.id)) return false;
            } else if (filter === "rejected") {
                if (!weekRejectedIds.has(c.id)) return false;
            } else {
                const isPending = c.status === "pending";
                const isWeekV = weekVisitedIds.has(c.id);
                const isWeekR = weekRejectedIds.has(c.id);
                if (!isPending && !isWeekV && !isWeekR) return false;
            }

            if (!queryText) return true;

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

            return hay.includes(queryText);
        });

        const rank = (c: ClientDoc) => {
            if (c.status === "pending") return 0;
            if (weekVisitedIds.has(c.id)) return 1;
            if (weekRejectedIds.has(c.id)) return 2;
            return 3;
        };

        return base.sort((a, b) => {
            const ra = rank(a);
            const rb = rank(b);
            if (ra !== rb) return ra - rb;

            const aKey = (a.createdAt ?? a.assignedAt ?? a.updatedAt ?? 0) as number;
            const bKey = (b.createdAt ?? b.assignedAt ?? b.updatedAt ?? 0) as number;
            return aKey - bKey;
        });
    }, [clients, filter, q, weekVisitedIds, weekRejectedIds]);

    // -------------------------
    // External actions
    // -------------------------
    const openWhatsApp = async (phone: string) => {
        const waDigits = normalizeBRPhoneToWa(phone);
        if (!waDigits) {
            Alert.alert("WhatsApp", "Este cliente no tiene teléfono.");
            return;
        }
        const url = `https://wa.me/${waDigits}`;
        try {
            await Linking.openURL(url);
        } catch {
            Alert.alert("WhatsApp", "No se pudo abrir WhatsApp en este dispositivo.");
        }
    };

    const openMaps = async (mapsUrl?: string) => {
        const url = normalizeHttpUrl(mapsUrl ?? "");
        if (!url) {
            Alert.alert("Maps", "Este cliente no tiene link de Google Maps.");
            return;
        }
        try {
            await Linking.openURL(url);
        } catch {
            Alert.alert("Maps", "No se pudo abrir el link de Maps.");
        }
    };

    const copyClient = async (c: ClientDoc) => {
        const text = buildCopyText(c);
        await Clipboard.setStringAsync(text);
        Alert.alert("Copiado", "La información del cliente fue copiada.");
    };

    // -------------------------
    // Status handlers
    // -------------------------
    const doUpdateStatus = async (client: ClientDoc, nextStatus: "pending" | "visited" | "rejected", reason?: RejectReason) => {
        if (!firebaseUser || !client.id) return;

        const snapshot = {
            phone: client.phone,
            name: ((client as any).name ?? "").trim() || undefined,
            business: ((client as any).business ?? "").trim() || undefined,
        };

        try {
            setBusyId(client.id);
            await updateClientStatus(client.id, nextStatus, firebaseUser.uid, snapshot, reason);
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo actualizar el estado.");
        } finally {
            setBusyId(null);
        }
    };

    const confirmRejectedWithReason = (client: ClientDoc) => {
        Alert.alert("Rechazado por", "Selecciona el motivo:", [
            { text: "Cancelar", style: "cancel" },
            { text: "Clavo", onPress: () => doUpdateStatus(client, "rejected", "clavo") },
            { text: "Localización", onPress: () => doUpdateStatus(client, "rejected", "localizacion") },
            { text: "Otro", onPress: () => doUpdateStatus(client, "rejected", "otro") },
        ]);
    };

    const canRestoreToPendingToday = (client: ClientDoc) => {
        const at = (client.statusAt ?? client.updatedAt ?? 0) as number;
        if (!at) return false;
        return dayKeyFromMs(at) === todayDayKey;
    };

    const confirmSetStatus = (client: ClientDoc, nextStatus: "pending" | "visited" | "rejected") => {
        if (nextStatus === "rejected") {
            confirmRejectedWithReason(client);
            return;
        }

        if (nextStatus === "pending" && client.status !== "pending") {
            if (!canRestoreToPendingToday(client)) {
                Alert.alert("No permitido", "Solo puedes restaurar a Pendiente los clientes que visitaste o rechazaste HOY.");
                return;
            }
        }

        const title = nextStatus === "pending" ? "Volver a pendiente" : "Marcar como visitado";
        const msg =
            nextStatus === "pending"
                ? "¿Quieres quitar el estado actual y volver a Pendiente?"
                : "¿Confirmas que ya fue visitado?";

        Alert.alert(title, msg, [
            { text: "Cancelar", style: "cancel" },
            { text: "Confirmar", style: "default", onPress: () => doUpdateStatus(client, nextStatus) },
        ]);
    };

    const clearSearch = () => setQ("");

    // Notes handlers
    const openNoteModal = (clientId: string) => {
        const existing = (notesByClientId?.[clientId] ?? "").trim();
        setNoteClientId(clientId);
        setNoteDraft(existing);
        setNoteModalOpen(true);
    };

    const closeNoteModal = () => {
        setNoteModalOpen(false);
        setNoteClientId(null);
        setNoteDraft("");
    };

    const saveNote = () => {
        const cid = noteClientId;
        if (!cid) return;

        const text = (noteDraft ?? "").trim();

        setNotesByClientId((prev) => {
            const next: NotesMap = { ...(prev ?? {}) };
            if (!text) delete next[cid];
            else next[cid] = text;
            return next;
        });

        closeNoteModal();
    };

    const clearNote = () => {
        const cid = noteClientId;
        if (!cid) return;

        setNotesByClientId((prev) => {
            const next: NotesMap = { ...(prev ?? {}) };
            delete next[cid];
            return next;
        });

        closeNoteModal();
    };

    // UI atoms
    const MiniChip = ({
        active,
        onPress,
        icon,
        badge,
        label,
        tint,
        bg,
        border,
        showLabel,
    }: {
        active: boolean;
        onPress: () => void;
        icon: any;
        badge?: number;
        label?: string;
        tint?: string;
        bg?: string;
        border?: string;
        showLabel?: boolean;
    }) => (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.miniChip,
                { backgroundColor: bg ?? "#0F172A", borderColor: border ?? COLORS.border },
                active && styles.miniChipActive,
                pressed && styles.miniChipPressed,
            ]}
            accessibilityLabel={label ?? "Filtro"}
        >
            <Ionicons name={icon} size={10} color={tint ?? COLORS.text} />
            {showLabel && label ? (
                <Text style={[styles.miniChipText, active && styles.miniChipTextActive]}>{label}</Text>
            ) : null}
            {typeof badge === "number" ? (
                <View style={[styles.miniBadge, active && styles.miniBadgeActive]}>
                    <Text style={[styles.miniBadgeText, active && styles.miniBadgeTextActive]}>{badge}</Text>
                </View>
            ) : null}
        </Pressable>
    );

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
    }) => (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            style={({ pressed }) => [
                styles.iconBtn,
                disabled && styles.iconBtnDisabled,
                pressed && !disabled && styles.iconBtnPressed,
            ]}
            accessibilityLabel={label}
        >
            <Ionicons name={icon} size={18} color={COLORS.text} />
        </Pressable>
    );

    const StatusIconBtn = ({
        kind,
        onPress,
        disabled,
    }: {
        kind: "visited" | "rejected" | "undo";
        onPress: () => void;
        disabled?: boolean;
    }) => {
        const icon = kind === "visited" ? "checkmark" : kind === "rejected" ? "close" : "refresh";
        const tint = kind === "visited" ? COLORS.visited : kind === "rejected" ? COLORS.rejected : COLORS.text;

        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                style={({ pressed }) => [
                    styles.statusIconBtn,
                    kind === "visited" && styles.statusIconBtnVisited,
                    kind === "rejected" && styles.statusIconBtnRejected,
                    kind === "undo" && styles.statusIconBtnUndo,
                    disabled && styles.statusIconBtnDisabled,
                    pressed && !disabled && styles.statusIconBtnPressed,
                ]}
                accessibilityLabel={kind}
            >
                <Ionicons name={icon} size={18} color={tint} />
            </Pressable>
        );
    };

    const goHistory = () => {
        router.push({
            pathname: "/user-history" as any,
            params: { startKey: weekRange.startKey, endKey: weekRange.endKey },
        });
    };

    const renderItem = ({ item }: { item: ClientDoc }) => {
        const name = ((item as any).name ?? "").trim() || "Cliente";
        const business = ((item as any).business ?? "").trim();
        const phone = (item.phone ?? "").trim();
        const address = (item.address ?? "").trim();
        const mapsUrl = (item.mapsUrl ?? "").trim();
        const isBusy = busyId === item.id;

        const isPending = item.status === "pending";
        const localNote = (notesByClientId?.[item.id] ?? "").trim();

        const prio = isPending ? pendingPriorityMap.get(item.id) ?? null : null;
        const showPrio = !!prio && prio <= 3;

        const canUndo = item.status === "pending" ? false : canRestoreToPendingToday(item);

        return (
            <View style={styles.card}>
                {localNote ? (
                    <View style={styles.noteBanner}>
                        <Ionicons name="bookmark-outline" size={16} color={COLORS.pending} />
                        <Text style={styles.noteText} numberOfLines={3}>
                            {localNote}
                        </Text>
                    </View>
                ) : null}

                <View style={styles.cardTop}>
                    <View style={styles.cardTitleWrap}>
                        <View style={styles.titleRow}>
                            <Text numberOfLines={1} style={styles.clientName}>
                                {name}
                            </Text>

                            {showPrio ? (
                                <View style={styles.priorityPill}>
                                    <Ionicons name="flame-outline" size={14} color={COLORS.pending} />
                                    <Text style={styles.priorityText}>Prioridad #{prio}</Text>
                                </View>
                            ) : null}
                        </View>

                        {business ? (
                            <Text numberOfLines={1} style={styles.clientBusiness}>
                                {business}
                            </Text>
                        ) : null}
                    </View>

                    <View style={styles.cardTopRight}>
                        <Pressable
                            onPress={() => openNoteModal(item.id)}
                            disabled={isBusy}
                            style={({ pressed }) => [
                                styles.noteBtn,
                                isBusy && styles.noteBtnDisabled,
                                pressed && !isBusy && styles.noteBtnPressed,
                            ]}
                            accessibilityLabel="Nota del cliente"
                        >
                            <Ionicons name={localNote ? "create" : "create-outline"} size={16} color={COLORS.text} />
                        </Pressable>

                        <View style={[styles.pill, statusPillStyle(item.status)]}>
                            <Text style={[styles.pillText, statusPillTextStyle(item.status)]}>{statusLabel(item.status)}</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.cardInfo}>
                    {phone ? (
                        <View style={styles.infoRow}>
                            <Ionicons name="call-outline" size={16} color={COLORS.muted} />
                            <Text style={styles.infoText}>{phone}</Text>
                        </View>
                    ) : null}

                    {address ? (
                        <View style={styles.infoRow}>
                            <Ionicons name="location-outline" size={16} color={COLORS.muted} />
                            <Text numberOfLines={2} style={styles.infoText}>
                                {address}
                            </Text>
                        </View>
                    ) : null}
                </View>

                <View style={styles.actionsRow}>
                    <View style={styles.actionsLeft}>
                        <IconBtn icon="logo-whatsapp" label="Abrir WhatsApp" onPress={() => openWhatsApp(phone)} disabled={!phone || isBusy} />
                        <IconBtn icon="map-outline" label="Abrir Maps" onPress={() => openMaps(mapsUrl)} disabled={!mapsUrl || isBusy} />
                        <IconBtn icon="copy-outline" label="Copiar datos" onPress={() => copyClient(item)} disabled={isBusy} />
                    </View>

                    <View style={styles.actionsRight}>
                        {isPending ? (
                            <>
                                <StatusIconBtn kind="visited" onPress={() => confirmSetStatus(item, "visited")} disabled={isBusy} />
                                <StatusIconBtn kind="rejected" onPress={() => confirmSetStatus(item, "rejected")} disabled={isBusy} />
                            </>
                        ) : (
                            <StatusIconBtn kind="undo" onPress={() => confirmSetStatus(item, "pending")} disabled={isBusy || !canUndo} />
                        )}
                    </View>
                </View>

                {!isPending && !canUndo ? (
                    <View style={styles.lockHintRow}>
                        <Ionicons name="lock-closed-outline" size={14} color={COLORS.muted} />
                        <Text style={styles.lockHintText}>No se puede restaurar: solo el mismo día.</Text>
                    </View>
                ) : null}

                {isBusy ? (
                    <View style={styles.busyRow}>
                        <Text style={styles.busyText}>Actualizando…</Text>
                    </View>
                ) : null}
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            {/* 🔔 Top toasts */}
            <View pointerEvents="box-none" style={[styles.toastLayer, { top: Math.max(10, insets.top + 8) }]}>
                {toasts.map((t) => (
                    <View key={t.id} style={styles.toast}>
                        <Ionicons name="notifications-outline" size={16} color={COLORS.text} />
                        <Text style={styles.toastText} numberOfLines={2}>
                            {t.text}
                        </Text>
                        <Pressable onPress={() => setToasts((p) => p.filter((x) => x.id !== t.id))} style={styles.toastClose}>
                            <Ionicons name="close" size={16} color={COLORS.muted} />
                        </Pressable>
                    </View>
                ))}
            </View>

            <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 8) }]}>
                <View style={styles.headerLeft}>
                    <Text style={styles.hTitle}>
                        TrackGo<Text style={styles.hTitleSoft}>{helloName}</Text>
                    </Text>

                    <Text style={styles.hSub}>
                        Semana ({weekLabel}): <Text style={styles.hSubStrong}>{weekCounts.visited}</Text> visitados ·{" "}
                        <Text style={styles.hSubStrong}>{weekCounts.rejected}</Text> rechazados
                    </Text>

                    {eventsErr ? <Text style={styles.hErr}>{eventsErr}</Text> : null}
                </View>

                {/* ✅ Historial + Salir */}
                <View style={styles.headerRight}>
                    <Pressable onPress={goHistory} style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutBtnPressed]} accessibilityLabel="Historial">
                        <Ionicons name="time-outline" size={18} color={COLORS.text} />
                    </Pressable>

                    <Pressable onPress={logout} style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutBtnPressed]} accessibilityLabel="Salir">
                        <Ionicons name="log-out-outline" size={18} color={COLORS.text} />
                    </Pressable>
                </View>
            </View>

            <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar cliente, negocio, teléfono…"
                    placeholderTextColor={COLORS.muted}
                    style={styles.searchInput}
                />
                {!!q ? (
                    <Pressable onPress={clearSearch} style={styles.clearBtn}>
                        <Ionicons name="close" size={18} color={COLORS.text} />
                    </Pressable>
                ) : null}
            </View>

            {/* Filters */}
            <View style={styles.filtersRow}>
                <MiniChip
                    active={filter === "pending"}
                    onPress={() => setFilter("pending")}
                    icon="time-outline"
                    label="Pendientes"
                    showLabel
                    badge={counts.pending}
                    tint={COLORS.pending}
                    bg="rgba(251,191,36,0.08)"
                    border="rgba(251,191,36,0.30)"
                />

                <MiniChip
                    active={filter === "visited"}
                    onPress={() => setFilter("visited")}
                    icon="checkmark"
                    badge={counts.visited}
                    tint={COLORS.visited}
                    bg="rgba(34,197,94,0.08)"
                    border="rgba(34,197,94,0.28)"
                />

                <MiniChip
                    active={filter === "rejected"}
                    onPress={() => setFilter("rejected")}
                    icon="close"
                    badge={counts.rejected}
                    tint={COLORS.rejected}
                    bg="rgba(248,113,113,0.08)"
                    border="rgba(248,113,113,0.28)"
                />

                <MiniChip
                    active={filter === "all"}
                    onPress={() => setFilter("all")}
                    icon="apps-outline"
                    badge={counts.total}
                    tint={COLORS.text}
                    bg="rgba(255,255,255,0.05)"
                    border="rgba(255,255,255,0.10)"
                />
            </View>

            <FlatList
                data={filteredClients}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="people-outline" size={24} color={COLORS.muted} />
                        <Text style={styles.emptyText}>No hay clientes con ese filtro.</Text>
                    </View>
                }
            />

            {/* ✅ Modal Nota (local) */}
            <Modal visible={noteModalOpen} transparent animationType="fade" onRequestClose={closeNoteModal}>
                <Pressable style={styles.modalBackdrop} onPress={closeNoteModal} />
                <View style={styles.modalCard}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Nota del cliente</Text>
                        <Pressable onPress={closeNoteModal} style={({ pressed }) => [styles.modalClose, pressed && styles.modalClosePressed]}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    </View>

                    <TextInput
                        value={noteDraft}
                        onChangeText={setNoteDraft}
                        placeholder="Ej: Volver a las 5pm / Hablar con el dueño / Está ocupado por la mañana…"
                        placeholderTextColor={COLORS.muted}
                        style={styles.noteInput}
                        multiline
                    />

                    <View style={styles.modalActions}>
                        <Pressable onPress={clearNote} style={({ pressed }) => [styles.modalBtn, styles.modalBtnDanger, pressed && styles.modalBtnPressed]}>
                            <Ionicons name="trash-outline" size={18} color={COLORS.rejected} />
                            <Text style={styles.modalBtnTextDanger}>Borrar</Text>
                        </Pressable>

                        <Pressable onPress={saveNote} style={({ pressed }) => [styles.modalBtn, styles.modalBtnPrimary, pressed && styles.modalBtnPressed]}>
                            <Ionicons name="save-outline" size={18} color={COLORS.text} />
                            <Text style={styles.modalBtnText}>Guardar</Text>
                        </Pressable>
                    </View>

                    <Text style={styles.modalHint}>* Esta nota se guarda solo en tu teléfono. El admin no la ve.</Text>
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
    visited: "#22C55E",
    rejected: "#F87171",
    pending: "#FBBF24",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    toastLayer: {
        position: "absolute",
        left: 16,
        right: 16,
        zIndex: 50,
        gap: 10,
    },
    toast: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 16,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    toastText: {
        flex: 1,
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "800",
    },
    toastClose: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    header: {
        paddingHorizontal: 16,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerLeft: { flex: 1, gap: 2 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    hTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.5 },
    hTitleSoft: { color: COLORS.muted, fontWeight: "900" },
    hSub: { color: COLORS.muted, fontSize: 13, fontWeight: "700", marginTop: 2 },
    hSubStrong: { color: COLORS.text, fontWeight: "900" },
    hErr: { marginTop: 6, color: COLORS.rejected, fontSize: 12, fontWeight: "800" },

    logoutBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    logoutBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.95 },

    searchWrap: {
        marginHorizontal: 16,
        marginTop: 6,
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

    filtersRow: {
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
    },
    miniChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        height: 36,
        borderRadius: 999,
        borderWidth: 1,
    },
    miniChipActive: { borderColor: "rgba(255,255,255,0.20)" },
    miniChipPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },
    miniChipText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    miniChipTextActive: { color: COLORS.text },

    miniBadge: {
        minWidth: 24,
        height: 20,
        paddingHorizontal: 7,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },
    miniBadgeActive: { backgroundColor: "rgba(255,255,255,0.08)" },
    miniBadgeText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    miniBadgeTextActive: { color: COLORS.text },

    listContent: { paddingHorizontal: 16, paddingBottom: 22, paddingTop: 10, gap: 12 },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 12,
    },

    noteBanner: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(251,191,36,0.24)",
        backgroundColor: "rgba(251,191,36,0.10)",
    },
    noteText: {
        flex: 1,
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "800",
        opacity: 0.95,
    },

    cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
    cardTitleWrap: { flex: 1, gap: 2 },

    titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    clientName: { flex: 1, color: COLORS.text, fontSize: 16, fontWeight: "900" },

    priorityPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        backgroundColor: "rgba(251,191,36,0.10)",
        borderWidth: 1,
        borderColor: "rgba(251,191,36,0.28)",
    },
    priorityText: { color: "#FDE68A", fontSize: 12, fontWeight: "900" },

    clientBusiness: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },

    cardTopRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    noteBtn: {
        width: 38,
        height: 28,
        borderRadius: 12,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        alignItems: "center",
        justifyContent: "center",
    },
    noteBtnPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },
    noteBtnDisabled: { opacity: 0.45 },

    pill: {
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    pillText: { fontSize: 12, fontWeight: "900" },
    pillPending: { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.35)" },
    pillTextPending: { color: "#FDE68A" },
    pillVisited: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)" },
    pillTextVisited: { color: "#86EFAC" },
    pillRejected: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)" },
    pillTextRejected: { color: "#FCA5A5" },

    cardInfo: { gap: 6 },
    infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    infoText: { flex: 1, color: COLORS.text, opacity: 0.9, fontSize: 13, fontWeight: "700" },

    actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 2 },
    actionsLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    actionsRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    iconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    iconBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.96 },
    iconBtnDisabled: { opacity: 0.4 },

    statusIconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    statusIconBtnVisited: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.30)" },
    statusIconBtnRejected: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.30)" },
    statusIconBtnUndo: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" },
    statusIconBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.96 },
    statusIconBtnDisabled: { opacity: 0.5 },

    lockHintRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 },
    lockHintText: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    busyRow: { paddingTop: 4 },
    busyText: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    empty: { marginTop: 40, alignItems: "center", gap: 10 },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "800" },

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
    },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    modalTitle: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    modalClose: {
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        alignItems: "center",
        justifyContent: "center",
    },
    modalClosePressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },

    noteInput: {
        minHeight: 110,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 12,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
        textAlignVertical: "top",
    },

    modalActions: { flexDirection: "row", gap: 10 },
    modalBtn: {
        flex: 1,
        height: 48,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
    },
    modalBtnPrimary: { backgroundColor: "rgba(255,255,255,0.06)" },
    modalBtnDanger: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.28)" },
    modalBtnPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    modalBtnText: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    modalBtnTextDanger: { color: COLORS.rejected, fontSize: 13, fontWeight: "900" },
    modalHint: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.9 },
});