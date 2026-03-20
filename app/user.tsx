import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    FlatList,
    ImageBackground,
    KeyboardAvoidingView,
    Linking,
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

import bgMap from "../assets/bg-map.png";
import { useAuth } from "../src/auth/useAuth";
import { subscribeUserClients, updateClientStatus } from "../src/data/repositories/clientsRepo";
import { dayKeyFromMs, subscribeDailyEventsByRangeForUser } from "../src/data/repositories/dailyEventsRepo";
import type { ClientDoc, DailyEventDoc } from "../src/types/models";

type Filter = "pending" | "visited" | "rejected" | "all";
type RejectReason =
    | "clavo"
    | "localizacion"
    | "zona_riesgosa"
    | "ingresos_insuficientes"
    | "muy_endeudado"
    | "informacion_dudosa"
    | "no_le_interesa"
    | "no_estaba_cerrado"
    | "fuera_de_ruta"
    | "otro";

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

function buildWhatsAppPrefilledMessage() {
    return [
        "Olá! Sou o atendente responsável pela liberação do seu crédito no Escritório Crédito Comercial.",
        "",
        "Estou entrando em contato para dar continuidade ao seu atendimento e passar as orientações necessárias.",
        "",
        "Quando puder, me responda por aqui.",
    ].join("\n");
}

function reasonLabel(reason?: RejectReason | null) {
    switch (reason) {
        case "clavo":
            return "Clavo";
        case "localizacion":
            return "Localización lejana";
        case "zona_riesgosa":
            return "Zona riesgosa";
        case "ingresos_insuficientes":
            return "Ingresos insuficientes";
        case "muy_endeudado":
            return "Muy endeudado";
        case "informacion_dudosa":
            return "Información dudosa";
        case "no_le_interesa":
            return "No le interesa";
        case "no_estaba_cerrado":
            return "No estaba / cerrado";
        case "fuera_de_ruta":
            return "Fuera de ruta";
        case "otro":
            return "Otro";
        default:
            return "Motivo";
    }
}

