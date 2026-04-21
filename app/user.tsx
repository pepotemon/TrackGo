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

type Toast = { id: string; text: string; createdAt: number };
type NotesMap = Record<string, string>;

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
    return `${dayName} · ${dd}/${mm}/${yyyy}`;
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

const COLORS = {
    bg: "#07111F",
    card: "rgba(10, 20, 37, 0.74)",
    border: "rgba(255,255,255,0.08)",
    borderSoft: "rgba(125, 211, 252, 0.16)",

    text: "#F8FAFC",
    muted: "#9FB0C4",
    softText: "#CBD5E1",

    primary: "#5AC8FA",
    primaryBright: "#7BE0FF",
    primarySoft: "#BFDBFE",

    navFilter: "#C4B5FD",
    navFilterBright: "#DDD6FE",
    navFilterBg: "rgba(196,181,253,0.14)",
    navFilterBorder: "rgba(196,181,253,0.26)",

    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",
    info: "#60A5FA",
    purple: "#C4B5FD",

    logoutBg: "rgba(127, 29, 29, 0.22)",
    logoutBorder: "rgba(248,113,113,0.18)",

    navBg: "rgba(7, 14, 27, 1)",
    navBorder: "rgba(255,255,255,0.08)",
    navItem: "rgba(255,255,255,0.04)",
    navItemActive: "rgba(90,200,250,0.14)",

    headerBg: "rgba(3,10,20,0.96)",
};

function TinyStat({
    icon,
    color,
    value,
    label,
}: {
    icon: any;
    color: string;
    value: number;
    label: string;
}) {
    return (
        <View style={styles.tinyStatWrap}>
            <Ionicons name={icon} size={14} color={color} />
            <Text style={styles.tinyStatValue}>{value}</Text>
            <Text style={styles.tinyStatLabel} numberOfLines={1}>
                {label}
            </Text>
        </View>
    );
}

function BottomNavIcon({
    icon,
    active,
    onPress,
    badge,
    tint,
    activeTint,
    tone = "default",
}: {
    icon: keyof typeof Ionicons.glyphMap;
    active?: boolean;
    onPress: () => void;
    badge?: number;
    tint?: string;
    activeTint?: string;
    tone?: "default" | "filter" | "map";
}) {
    const iconColor = active
        ? activeTint ?? (tone === "filter" ? COLORS.navFilterBright : COLORS.primaryBright)
        : tint ?? (tone === "filter" ? COLORS.navFilter : COLORS.primaryBright);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.bottomIconBtn,
                active && (tone === "filter" ? styles.bottomIconBtnActiveFilter : styles.bottomIconBtnActiveMap),
                pressed && styles.pressed,
            ]}
        >
            <View
                style={[
                    styles.bottomIconInner,
                    tone === "filter" && styles.bottomIconInnerFilter,
                    tone === "map" && styles.bottomIconInnerMap,
                    active && tone === "filter" && styles.bottomIconInnerFilterActive,
                    active && tone === "map" && styles.bottomIconInnerMapActive,
                ]}
            >
                <Ionicons name={icon} size={18} color={iconColor} />
                {typeof badge === "number" ? (
                    <View style={styles.bottomIconBadge}>
                        <Text style={styles.bottomIconBadgeText}>{badge}</Text>
                    </View>
                ) : null}
            </View>
        </Pressable>
    );
}

export default function UserHome() {
    const { firebaseUser, profile, loading, logout } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [filter, setFilter] = useState<Filter>("pending");
    const [q, setQ] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);

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

    const searchInputRef = useRef<TextInput | null>(null);

    const helloName = useMemo(() => {
        const n = pickFirstName(profile?.name ?? "");
        return n || "Usuario";
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

    useEffect(() => {
        if (!searchOpen) return;
        const t = setTimeout(() => {
            searchInputRef.current?.focus();
        }, 120);
        return () => clearTimeout(t);
    }, [searchOpen]);

    const clientById = useMemo(() => {
        const m = new Map<string, ClientDoc>();
        for (const c of clients) m.set(c.id, c);
        return m;
    }, [clients]);

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

    const weekLatestByClient = useMemo(() => latestEventByClient(weekEvents), [weekEvents]);

    const todayEvents = useMemo(() => {
        return weekEvents.filter((e) => e.dayKey === todayDayKey);
    }, [weekEvents, todayDayKey]);

    const todayLatestByClient = useMemo(() => latestEventByClient(todayEvents), [todayEvents]);

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

    const confirmLogout = () => {
        Alert.alert("Salir", "¿Seguro que quieres cerrar sesión?", [
            { text: "Cancelar", style: "cancel" },
            { text: "Salir", style: "destructive", onPress: logout },
        ]);
    };

    const closeSearchMode = () => {
        setSearchOpen(false);
    };

    const footerHeight = 92 + Math.max(insets.bottom, 6);
    const [headerHeight, setHeaderHeight] = useState(0);
    const listBottomPadding = footerHeight + 26;

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
            <Pressable onPress={() => searchOpen && closeSearchMode()} style={styles.card}>
                <View style={styles.cardTop}>
                    <View style={styles.cardMain}>
                        <View style={styles.cardTitleRow}>
                            <Text numberOfLines={1} style={styles.clientName}>
                                {name}
                            </Text>

                            <View
                                style={[
                                    styles.statusDot,
                                    item.status === "visited"
                                        ? styles.statusDotVisited
                                        : item.status === "rejected"
                                            ? styles.statusDotRejected
                                            : styles.statusDotPending,
                                ]}
                            />
                        </View>

                        {!!business ? (
                            <Text numberOfLines={1} style={styles.clientBusiness}>
                                {business}
                            </Text>
                        ) : null}

                        {!!phone ? (
                            <Text numberOfLines={1} style={styles.cardMeta}>
                                {phone}
                            </Text>
                        ) : null}

                        {!!address ? (
                            <Text numberOfLines={1} style={styles.cardMeta}>
                                {address}
                            </Text>
                        ) : null}

                        {localNote ? (
                            <Text numberOfLines={1} style={styles.noteInline}>
                                Nota: {localNote}
                            </Text>
                        ) : null}
                    </View>

                    <View style={styles.cardRight}>
                        <View
                            style={[
                                styles.compactPill,
                                item.status === "visited"
                                    ? styles.compactPillVisited
                                    : item.status === "rejected"
                                        ? styles.compactPillRejected
                                        : styles.compactPillPending,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.compactPillText,
                                    item.status === "visited"
                                        ? styles.compactPillTextVisited
                                        : item.status === "rejected"
                                            ? styles.compactPillTextRejected
                                            : styles.compactPillTextPending,
                                ]}
                            >
                                {statusLabel(item.status)}
                            </Text>
                        </View>

                        {showPrio ? <Text style={styles.priorityMini}>#{prio}</Text> : null}
                    </View>
                </View>

                <View style={styles.cardActionsRow}>
                    <View style={styles.cardActionsLeft}>
                        <Pressable
                            onPress={() => openNoteModal(item.id)}
                            disabled={isBusy}
                            style={({ pressed }) => [
                                styles.actionIcon,
                                pressed && styles.pressed,
                                isBusy && styles.actionDisabled,
                            ]}
                        >
                            <Ionicons
                                name={localNote ? "bookmark" : "bookmark-outline"}
                                size={16}
                                color={localNote ? COLORS.warn : COLORS.text}
                            />
                        </Pressable>

                        <Pressable
                            onPress={() => openWhatsApp(phone)}
                            disabled={!phone || isBusy}
                            style={({ pressed }) => [
                                styles.actionIcon,
                                pressed && styles.pressed,
                                (!phone || isBusy) && styles.actionDisabled,
                            ]}
                        >
                            <Ionicons name="logo-whatsapp" size={16} color={COLORS.text} />
                        </Pressable>

                        <Pressable
                            onPress={() => openMaps(mapsUrl)}
                            disabled={!mapsUrl || isBusy}
                            style={({ pressed }) => [
                                styles.actionIcon,
                                pressed && styles.pressed,
                                (!mapsUrl || isBusy) && styles.actionDisabled,
                            ]}
                        >
                            <Ionicons name="map-outline" size={16} color={COLORS.text} />
                        </Pressable>

                        <Pressable
                            onPress={() => copyClient(item)}
                            disabled={isBusy}
                            style={({ pressed }) => [
                                styles.actionIcon,
                                pressed && styles.pressed,
                                isBusy && styles.actionDisabled,
                            ]}
                        >
                            <Ionicons name="copy-outline" size={16} color={COLORS.text} />
                        </Pressable>
                    </View>

                    <View style={styles.cardActionsRight}>
                        {isPending ? (
                            <>
                                <Pressable
                                    onPress={() => confirmSetStatus(item, "rejected")}
                                    disabled={isBusy}
                                    style={({ pressed }) => [
                                        styles.stateAction,
                                        styles.stateActionRejected,
                                        pressed && styles.pressed,
                                        isBusy && styles.actionDisabled,
                                    ]}
                                >
                                    <Ionicons name="close" size={16} color={COLORS.bad} />
                                </Pressable>

                                <Pressable
                                    onPress={() => confirmSetStatus(item, "visited")}
                                    disabled={isBusy}
                                    style={({ pressed }) => [
                                        styles.stateAction,
                                        styles.stateActionVisited,
                                        pressed && styles.pressed,
                                        isBusy && styles.actionDisabled,
                                    ]}
                                >
                                    <Ionicons name="checkmark" size={16} color={COLORS.ok} />
                                </Pressable>
                            </>
                        ) : (
                            <Pressable
                                onPress={() => confirmSetStatus(item, "pending")}
                                disabled={isBusy || !canUndo}
                                style={({ pressed }) => [
                                    styles.stateAction,
                                    styles.stateActionUndo,
                                    pressed && styles.pressed,
                                    (isBusy || !canUndo) && styles.actionDisabled,
                                ]}
                            >
                                <Ionicons name="refresh-outline" size={16} color={COLORS.text} />
                            </Pressable>
                        )}
                    </View>
                </View>

                {isBusy ? <Text style={styles.busyText}>Actualizando…</Text> : null}
            </Pressable>
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

                    <View
                        pointerEvents="box-none"
                        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
                        style={[
                            styles.fixedHeader,
                            {
                                paddingTop: Math.max(insets.top + 2, 10),
                            },
                        ]}
                    >
                        <View style={styles.header}>
                            <View style={styles.headerLeft}>
                                <Text style={styles.hTitle}>Inicio</Text>
                                <Text style={styles.hSub} numberOfLines={1}>
                                    Hola, <Text style={styles.hSubStrong}>{helloName}</Text>
                                </Text>
                                <Text style={styles.hSubMuted} numberOfLines={1}>
                                    {todayLabel}
                                </Text>
                                {eventsErr ? <Text style={styles.hErr}>{eventsErr}</Text> : null}
                            </View>

                            <Pressable
                                onPress={confirmLogout}
                                style={({ pressed }) => [
                                    styles.logoutBtn,
                                    pressed && styles.pressed,
                                ]}
                                accessibilityLabel="Salir"
                            >
                                <Ionicons name="log-out-outline" size={20} color={COLORS.bad} />
                            </Pressable>
                        </View>

                        <View style={styles.quickRow}>
                            <View style={styles.quickCard}>
                                <View style={styles.quickTop}>
                                    <View style={styles.sectionIconWrap}>
                                        <Ionicons
                                            name="cash-outline"
                                            size={18}
                                            color={COLORS.primaryBright}
                                        />
                                    </View>

                                    <View style={[styles.badge, styles.badgeOk]}>
                                        <Text style={[styles.badgeText, styles.badgeTextOk]}>HOY</Text>
                                    </View>
                                </View>

                                <View style={styles.tinyRow}>
                                    <TinyStat
                                        icon="checkmark-circle-outline"
                                        color={COLORS.ok}
                                        value={todayVisitedCount}
                                        label="Visitados"
                                    />
                                    <TinyStat
                                        icon="close-circle-outline"
                                        color={COLORS.bad}
                                        value={todayRejectedCount}
                                        label="Rechazados"
                                    />
                                </View>
                            </View>

                            <View style={styles.quickCard}>
                                <View style={styles.quickTop}>
                                    <View style={styles.sectionIconWrap}>
                                        <Ionicons
                                            name="calendar-outline"
                                            size={18}
                                            color={COLORS.primaryBright}
                                        />
                                    </View>

                                    <View style={[styles.badge, styles.badgePrimary]}>
                                        <Text style={[styles.badgeText, styles.badgeTextPrimary]}>
                                            SEMANA
                                        </Text>
                                    </View>
                                </View>

                                <View style={styles.tinyRow}>
                                    <TinyStat
                                        icon="checkmark-circle-outline"
                                        color={COLORS.ok}
                                        value={weekCounts.visited}
                                        label="Visitados"
                                    />
                                    <TinyStat
                                        icon="close-circle-outline"
                                        color={COLORS.bad}
                                        value={weekCounts.rejected}
                                        label="Rechazados"
                                    />
                                </View>
                            </View>
                        </View>
                    </View>

                    <View
                        pointerEvents="none"
                        style={[styles.headerScrim, { top: headerHeight - 32 }]}
                    />

                    <FlatList
                        data={filteredClients}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[
                            styles.listContent,
                            {
                                paddingTop: headerHeight + 8,
                                paddingBottom: listBottomPadding,
                            },
                        ]}
                        ListEmptyComponent={
                            <View style={styles.empty}>
                                <Ionicons name="people-outline" size={24} color={COLORS.muted} />
                                <Text style={styles.emptyText}>No hay clientes con ese filtro.</Text>
                            </View>
                        }
                    />
                </View>

                <View pointerEvents="none" style={[styles.footerScrim, { bottom: footerHeight - 100 }]} />

                <View style={[styles.bottomFooter, { paddingBottom: Math.max(insets.bottom, 6) - 30 }]}>
                    <View style={styles.bottomFooterTopGlow} />

                    <View style={styles.bottomNavContent}>
                        <View style={styles.bottomNavLeft}>
                            <BottomNavIcon
                                icon="time-outline"
                                active={filter === "pending"}
                                onPress={() => setFilter("pending")}
                                badge={counts.pending}
                                tint={COLORS.warn}
                                activeTint={COLORS.warn}
                                tone="filter"
                            />
                            <BottomNavIcon
                                icon="checkmark"
                                active={filter === "visited"}
                                onPress={() => setFilter("visited")}
                                tint={COLORS.ok}
                                activeTint={COLORS.ok}
                                tone="filter"
                            />
                            <BottomNavIcon
                                icon="close"
                                active={filter === "rejected"}
                                onPress={() => setFilter("rejected")}
                                tint={COLORS.bad}
                                activeTint={COLORS.bad}
                                tone="filter"
                            />
                            <BottomNavIcon
                                icon="apps-outline"
                                active={filter === "all"}
                                onPress={() => setFilter("all")}
                                tint={COLORS.navFilter}
                                activeTint={COLORS.navFilterBright}
                                tone="filter"
                            />
                            <BottomNavIcon
                                icon="search-outline"
                                onPress={() => setSearchOpen(true)}
                                tint={COLORS.navFilter}
                                tone="filter"
                            />
                        </View>

                        <View style={styles.bottomNavDividerWrap}>
                            <Text style={styles.bottomNavDividerText}>|</Text>
                        </View>

                        <View style={styles.bottomNavRight}>
                            <BottomNavIcon
                                icon="map-outline"
                                onPress={() => router.push("/user-map" as any)}
                                tint={COLORS.primaryBright}
                                tone="map"
                            />
                            <BottomNavIcon
                                icon="time-outline"
                                onPress={goHistory}
                                tint={COLORS.primaryBright}
                                tone="map"
                            />
                        </View>
                    </View>
                </View>
            </ImageBackground>

            <Modal visible={searchOpen} transparent animationType="fade" onRequestClose={closeSearchMode}>
                <Pressable style={styles.searchBackdrop} onPress={closeSearchMode} />
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.searchModalWrap}
                >
                    <View style={styles.searchModalCard}>
                        <View style={styles.searchModalHeader}>
                            <View style={styles.searchModalIconWrap}>
                                <Ionicons name="search-outline" size={18} color={COLORS.navFilterBright} />
                            </View>
                            <Text style={styles.searchModalTitle}>Buscar cliente</Text>

                            <Pressable onPress={closeSearchMode} style={styles.searchModalClose}>
                                <Ionicons name="close" size={18} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <View style={styles.searchInputWrap}>
                            <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                            <TextInput
                                ref={searchInputRef}
                                value={q}
                                onChangeText={setQ}
                                placeholder="Nombre, negocio, teléfono, dirección…"
                                placeholderTextColor={COLORS.muted}
                                style={styles.searchInput}
                                autoCapitalize="none"
                                autoCorrect={false}
                                returnKeyType="search"
                            />
                            {!!q ? (
                                <Pressable onPress={clearSearch} style={styles.searchClearBtn}>
                                    <Ionicons name="close" size={16} color={COLORS.text} />
                                </Pressable>
                            ) : null}
                        </View>

                        <View style={styles.searchModalActions}>
                            <Pressable
                                onPress={clearSearch}
                                style={({ pressed }) => [
                                    styles.searchActionGhost,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={styles.searchActionGhostText}>Limpiar</Text>
                            </Pressable>

                            <Pressable
                                onPress={closeSearchMode}
                                style={({ pressed }) => [
                                    styles.searchActionPrimary,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={styles.searchActionPrimaryText}>Listo</Text>
                            </Pressable>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={noteModalOpen} transparent animationType="fade" onRequestClose={closeNoteModal}>
                <Pressable style={styles.modalBackdrop} onPress={closeNoteModal} />
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.noteModalWrap}
                    keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
                >
                    <View style={[styles.modalCard, styles.noteModalCard, { marginBottom: Math.max(16, insets.bottom + 8) }]}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Nota del cliente</Text>
                            <Pressable
                                onPress={closeNoteModal}
                                style={({ pressed }) => [styles.modalClose, pressed && styles.pressed]}
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
                                    pressed && styles.pressed,
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
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Ionicons name="save-outline" size={18} color={COLORS.text} />
                                <Text style={styles.modalBtnText}>Guardar</Text>
                            </Pressable>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={rejectModalOpen} transparent animationType="fade" onRequestClose={resetRejectFlow}>
                <Pressable style={styles.modalBackdrop} onPress={resetRejectFlow} />

                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.rejectModalWrap}
                >
                    <View style={[styles.rejectModalCard, { bottom: Math.max(12, insets.bottom + 8) }]}>
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
                                            pressed && styles.pressed,
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
                                        style={({ pressed }) => [styles.modalBtn, pressed && styles.pressed]}
                                    >
                                        <Text style={styles.modalBtnText}>Cancelar</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={continueRejectWithOther}
                                        style={({ pressed }) => [
                                            styles.modalBtn,
                                            styles.modalBtnPrimary,
                                            pressed && styles.pressed,
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

            <Modal visible={confirmRejectOpen} transparent animationType="fade" onRequestClose={resetRejectFlow}>
                <Pressable style={styles.modalBackdrop} onPress={resetRejectFlow} />

                <View style={styles.confirmModalCard}>
                    <View style={styles.confirmIconWrap}>
                        <Ionicons name={reasonIcon(selectedRejectReason) as any} size={22} color={COLORS.bad} />
                    </View>

                    <Text style={styles.confirmTitle}>Confirmar rechazo</Text>

                    <Text style={styles.confirmText}>
                        ¿Seguro que quieres rechazar este cliente por{" "}
                        <Text style={styles.confirmTextStrong}>{reasonLabel(selectedRejectReason)}</Text>?
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
                                pressed && styles.pressed,
                            ]}
                        >
                            <Text style={styles.confirmBtnGhostText}>Cancelar</Text>
                        </Pressable>

                        <Pressable
                            onPress={submitRejectReason}
                            style={({ pressed }) => [
                                styles.confirmBtn,
                                styles.confirmBtnDanger,
                                pressed && styles.pressed,
                            ]}
                        >
                            <Text style={styles.confirmBtnDangerText}>Confirmar</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            <Modal visible={confirmVisitOpen} transparent animationType="fade" onRequestClose={resetVisitFlow}>
                <Pressable style={styles.modalBackdrop} onPress={resetVisitFlow} />

                <View style={styles.confirmModalCard}>
                    <View style={styles.confirmIconWrapVisited}>
                        <Ionicons name="checkmark-outline" size={22} color={COLORS.ok} />
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
                                pressed && styles.pressed,
                            ]}
                        >
                            <Text style={styles.confirmBtnGhostText}>Cancelar</Text>
                        </Pressable>

                        <Pressable
                            onPress={submitVisited}
                            style={({ pressed }) => [
                                styles.confirmBtn,
                                styles.confirmBtnVisited,
                                pressed && styles.pressed,
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

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },

    bg: {
        flex: 1,
    },

    bgImage: {
        opacity: 0.46,
    },

    overlay: {
        flex: 1,
        backgroundColor: "rgba(3,10,20,0.54)",
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
        backgroundColor: "rgba(9, 18, 34, 0.96)",
        borderWidth: 1,
        borderColor: COLORS.navBorder,
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

    fixedHeader: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        paddingHorizontal: 16,
        paddingBottom: 10,
        backgroundColor: COLORS.headerBg,
    },

    headerScrim: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 44,
        backgroundColor: "rgba(7,14,27,0.18)",
        zIndex: 19,
    },

    listContent: {
        paddingBottom: 140,
    },

    header: {
        paddingTop: 2,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerLeft: {
        flex: 1,
        gap: 3,
    },
    hTitle: {
        color: COLORS.text,
        fontSize: 24,
        fontWeight: "900",
        letterSpacing: 0.4,
    },
    hSub: {
        color: "#D7E2EE",
        fontSize: 13,
        fontWeight: "700",
    },
    hSubStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },
    hSubMuted: {
        color: "#D7E2EE",
        fontSize: 12,
        fontWeight: "700",
        opacity: 0.88,
    },
    hErr: {
        color: COLORS.bad,
        fontSize: 12,
        fontWeight: "800",
        marginTop: 2,
    },

    logoutBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: COLORS.logoutBg,
        borderWidth: 1,
        borderColor: COLORS.logoutBorder,
        alignItems: "center",
        justifyContent: "center",
    },

    quickRow: {
        flexDirection: "row",
        gap: 12,
        marginTop: 4,
        marginBottom: 8,
    },
    quickCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
        gap: 7,
        overflow: "hidden",
    },
    quickTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    sectionIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 12,
        backgroundColor: "rgba(90,200,250,0.09)",
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.20)",
        alignItems: "center",
        justifyContent: "center",
    },
    badge: {
        paddingHorizontal: 10,
        height: 27,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0.4,
    },
    badgeOk: {
        backgroundColor: "rgba(34,197,94,0.12)",
        borderColor: "rgba(34,197,94,0.34)",
    },
    badgeTextOk: {
        color: "#86EFAC",
    },
    badgePrimary: {
        backgroundColor: "rgba(124,58,237,0.16)",
        borderColor: "rgba(124,58,237,0.35)",
    },
    badgeTextPrimary: {
        color: "#D8B4FE",
    },
    tinyRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 2,
    },
    tinyStatWrap: {
        flex: 1,
        minHeight: 40,
        borderRadius: 13,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        paddingHorizontal: 6,
        paddingVertical: 6,
    },
    tinyStatValue: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    tinyStatLabel: {
        color: COLORS.softText,
        fontSize: 10,
        fontWeight: "800",
    },

    card: {
        backgroundColor: COLORS.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 10,
        gap: 10,
        marginBottom: 8,
    },
    cardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    cardMain: {
        flex: 1,
        gap: 3,
    },
    cardRight: {
        alignItems: "flex-end",
        gap: 6,
    },
    cardTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    clientName: {
        flex: 1,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },
    clientBusiness: {
        color: COLORS.softText,
        fontSize: 12,
        fontWeight: "800",
    },
    cardMeta: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
    },
    noteInline: {
        color: "#FDE68A",
        fontSize: 11,
        fontWeight: "800",
        marginTop: 2,
    },

    compactPill: {
        minHeight: 24,
        borderRadius: 999,
        paddingHorizontal: 8,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    compactPillText: {
        fontSize: 10,
        fontWeight: "900",
    },
    compactPillPending: {
        backgroundColor: "rgba(251,191,36,0.12)",
        borderColor: "rgba(251,191,36,0.35)",
    },
    compactPillTextPending: {
        color: "#FDE68A",
    },
    compactPillVisited: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.35)",
    },
    compactPillTextVisited: {
        color: "#86EFAC",
    },
    compactPillRejected: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.35)",
    },
    compactPillTextRejected: {
        color: "#FCA5A5",
    },

    priorityMini: {
        color: "#FDE68A",
        fontSize: 10,
        fontWeight: "900",
    },

    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 999,
    },
    statusDotPending: { backgroundColor: COLORS.warn },
    statusDotVisited: { backgroundColor: COLORS.ok },
    statusDotRejected: { backgroundColor: COLORS.bad },

    cardActionsRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    cardActionsLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    cardActionsRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },

    actionIcon: {
        width: 34,
        height: 34,
        borderRadius: 11,
        backgroundColor: COLORS.navItem,
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    actionDisabled: {
        opacity: 0.42,
    },

    stateAction: {
        width: 36,
        height: 36,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    stateActionVisited: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.24)",
    },
    stateActionRejected: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.24)",
    },
    stateActionUndo: {
        backgroundColor: "rgba(255,255,255,0.05)",
        borderColor: "rgba(255,255,255,0.10)",
    },

    busyText: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
        marginTop: -2,
    },

    empty: {
        marginTop: 40,
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
    },
    emptyText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "800",
        textAlign: "center",
    },

    footerScrim: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 84,
        backgroundColor: "rgba(7, 14, 27, 0.18)",
    },

    bottomFooter: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: COLORS.navBg,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.08)",
        paddingTop: 20,
        paddingHorizontal: 12,
        minHeight: 80,
    },
    bottomFooterTopGlow: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: 1,
        backgroundColor: "rgba(255,255,255,0.02)",
    },
    bottomNavContent: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    bottomNavLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flex: 1,
    },
    bottomNavRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    bottomNavDividerWrap: {
        width: 22,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 2,
    },
    bottomNavDividerText: {
        color: "rgba(255,255,255,0.42)",
        fontSize: 28,
        fontWeight: "700",
        lineHeight: 28,
        marginTop: -2,
    },
    bottomIconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    bottomIconBtnActiveMap: {
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    bottomIconBtnActiveFilter: {
        backgroundColor: "rgba(255,255,255,0.02)",
    },
    bottomIconInner: {
        width: 34,
        height: 34,
        borderRadius: 12,
        backgroundColor: COLORS.navItem,
        borderWidth: 1,
        borderColor: COLORS.borderSoft,
        alignItems: "center",
        justifyContent: "center",
    },
    bottomIconInnerFilter: {
        borderColor: COLORS.navFilterBorder,
        backgroundColor: "rgba(196,181,253,0.06)",
    },
    bottomIconInnerMap: {
        borderColor: "rgba(123,224,255,0.18)",
        backgroundColor: "rgba(90,200,250,0.06)",
    },
    bottomIconInnerFilterActive: {
        backgroundColor: COLORS.navFilterBg,
        borderColor: "rgba(221,214,254,0.34)",
    },
    bottomIconInnerMapActive: {
        backgroundColor: "rgba(90,200,250,0.14)",
        borderColor: "rgba(123,224,255,0.30)",
    },
    bottomIconBadge: {
        position: "absolute",
        top: -4,
        right: -6,
        minWidth: 16,
        height: 16,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.92)",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 3,
    },
    bottomIconBadgeText: {
        color: COLORS.bg,
        fontSize: 9,
        fontWeight: "900",
    },

    searchBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.58)",
    },
    searchModalWrap: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
    },
    searchModalCard: {
        width: "100%",
        maxWidth: 460,
        borderRadius: 22,
        backgroundColor: "#0B1628",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        padding: 16,
        gap: 14,
    },
    searchModalHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    searchModalIconWrap: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: "rgba(196,181,253,0.12)",
        borderWidth: 1,
        borderColor: "rgba(196,181,253,0.22)",
        alignItems: "center",
        justifyContent: "center",
    },
    searchModalTitle: {
        flex: 1,
        color: COLORS.text,
        fontSize: 16,
        fontWeight: "900",
    },
    searchModalClose: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    searchInputWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 52,
        borderRadius: 16,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        paddingHorizontal: 12,
    },
    searchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
        paddingVertical: 10,
    },
    searchClearBtn: {
        width: 30,
        height: 30,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },
    searchModalActions: {
        flexDirection: "row",
        gap: 10,
    },
    searchActionGhost: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
    },
    searchActionGhostText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    searchActionPrimary: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(196,181,253,0.14)",
        borderWidth: 1,
        borderColor: "rgba(196,181,253,0.30)",
    },
    searchActionPrimaryText: {
        color: COLORS.navFilterBright,
        fontSize: 13,
        fontWeight: "900",
    },

    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.55)",
    },
    noteModalWrap: {
        flex: 1,
        justifyContent: "flex-end",
        paddingHorizontal: 16,
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
    noteModalCard: {
        position: "relative",
        left: undefined,
        right: undefined,
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