function reasonIcon(reason?: RejectReason | null) {
    switch (reason) {
        case "clavo":
            return "warning-outline";
        case "localizacion":
            return "location-outline";
        case "zona_riesgosa":
            return "shield-outline";
        case "ingresos_insuficientes":
            return "cash-outline";
        case "muy_endeudado":
            return "alert-circle-outline";
        case "informacion_dudosa":
            return "help-circle-outline";
        case "no_le_interesa":
            return "close-circle-outline";
        case "no_estaba_cerrado":
            return "business-outline";
        case "fuera_de_ruta":
            return "navigate-outline";
        case "otro":
            return "ellipsis-horizontal";
        default:
            return "help-outline";
    }
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

function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function weekRangeKeys(base = new Date()) {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);
    const jsDay = d.getDay();
    const diffToMonday = jsDay === 0 ? 6 : jsDay - 1;
    const start = new Date(d);
    start.setDate(d.getDate() - diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { startKey: dayKeyFromDate(start), endKey: dayKeyFromDate(end) };
}

function formatTodayLabel(date = new Date()) {
    const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const dayName = days[date.getDay()];
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dayName} - ${dd}/${mm}/${yyyy}`;
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

/**
 * Último evento por clientId dentro del rango.
 * Solo considera visited / rejected / pending.
 */
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

    const [rejectModalOpen, setRejectModalOpen] = useState(false);
    const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
    const [rejectClient, setRejectClient] = useState<ClientDoc | null>(null);
    const [selectedRejectReason, setSelectedRejectReason] = useState<RejectReason | null>(null);
    const [otherRejectReason, setOtherRejectReason] = useState("");

    const [confirmVisitOpen, setConfirmVisitOpen] = useState(false);
    const [visitClient, setVisitClient] = useState<ClientDoc | null>(null);

    const helloName = useMemo(() => {
        const n = pickFirstName(profile?.name ?? "");
        return n ? n : "";
    }, [profile?.name]);

    const todayLabel = useMemo(() => formatTodayLabel(new Date()), []);
    const todayDayKey = useMemo(() => dayKeyFromMs(Date.now()), []);
    const weekRange = useMemo(() => weekRangeKeys(new Date()), [todayDayKey]);

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
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active, firebaseUser, profile, router]);

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

    useEffect(() => {
        if (!firebaseUser?.uid) return;

        if (saveNotesTimer.current) clearTimeout(saveNotesTimer.current);

        saveNotesTimer.current = setTimeout(async () => {
            try {
                await AsyncStorage.setItem(
                    notesStorageKey(firebaseUser.uid),
                    JSON.stringify(notesByClientId ?? {})
                );
            } catch { }
        }, 350);

        return () => {
            if (saveNotesTimer.current) clearTimeout(saveNotesTimer.current);
        };
    }, [notesByClientId, firebaseUser?.uid]);

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
    }, [firebaseUser?.uid, firebaseUser]);

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

    const clientById = useMemo(() => {
        const m = new Map<string, ClientDoc>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

    /**
     * Misma lógica del admin:
     * solo cuenta el evento si:
     * 1) el cliente todavía existe
     * 2) el status actual del cliente coincide con el type del evento
     */
    const shouldCountEvent = useCallback(
        (e: DailyEventDoc) => {
            const cid = (e as any)?.clientId as string | undefined;
            if (!cid) return false;

            const c = clientById.get(cid);
            if (!c) return false;

            return c.status === e.type;
        },
        [clientById]
    );

    const pendingNowCount = useMemo(
        () => clients.filter((c) => c.status === "pending").length,
        [clients]
    );

    const weekLatestByClient = useMemo(() => {
        return latestEventByClient(weekEvents);
    }, [weekEvents]);

    const todayEvents = useMemo(() => {
        return weekEvents.filter((e) => e.dayKey === todayDayKey);
    }, [weekEvents, todayDayKey]);

    const todayLatestByClient = useMemo(() => {
        return latestEventByClient(todayEvents);
    }, [todayEvents]);

    const weekVisitedIds = useMemo(() => {
        const s = new Set<string>();
        for (const e of weekLatestByClient.values()) {
            if ((e as any)?.type !== "visited") continue;
            if (!shouldCountEvent(e)) continue;

            const cid = (e as any)?.clientId as string | undefined;
            if (cid) s.add(cid);
        }
        return s;
    }, [weekLatestByClient, shouldCountEvent]);

    const weekRejectedIds = useMemo(() => {
        const s = new Set<string>();
        for (const e of weekLatestByClient.values()) {
            if ((e as any)?.type !== "rejected") continue;
            if (!shouldCountEvent(e)) continue;

            const cid = (e as any)?.clientId as string | undefined;
            if (cid) s.add(cid);
        }
        return s;
    }, [weekLatestByClient, shouldCountEvent]);

    const weekCounts = useMemo(() => {
        let visited = 0;
        let rejected = 0;

        for (const e of weekLatestByClient.values()) {
            if (!shouldCountEvent(e)) continue;

            if ((e as any)?.type === "visited") visited += 1;
            if ((e as any)?.type === "rejected") rejected += 1;
        }

        return { visited, rejected };
    }, [weekLatestByClient, shouldCountEvent]);

    const weekHandledCount = useMemo(() => {
        return weekCounts.visited + weekCounts.rejected;
    }, [weekCounts]);

    const currentWeekUnionCount = useMemo(() => {
        const ids = new Set<string>();

        for (const c of clients) {
            if (c.status === "pending") ids.add(c.id);
        }
        for (const id of weekVisitedIds) ids.add(id);
        for (const id of weekRejectedIds) ids.add(id);

        return ids.size;
    }, [clients, weekVisitedIds, weekRejectedIds]);

    const todayVisitedCount = useMemo(() => {
        let count = 0;
        for (const e of todayLatestByClient.values()) {
            if (!shouldCountEvent(e)) continue;
            if ((e as any)?.type === "visited") count += 1;
        }
        return count;
    }, [todayLatestByClient, shouldCountEvent]);

    const todayRejectedCount = useMemo(() => {
        let count = 0;
        for (const e of todayLatestByClient.values()) {
            if (!shouldCountEvent(e)) continue;
            if ((e as any)?.type === "rejected") count += 1;
        }
        return count;
    }, [todayLatestByClient, shouldCountEvent]);

    const todayHandledCount = useMemo(() => {
        return todayVisitedCount + todayRejectedCount;
    }, [todayVisitedCount, todayRejectedCount]);

    const pendingPriorityMap = useMemo(() => {
        const pendingOnly = clients
            .filter((c) => c.status === "pending")
            .slice()
            .sort((a, b) => {
                const aKey = toMs((a as any).createdAt ?? (a as any).assignedAt ?? (a as any).updatedAt);
                const bKey = toMs((b as any).createdAt ?? (b as any).assignedAt ?? (b as any).updatedAt);
                return aKey - bKey;
            });

        const map = new Map<string, number>();
        pendingOnly.forEach((c, idx) => map.set(c.id, idx + 1));
        return map;
    }, [clients]);

    const counts = useMemo(() => {
        return {
            pending: pendingNowCount,
            visited: weekCounts.visited,
            rejected: weekCounts.rejected,
            weekVisible: currentWeekUnionCount,
        };
    }, [pendingNowCount, weekCounts.visited, weekCounts.rejected, currentWeekUnionCount]);

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

            const aKey = toMs((a as any).createdAt ?? (a as any).assignedAt ?? (a as any).updatedAt);
            const bKey = toMs((b as any).createdAt ?? (b as any).assignedAt ?? (b as any).updatedAt);
            return aKey - bKey;
        });
    }, [clients, filter, q, weekVisitedIds, weekRejectedIds]);

    const openWhatsApp = async (phone: string) => {
        const waDigits = normalizeBRPhoneToWa(phone);
        if (!waDigits) {
            Alert.alert("WhatsApp", "Este cliente no tiene teléfono.");
            return;
        }

        const message = buildWhatsAppPrefilledMessage();
        const url = `https://wa.me/${waDigits}?text=${encodeURIComponent(message)}`;

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

    const doUpdateStatus = async (
        client: ClientDoc,
        nextStatus: "pending" | "visited" | "rejected",
        extra?:
            | RejectReason
            | {
                rejectedReason?: RejectReason;
                rejectedReasonText?: string | null;
                note?: string | null;
            }
    ) => {
        if (!firebaseUser || !client.id) return;

        const snapshot = {
            phone: client.phone,
            name: ((client as any).name ?? "").trim() || undefined,
            business: ((client as any).business ?? "").trim() || undefined,
        };

        try {
            setBusyId(client.id);
            await updateClientStatus(client.id, nextStatus, firebaseUser.uid, snapshot, extra as any);
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo actualizar el estado.");
        } finally {
            setBusyId(null);
        }
    };

    const resetRejectFlow = () => {
        setRejectModalOpen(false);
        setConfirmRejectOpen(false);
        setRejectClient(null);
        setSelectedRejectReason(null);
        setOtherRejectReason("");
    };

    const resetVisitFlow = () => {
        setConfirmVisitOpen(false);
        setVisitClient(null);
    };

    const confirmRejectedWithReason = (client: ClientDoc) => {
        setRejectClient(client);
        setSelectedRejectReason(null);
        setOtherRejectReason("");
        setRejectModalOpen(true);
    };

    const openConfirmVisited = (client: ClientDoc) => {
        setVisitClient(client);
        setConfirmVisitOpen(true);
    };

    const selectRejectReason = (reason: RejectReason) => {
        setSelectedRejectReason(reason);

        if (reason === "otro") return;

        setRejectModalOpen(false);
        setConfirmRejectOpen(true);
    };

    const continueRejectWithOther = () => {
        if (selectedRejectReason !== "otro") return;

        const text = otherRejectReason.trim();
        if (!text) {
            Alert.alert("Motivo requerido", "Escribe el motivo cuando elijas “Otro”.");
            return;
        }

        setRejectModalOpen(false);
        setConfirmRejectOpen(true);
    };

    const submitRejectReason = async () => {
        if (!rejectClient || !selectedRejectReason) return;

        const client = rejectClient;
        const reason = selectedRejectReason;
        const otherText = otherRejectReason.trim();

        if (reason === "otro" && !otherText) {
            Alert.alert("Motivo requerido", "Escribe el motivo cuando elijas “Otro”.");
            return;
        }

        resetRejectFlow();

        await doUpdateStatus(client, "rejected", {
            rejectedReason: reason,
            rejectedReasonText: reason === "otro" ? otherText : null,
            note: reason === "otro" ? otherText : null,
        });
    };

    const submitVisited = async () => {
        if (!visitClient) return;
        const client = visitClient;
        resetVisitFlow();
        await doUpdateStatus(client, "visited");
    };

    const canRestoreToPendingToday = (client: ClientDoc) => {
        const at = toMs((client as any).statusAt ?? (client as any).updatedAt);
        if (!at) return false;
        return dayKeyFromMs(at) === todayDayKey;
    };

    const confirmSetStatus = (
        client: ClientDoc,
        nextStatus: "pending" | "visited" | "rejected"
    ) => {
        if (nextStatus === "rejected") {
            confirmRejectedWithReason(client);
            return;
        }

        if (nextStatus === "visited") {
            openConfirmVisited(client);
            return;
        }

        if (nextStatus === "pending" && client.status !== "pending") {
            if (!canRestoreToPendingToday(client)) {
                Alert.alert(
                    "No permitido",
                    "Solo puedes restaurar a Pendiente los clientes que visitaste o rechazaste HOY."
                );
                return;
            }
        }

        Alert.alert("Volver a pendiente", "¿Quieres quitar el estado actual y volver a Pendiente?", [
            { text: "Cancelar", style: "cancel" },
            {
                text: "Confirmar",
                style: "default",
                onPress: () => doUpdateStatus(client, "pending"),
            },
        ]);
    };

    const clearSearch = () => setQ("");

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

    const goHistory = () => {
        router.push({
            pathname: "/user-history" as any,
            params: { startKey: weekRange.startKey, endKey: weekRange.endKey },
        });
    };

    const PortfolioMiniStat = ({
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
        <View style={styles.portfolioMiniStat}>
            <Ionicons name={icon} size={13} color={color} />
            <Text style={styles.portfolioMiniValue}>{value}</Text>
            <Text style={styles.portfolioMiniLabel} numberOfLines={1}>
                {label}
            </Text>
        </View>
    );

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
                { backgroundColor: bg ?? "rgba(255,255,255,0.05)", borderColor: border ?? COLORS.border },
                active && styles.miniChipActive,
                pressed && styles.miniChipPressed,
            ]}
            accessibilityLabel={label ?? "Filtro"}
        >
            <Ionicons name={icon} size={11} color={tint ?? COLORS.text} />
            {showLabel && label ? (
                <Text style={[styles.miniChipText, active && styles.miniChipTextActive]}>
                    {label}
                </Text>
            ) : null}
            {typeof badge === "number" ? (
                <View style={[styles.miniBadge, active && styles.miniBadgeActive]}>
                    <Text style={[styles.miniBadgeText, active && styles.miniBadgeTextActive]}>
                        {badge}
                    </Text>
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
        const tint =
            kind === "visited" ? COLORS.ok : kind === "rejected" ? COLORS.bad : COLORS.text;

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
                        <Ionicons name="bookmark-outline" size={15} color={COLORS.warn} />
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
                        </View>

                        {business ? (
                            <Text numberOfLines={1} style={styles.clientBusiness}>
                                {business}
                            </Text>
                        ) : null}
                    </View>

                    <View style={styles.cardTopRight}>
                        <View style={styles.statusColumn}>
                            <View style={[styles.pill, statusPillStyle(item.status)]}>
                                <Text style={[styles.pillText, statusPillTextStyle(item.status)]}>
                                    {statusLabel(item.status)}
                                </Text>
                            </View>

                            {showPrio ? (
                                <View style={styles.priorityPill}>
                                    <Ionicons name="flame-outline" size={13} color={COLORS.warn} />
                                    <Text style={styles.priorityText}>Prioridad #{prio}</Text>
                                </View>
                            ) : null}
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
                        <IconBtn
                            icon={localNote ? "create" : "create-outline"}
                            label="Nota del cliente"
                            onPress={() => openNoteModal(item.id)}
                            disabled={isBusy}
                        />
                        <IconBtn
                            icon="logo-whatsapp"
                            label="Abrir WhatsApp"
                            onPress={() => openWhatsApp(phone)}
                            disabled={!phone || isBusy}
                        />
                        <IconBtn
                            icon="map-outline"
                            label="Abrir Maps"
                            onPress={() => openMaps(mapsUrl)}
                            disabled={!mapsUrl || isBusy}
                        />
                        <IconBtn
                            icon="copy-outline"
                            label="Copiar datos"
                            onPress={() => copyClient(item)}
                            disabled={isBusy}
                        />
                    </View>

                    <View style={styles.actionsRight}>
                        {isPending ? (
                            <>
                                <StatusIconBtn
                                    kind="visited"
                                    onPress={() => confirmSetStatus(item, "visited")}
                                    disabled={isBusy}
                                />
                                <StatusIconBtn
                                    kind="rejected"
                                    onPress={() => confirmSetStatus(item, "rejected")}
                                    disabled={isBusy}
                                />
                            </>
                        ) : (
                            <StatusIconBtn
                                kind="undo"
                                onPress={() => confirmSetStatus(item, "pending")}
                                disabled={isBusy || !canUndo}
                            />
                        )}
                    </View>
                </View>

                {!isPending && !canUndo ? (
                    <View style={styles.lockHintRow}>
                        <Ionicons name="lock-closed-outline" size={14} color={COLORS.muted} />
                        <Text style={styles.lockHintText}>
                            No se puede restaurar: solo el mismo día.
                        </Text>
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
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            <ImageBackground
                source={bgMap}
                style={styles.bg}
                imageStyle={styles.bgImage}
                resizeMode="cover"
            >
                <View style={styles.overlay}>
                    <View
                        pointerEvents="box-none"
                        style={[styles.toastLayer, { top: Math.max(10, insets.top + 8) }]}
                    >
                        {toasts.map((t) => (
                            <View key={t.id} style={styles.toast}>
                                <Ionicons name="notifications-outline" size={16} color={COLORS.text} />
                                <Text style={styles.toastText} numberOfLines={2}>
                                    {t.text}
                                </Text>
                                <Pressable
                                    onPress={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
                                    style={styles.toastClose}
                                >
                                    <Ionicons name="close" size={16} color={COLORS.muted} />
                                </Pressable>
                            </View>
                        ))}
                    </View>

                    <FlatList
                        data={filteredClients}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[
                            styles.listContent,
                            { paddingBottom: 24 + Math.max(insets.bottom, 10) },
                        ]}
                        ListHeaderComponent={
                            <View>
                                <View style={[styles.header, { paddingTop: 12 }]}>
                                    <View style={styles.headerLeft}>
                                        <Text style={styles.hSub} numberOfLines={1}>
                                            Hola, <Text style={styles.hSubStrong}>{helloName || "Usuario"}</Text>
                                        </Text>
                                        <Text style={styles.hSubMuted} numberOfLines={1}>
                                            {todayLabel}
                                        </Text>
                                        {eventsErr ? <Text style={styles.hErr}>{eventsErr}</Text> : null}
                                    </View>


                                    <View style={styles.headerRight}>
                                        <Pressable
                                            onPress={() => router.push("/user-map" as any)}
                                            style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                                            accessibilityLabel="Mapa"
                                        >
                                            <Ionicons name="map-outline" size={18} color={COLORS.text} />
                                        </Pressable>

                                        <Pressable
                                            onPress={goHistory}
                                            style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                                            accessibilityLabel="Historial"
                                        >
                                            <Ionicons name="time-outline" size={18} color={COLORS.text} />
                                        </Pressable>

                                        <Pressable
                                            onPress={logout}
                                            style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                                            accessibilityLabel="Salir"
                                        >
                                            <Ionicons name="log-out-outline" size={18} color={COLORS.text} />
                                        </Pressable>
                                    </View>


                                </View>

                                <View style={styles.topCardsRow}>
                                    <View style={[styles.topCard, styles.activityCard]}>
                                        <View style={styles.bannerTop}>
                                            <View style={styles.bannerIconWrap}>
                                                <Ionicons name="today-outline" size={18} color={COLORS.text} />
                                            </View>
                                            <View style={[styles.badge, styles.badgeWarn]}>
                                                <Text style={[styles.badgeText, styles.badgeTextWarn]}>HOY</Text>
                                            </View>
                                        </View>

                                        <View style={styles.portfolioMainBlock}>
                                            <Text style={styles.portfolioMainValue}>{todayHandledCount}</Text>
                                            <Text style={styles.portfolioMainLabel}>Gestionados</Text>
                                        </View>

                                        <View style={styles.portfolioBottomRow}>
                                            <PortfolioMiniStat
                                                icon="checkmark-circle-outline"
                                                color={COLORS.ok}
                                                value={todayVisitedCount}
                                                label="Visitados"
                                            />
                                            <PortfolioMiniStat
                                                icon="close-circle-outline"
                                                color={COLORS.bad}
                                                value={todayRejectedCount}
                                                label="Rechazados"
                                            />
                                        </View>
                                    </View>

                                    <View style={[styles.topCard, styles.portfolioCard]}>
                                        <View style={styles.bannerTop}>
                                            <View style={styles.bannerIconWrap}>
                                                <Ionicons name="calendar-outline" size={18} color={COLORS.text} />
                                            </View>
                                            <View style={[styles.badge, styles.badgePrimarySoft]}>
                                                <Text style={[styles.badgeText, styles.badgeTextPrimarySoft]}>
                                                    SEMANA
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.portfolioMainBlock}>
                                            <Text style={styles.portfolioMainValue}>{weekHandledCount}</Text>
                                            <Text style={styles.portfolioMainLabel}>Resumen semanal</Text>
                                        </View>

                                        <View style={styles.portfolioBottomRow}>
                                            <PortfolioMiniStat
                                                icon="checkmark-circle-outline"
                                                color={COLORS.ok}
                                                value={weekCounts.visited}
                                                label="Visitados"
                                            />
                                            <PortfolioMiniStat
                                                icon="close-circle-outline"
                                                color={COLORS.bad}
                                                value={weekCounts.rejected}
                                                label="Rechazados"
                                            />
                                        </View>
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

                                <View style={styles.filtersRow}>
                                    <MiniChip
                                        active={filter === "pending"}
                                        onPress={() => setFilter("pending")}
                                        icon="time-outline"
                                        label="Pendientes"
                                        showLabel
                                        badge={counts.pending}
                                        tint={COLORS.warn}
                                        bg="rgba(251,191,36,0.08)"
                                        border="rgba(251,191,36,0.30)"
                                    />

                                    <MiniChip
                                        active={filter === "visited"}
                                        onPress={() => setFilter("visited")}
                                        icon="checkmark"
                                        badge={counts.visited}
                                        tint={COLORS.ok}
                                        bg="rgba(34,197,94,0.08)"
                                        border="rgba(34,197,94,0.28)"
                                    />

                                    <MiniChip
                                        active={filter === "rejected"}
                                        onPress={() => setFilter("rejected")}
                                        icon="close"
                                        badge={counts.rejected}
                                        tint={COLORS.bad}
                                        bg="rgba(248,113,113,0.08)"
                                        border="rgba(248,113,113,0.28)"
                                    />

                                    <MiniChip
                                        active={filter === "all"}
                                        onPress={() => setFilter("all")}
                                        icon="apps-outline"
                                        label="Esta semana"
                                        badge={counts.weekVisible}
                                        tint={COLORS.text}
                                        bg="rgba(255,255,255,0.05)"
                                        border="rgba(255,255,255,0.10)"
                                    />
                                </View>
                            </View>
                        }
                        ListEmptyComponent={
                            <View style={styles.empty}>
                                <Ionicons name="people-outline" size={24} color={COLORS.muted} />
                                <Text style={styles.emptyText}>No hay clientes con ese filtro.</Text>
                            </View>
                        }
                    />
                </View>
            </ImageBackground>

            <Modal visible={noteModalOpen} transparent animationType="fade" onRequestClose={closeNoteModal}>
                <Pressable style={styles.modalBackdrop} onPress={closeNoteModal} />
                <View style={[styles.modalCard, { bottom: Math.max(16, insets.bottom + 8) }]}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Nota del cliente</Text>
                        <Pressable
                            onPress={closeNoteModal}
                            style={({ pressed }) => [styles.modalClose, pressed && styles.modalClosePressed]}
                        >
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
                        <Pressable
                            onPress={clearNote}
                            style={({ pressed }) => [
                                styles.modalBtn,
                                styles.modalBtnDanger,
                                pressed && styles.modalBtnPressed,
                            ]}
                        >
                            <Ionicons name="trash-outline" size={18} color={COLORS.bad} />
                            <Text style={styles.modalBtnTextDanger}>Borrar</Text>
                        </Pressable>

                        <Pressable
                            onPress={saveNote}
                            style={({ pressed }) => [
                                styles.modalBtn,
                                styles.modalBtnPrimary,
                                pressed && styles.modalBtnPressed,
                            ]}
                        >
                            <Ionicons name="save-outline" size={18} color={COLORS.text} />
                            <Text style={styles.modalBtnText}>Guardar</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={rejectModalOpen}
                transparent
                animationType="fade"
                onRequestClose={resetRejectFlow}
            >
                <Pressable style={styles.modalBackdrop} onPress={resetRejectFlow} />

                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.rejectModalWrap}
                >
                    <View
                        style={[
                            styles.rejectModalCard,
                            {
                                bottom: Math.max(12, insets.bottom + 8),
                            },
                        ]}
                    >
                        <View style={styles.modalHeader}>
                            <View style={{ flex: 1, gap: 3 }}>
                                <Text style={styles.modalTitle}>Motivo del rechazo</Text>
                                <Text style={styles.rejectModalSub} numberOfLines={2}>
                                    {rejectClient
                                        ? `Selecciona el motivo para ${((rejectClient as any)?.name ?? (rejectClient as any)?.business ?? rejectClient.phone ?? "este cliente").toString().trim()}`
                                        : "Selecciona el motivo"}
                                </Text>
                            </View>

                            <Pressable onPress={resetRejectFlow} style={styles.modalClose}>
                                <Ionicons name="close" size={18} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <View style={styles.rejectGrid}>
                            {(
                                [
                                    "clavo",
                                    "localizacion",
                                    "zona_riesgosa",
                                    "ingresos_insuficientes",
                                    "muy_endeudado",
                                    "informacion_dudosa",
                                    "no_le_interesa",
                                    "no_estaba_cerrado",
                                    "fuera_de_ruta",
                                    "otro",
                                ] as RejectReason[]
                            ).map((reason) => {
                                const active = selectedRejectReason === reason;

                                return (
                                    <Pressable
                                        key={reason}
                                        style={({ pressed }) => [
                                            styles.rejectOption,
                                            active && styles.rejectOptionActive,
                                            pressed && styles.rejectOptionPressed,
                                        ]}
                                        onPress={() => selectRejectReason(reason)}
                                    >
                                        <Ionicons
                                            name={reasonIcon(reason) as any}
                                            size={18}
                                            color={reason === "clavo" ? COLORS.bad : COLORS.text}
                                        />
                                        <Text style={styles.rejectOptionText}>{reasonLabel(reason)}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {selectedRejectReason === "otro" ? (
                            <View style={styles.otherReasonWrap}>
                                <Text style={styles.otherReasonLabel}>Escribe el motivo *</Text>
                                <TextInput
                                    value={otherRejectReason}
                                    onChangeText={setOtherRejectReason}
                                    placeholder="Ej: dueño ausente, local en reforma, volver otro día…"
                                    placeholderTextColor={COLORS.muted}
                                    style={styles.otherReasonInput}
                                    multiline
                                />

                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={resetRejectFlow}
                                        style={({ pressed }) => [
                                            styles.modalBtn,
                                            pressed && styles.modalBtnPressed,
                                        ]}
                                    >
                                        <Text style={styles.modalBtnText}>Cancelar</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={continueRejectWithOther}
                                        style={({ pressed }) => [
                                            styles.modalBtn,
                                            styles.modalBtnPrimary,
                                            pressed && styles.modalBtnPressed,
                                        ]}
                                    >
                                        <Ionicons name="arrow-forward-outline" size={18} color={COLORS.text} />
                                        <Text style={styles.modalBtnText}>Continuar</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : null}
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal
                visible={confirmRejectOpen}
                transparent
                animationType="fade"
                onRequestClose={resetRejectFlow}
            >
                <Pressable style={styles.modalBackdrop} onPress={resetRejectFlow} />

                <View style={styles.confirmModalCard}>
                    <View style={styles.confirmIconWrap}>
                        <Ionicons
                            name={reasonIcon(selectedRejectReason) as any}
                            size={22}
                            color={COLORS.bad}
                        />
                    </View>

                    <Text style={styles.confirmTitle}>Confirmar rechazo</Text>

                    <Text style={styles.confirmText}>
                        ¿Seguro que quieres rechazar este cliente por{" "}
                        <Text style={styles.confirmTextStrong}>
                            {reasonLabel(selectedRejectReason)}
                        </Text>
                        ?
                    </Text>

                    {selectedRejectReason === "otro" && otherRejectReason.trim() ? (
                        <Text style={styles.confirmOtherReasonText}>
                            Motivo: {otherRejectReason.trim()}
                        </Text>
                    ) : null}

                    {!!rejectClient ? (
                        <Text style={styles.confirmClientText} numberOfLines={2}>
                            {(((rejectClient as any)?.name ??
                                (rejectClient as any)?.business ??
                                rejectClient.phone ??
                                "") as string).trim()}
                        </Text>
                    ) : null}

                    <View style={styles.confirmActions}>
                        <Pressable
                            onPress={resetRejectFlow}
                            style={({ pressed }) => [
                                styles.confirmBtn,
                                styles.confirmBtnGhost,
                                pressed && styles.modalBtnPressed,
                            ]}
                        >
                            <Text style={styles.confirmBtnGhostText}>Cancelar</Text>
                        </Pressable>

                        <Pressable
                            onPress={submitRejectReason}
                            style={({ pressed }) => [
                                styles.confirmBtn,
                                styles.confirmBtnDanger,
                                pressed && styles.modalBtnPressed,
                            ]}
                        >
                            <Text style={styles.confirmBtnDangerText}>Confirmar</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={confirmVisitOpen}
                transparent
                animationType="fade"
                onRequestClose={resetVisitFlow}
            >
                <Pressable style={styles.modalBackdrop} onPress={resetVisitFlow} />

                <View style={styles.confirmModalCard}>
                    <View style={styles.confirmIconWrapVisited}>
                        <Ionicons
                            name="checkmark-outline"
                            size={22}
                            color={COLORS.ok}
                        />
                    </View>

                    <Text style={styles.confirmTitle}>Confirmar visita</Text>

                    <Text style={styles.confirmText}>
                        ¿Seguro que quieres marcar este cliente como{" "}
                        <Text style={styles.confirmTextStrong}>Visitado</Text>?
                    </Text>

                    {!!visitClient ? (
                        <Text style={styles.confirmClientText} numberOfLines={2}>
                            {(((visitClient as any)?.name ??
                                (visitClient as any)?.business ??
                                visitClient.phone ??
                                "") as string).trim()}
                        </Text>
                    ) : null}

                    <View style={styles.confirmActions}>
                        <Pressable
                            onPress={resetVisitFlow}
                            style={({ pressed }) => [
                                styles.confirmBtn,
                                styles.confirmBtnGhost,
                                pressed && styles.modalBtnPressed,
                            ]}
                        >
                            <Text style={styles.confirmBtnGhostText}>Cancelar</Text>
                        </Pressable>

                        <Pressable
                            onPress={submitVisited}
                            style={({ pressed }) => [
                                styles.confirmBtn,
                                styles.confirmBtnVisited,
                                pressed && styles.modalBtnPressed,
                            ]}
                        >
                            <Text style={styles.confirmBtnVisitedText}>Confirmar</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "rgba(17, 24, 39, 0.72)",
    border: "rgba(255,255,255,0.08)",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",
    info: "#60A5FA",
    primarySoft: "#C4B5FD",
};

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },

    bg: {
        flex: 1,
    },

    bgImage: {
        opacity: 0.55,
    },

    overlay: {
        flex: 1,
        backgroundColor: "rgba(11,18,32,0.40)",
        paddingHorizontal: 16,
    },

    pressed: {
        transform: [{ scale: 0.99 }],
        opacity: 0.96,
    },

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
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        borderWidth: 1,
        borderColor: COLORS.border,
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
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerLeft: { flex: 1, gap: 3 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    hSub: {
        color: "#D1D5DB",
        fontSize: 14,
        fontWeight: "800",
    },
    hSubStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },
    hSubMuted: {
        color: "#CBD5E1",
        fontSize: 12,
        fontWeight: "700",
        opacity: 0.92,
    },
    hErr: {
        marginTop: 4,
        color: COLORS.bad,
        fontSize: 12,
        fontWeight: "800",
    },

    headerBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(15, 23, 42, 0.72)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },

    topCardsRow: {
        flexDirection: "row",
        gap: 12,
        marginTop: 8,
        marginBottom: 14,
        alignItems: "stretch",
    },

    topCard: {
        flex: 1,
        minHeight: 162,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.card,
        padding: 12,
        overflow: "hidden",
        justifyContent: "space-between",
    },

    activityCard: {
        justifyContent: "space-between",
    },

    portfolioCard: {
        justifyContent: "space-between",
    },

    badge: {
        paddingHorizontal: 8,
        height: 24,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0.4,
    },
    badgeWarn: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.35)",
    },
    badgeTextWarn: {
        color: "#FDE68A",
    },
    badgePrimarySoft: {
        backgroundColor: "rgba(96,165,250,0.12)",
        borderColor: "rgba(96,165,250,0.28)",
    },
    badgeTextPrimarySoft: {
        color: "#BFDBFE",
    },

    bannerTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    bannerIconWrap: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(15, 23, 42, 0.72)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },

    portfolioMainBlock: {
        alignItems: "center",
        justifyContent: "center",
        marginTop: 8,
        marginBottom: 10,
    },
    portfolioMainValue: {
        color: COLORS.text,
        fontSize: 28,
        fontWeight: "900",
        lineHeight: 32,
    },
    portfolioMainLabel: {
        color: "#CBD5E1",
        fontSize: 11,
        fontWeight: "800",
        marginTop: 2,
    },

    portfolioBottomRow: {
        flexDirection: "row",
        gap: 8,
    },
    portfolioMiniStat: {
        flex: 1,
        minHeight: 56,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 6,
    },
    portfolioMiniValue: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    portfolioMiniLabel: {
        color: "#CBD5E1",
        fontSize: 10,
        fontWeight: "800",
        textAlign: "center",
    },

    searchWrap: {
        marginBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 16,
        paddingHorizontal: 12,
        height: 48,
    },
    searchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
    },
    clearBtn: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    filtersRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 10,
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

    listContent: {
        paddingTop: 0,
        gap: 12,
    },

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

    cardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    cardTitleWrap: { flex: 1, gap: 2 },

    titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    clientName: { flex: 1, color: COLORS.text, fontSize: 16, fontWeight: "900" },

    statusColumn: {
        alignItems: "flex-end",
        gap: 6,
    },
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

    clientBusiness: { color: "#D1D5DB", fontSize: 13, fontWeight: "700" },

    cardTopRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    pill: {
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    pillText: { fontSize: 12, fontWeight: "900" },
    pillPending: {
        backgroundColor: "rgba(251,191,36,0.12)",
        borderColor: "rgba(251,191,36,0.35)",
    },
    pillTextPending: { color: "#FDE68A" },
    pillVisited: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.35)",
    },
    pillTextVisited: { color: "#86EFAC" },
    pillRejected: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.35)",
    },
    pillTextRejected: { color: "#FCA5A5" },

    cardInfo: { gap: 6 },
    infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    infoText: { flex: 1, color: COLORS.text, opacity: 0.9, fontSize: 13, fontWeight: "700" },

    actionsRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingTop: 2,
    },
    actionsLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    actionsRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    iconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(15, 23, 42, 0.72)",
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
        backgroundColor: "rgba(15, 23, 42, 0.72)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    statusIconBtnVisited: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.30)",
    },
    statusIconBtnRejected: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.30)",
    },
    statusIconBtnUndo: {
        backgroundColor: "rgba(255,255,255,0.06)",
        borderColor: "rgba(255,255,255,0.10)",
    },
    statusIconBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.96 },
    statusIconBtnDisabled: { opacity: 0.5 },

    lockHintRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 },
    lockHintText: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    busyRow: { paddingTop: 4 },
    busyText: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    empty: { marginTop: 40, alignItems: "center", gap: 10 },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "800" },

    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.55)",
    },
    modalCard: {
        position: "absolute",
        left: 16,
        right: 16,
        backgroundColor: "#111827",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        padding: 14,
        gap: 12,
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
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
    modalBtnDanger: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.28)",
    },
    modalBtnPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    modalBtnText: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    modalBtnTextDanger: { color: COLORS.bad, fontSize: 13, fontWeight: "900" },

    rejectModalWrap: {
        flex: 1,
        justifyContent: "flex-end",
    },
    rejectModalCard: {
        position: "absolute",
        left: 16,
        right: 16,
        backgroundColor: "#111827",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        padding: 16,
        gap: 14,
    },
    rejectModalSub: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 18,
    },

    rejectGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },

    rejectOption: {
        width: "48%",
        minHeight: 48,
        borderRadius: 12,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 10,
    },
    rejectOptionActive: {
        borderColor: "rgba(255,255,255,0.28)",
        backgroundColor: "rgba(255,255,255,0.08)",
    },
    rejectOptionPressed: {
        transform: [{ scale: 0.98 }],
        opacity: 0.96,
    },
    rejectOptionText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "800",
        textAlign: "center",
        flexShrink: 1,
    },

    otherReasonWrap: {
        gap: 10,
        marginTop: 2,
    },
    otherReasonLabel: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    otherReasonInput: {
        minHeight: 92,
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

    confirmModalCard: {
        position: "absolute",
        left: 24,
        right: 24,
        top: "32%",
        backgroundColor: "#111827",
        borderRadius: 20,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        padding: 18,
        gap: 14,
        alignItems: "center",
    },
    confirmIconWrap: {
        width: 52,
        height: 52,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(248,113,113,0.10)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.25)",
    },
    confirmIconWrapVisited: {
        width: 52,
        height: 52,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(34,197,94,0.10)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.25)",
    },
    confirmTitle: {
        color: COLORS.text,
        fontSize: 16,
        fontWeight: "900",
    },
    confirmText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "700",
        textAlign: "center",
        lineHeight: 20,
    },
    confirmTextStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },
    confirmOtherReasonText: {
        color: "#CBD5E1",
        fontSize: 12,
        fontWeight: "800",
        textAlign: "center",
        lineHeight: 18,
    },
    confirmClientText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "800",
        textAlign: "center",
        opacity: 0.92,
    },
    confirmActions: {
        flexDirection: "row",
        gap: 10,
        width: "100%",
        marginTop: 2,
    },
    confirmBtn: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    confirmBtnGhost: {
        backgroundColor: "#0F172A",
        borderColor: "rgba(255,255,255,0.12)",
    },
    confirmBtnDanger: {
        backgroundColor: "rgba(248,113,113,0.12)",
        borderColor: "rgba(248,113,113,0.30)",
    },
    confirmBtnVisited: {
        backgroundColor: "rgba(34,197,94,0.12)",
        borderColor: "rgba(34,197,94,0.30)",
    },
    confirmBtnGhostText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    confirmBtnDangerText: {
        color: COLORS.bad,
        fontSize: 13,
        fontWeight: "900",
    },
    confirmBtnVisitedText: {
        color: COLORS.ok,
        fontSize: 13,
        fontWeight: "900",
    },
});