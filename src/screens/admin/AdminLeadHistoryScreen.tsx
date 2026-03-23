import { Ionicons } from "@expo/vector-icons";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import React, {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Alert,
    Linking,
    Modal,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AdminAssignModal from "../../components/admin/AdminAssignModal";
import AdminBackground from "../../components/admin/AdminBackground";
import {
    assignClient,
    deleteClient,
    getClientLeadHistoryBucket,
    getClientRelevantLeadActivityAt,
    subscribeAdminLeadHistory,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, UserDoc } from "../../types/models";

type HistoryFilterKey = "all" | "incomplete" | "not_suitable";

type VerificationStatus =
    | "verified"
    | "pending_review"
    | "incomplete"
    | "not_suitable";

type ActionSheetState = {
    open: boolean;
    clientId: string | null;
};

type LeadHistoryRowVM = {
    id: string;
    raw: ClientDoc;
    phone: string;
    waPhone: string;
    name: string;
    subtitle: string;
    address: string;
    mapsUrl: string;
    verificationStatus: VerificationStatus;
    quickStatusText: string;
    notSuitableReason: string;
    createdAtMs: number;
    updatedAtMs: number;
    lastInboundAtMs: number;
    relevantAtMs: number;
    historyBucket: "incomplete" | "not_suitable";
    lastInboundText: string;
    searchBlob: string;
};

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    cardAlt: "#0F172A",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    soft: "#CBD5E1",

    primary: "#2563EB",
    primarySoft: "#93C5FD",

    yellow: "#FDE68A",
    red: "#FCA5A5",
    green: "#86EFAC",
    purple: "#C4B5FD",

    rejected: "#F87171",
};

function normalizePhone(raw: string) {
    return (raw ?? "").replace(/\D+/g, "");
}

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

function safeNumber(v: any): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function roundCoord(v: any): number | null {
    const n = safeNumber(v);
    if (n == null) return null;
    return Math.round(n * 1000000) / 1000000;
}

function extractLatLngFromMapsUrl(url: string): { lat: number | null; lng: number | null } {
    const raw = (url ?? "").trim();
    if (!raw) return { lat: null, lng: null };

    try {
        const decoded = decodeURIComponent(raw);

        const patterns = [
            /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
        ];

        for (const p of patterns) {
            const m = decoded.match(p);
            if (m?.[1] && m?.[2]) {
                const lat = roundCoord(m[1]);
                const lng = roundCoord(m[2]);
                if (lat != null && lng != null) return { lat, lng };
            }
        }

        return { lat: null, lng: null };
    } catch {
        return { lat: null, lng: null };
    }
}

function looksLikeMapsUrl(url: string) {
    const u = (url ?? "").trim().toLowerCase();
    return (
        u.includes("maps") ||
        u.includes("goo.gl") ||
        u.includes("google.com") ||
        u.includes("share.google")
    );
}

function cleanUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
    const out: any = {};
    for (const k of Object.keys(obj)) {
        const v = (obj as any)[k];
        if (v !== undefined) out[k] = v;
    }
    return out;
}

function waLink(phoneDigits: string, text: string) {
    const p = normalizePhone(phoneDigits);
    return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toMillis === "function") return v.toMillis();
    if (typeof v === "string") {
        const parsed = Number(v);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function formatDateLabel(ms?: number) {
    if (!ms || !Number.isFinite(ms)) return "—";

    const d = new Date(ms);
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const month = months[d.getMonth()];
    const year = d.getFullYear();

    return `${day} ${month} ${year}`;
}

function getClientParseStatus(c: ClientDoc): "ready" | "partial" | "empty" {
    const raw = String((c as any)?.parseStatus ?? "").trim().toLowerCase();
    if (raw === "ready") return "ready";
    if (raw === "partial") return "partial";
    return "empty";
}

function hasUsefulBusiness(c: ClientDoc) {
    return !!String((c as any)?.business ?? (c as any)?.businessRaw ?? "").trim();
}

function hasUsefulMaps(c: ClientDoc) {
    const mapsUrl = !!String(c.mapsUrl ?? "").trim();
    const lat = safeNumber((c as any)?.lat);
    const lng = safeNumber((c as any)?.lng);
    const currentLeadMapsConfirmedAt = safeNumber((c as any)?.currentLeadMapsConfirmedAt);

    const hasStoredMaps = mapsUrl || (lat != null && lng != null);
    const hasConfirmedCurrentLeadMaps = currentLeadMapsConfirmedAt != null && currentLeadMapsConfirmedAt > 0;

    return hasStoredMaps && hasConfirmedCurrentLeadMaps;
}

function getMissingFields(c: ClientDoc) {
    const hasBusiness = hasUsefulBusiness(c);
    const hasMaps = hasUsefulMaps(c);

    if (!hasBusiness && !hasMaps) return ["negocio", "maps"];
    if (!hasBusiness) return ["negocio"];
    if (!hasMaps) return ["maps"];
    return [];
}

function getDerivedVerificationStatus(c: ClientDoc): VerificationStatus {
    const raw = String((c as any)?.verificationStatus ?? "").trim().toLowerCase();
    if (raw === "verified") return "verified";
    if (raw === "pending_review") return "pending_review";
    if (raw === "incomplete") return "incomplete";
    if (raw === "not_suitable") return "not_suitable";

    const leadQuality = String((c as any)?.leadQuality ?? "").trim().toLowerCase();
    if (leadQuality === "not_suitable") return "not_suitable";
    if (getClientParseStatus(c) === "ready") return "pending_review";
    return "incomplete";
}

function getNotSuitableReason(c: ClientDoc) {
    return String((c as any)?.notSuitableReason ?? "").trim();
}

function getPrimarySubtitle(c: ClientDoc) {
    const business = String((c as any)?.business ?? "").trim();
    const businessRaw = String((c as any)?.businessRaw ?? "").trim();

    if (business) return business;
    if (businessRaw) return businessRaw;
    return "";
}

function getQuickStatusText(c: ClientDoc) {
    const status = getDerivedVerificationStatus(c);

    if (status === "not_suitable") {
        return getNotSuitableReason(c) || "Perfil no apto";
    }

    if (status === "incomplete") {
        const missing = getMissingFields(c);
        if (missing.length === 2) return "Falta negocio y maps";
        if (missing.length === 1) return `Falta ${missing[0]}`;
        return "Faltan datos por revisar";
    }

    if (status === "verified") return "Lead validado";
    return "Listo para revisión";
}

function useDebouncedValue<T>(value: T, delay = 250) {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);

    return debounced;
}

function buildLeadHistoryVM(c: ClientDoc, now: number): LeadHistoryRowVM | null {
    const historyBucket = getClientLeadHistoryBucket(c, now);
    if (!historyBucket) return null;

    const verificationStatus = getDerivedVerificationStatus(c);
    const createdAtMs = toMs((c as any)?.createdAt);
    const updatedAtMs = toMs((c as any)?.updatedAt);
    const lastInboundAtMs = toMs((c as any)?.lastInboundMessageAt);

    const phone = String(c.phone ?? "").trim();
    const waPhone = String((c as any)?.waId ?? c.phone ?? "").trim();
    const name = String((c as any)?.name ?? "").trim();
    const subtitle = getPrimarySubtitle(c);
    const address = String(c.address ?? "").trim();
    const mapsUrl = String(c.mapsUrl ?? "").trim();
    const quickStatusText = getQuickStatusText(c);
    const notSuitableReason = getNotSuitableReason(c);
    const lastInboundText = String((c as any)?.lastInboundText ?? "").trim();
    const relevantAtMs = getClientRelevantLeadActivityAt(c);

    const searchBlob = `
        ${safeText(name)}
        ${safeText(subtitle)}
        ${safeText(address)}
        ${safeText(mapsUrl)}
        ${safeText(phone)}
        ${safeText(notSuitableReason)}
        ${safeText(quickStatusText)}
        ${safeText(lastInboundText)}
        ${safeText(historyBucket)}
    `;

    return {
        id: c.id,
        raw: c,
        phone,
        waPhone,
        name,
        subtitle,
        address,
        mapsUrl,
        verificationStatus,
        quickStatusText,
        notSuitableReason,
        createdAtMs,
        updatedAtMs,
        lastInboundAtMs,
        relevantAtMs,
        historyBucket,
        lastInboundText,
        searchBlob,
    };
}

const FilterPill = memo(function FilterPill({
    label,
    value,
    icon,
    active,
    onPress,
    tint,
}: {
    label: string;
    value: number;
    icon: any;
    active: boolean;
    onPress: () => void;
    tint: string;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.filterPill,
                active && styles.filterPillActive,
                pressed && styles.pressed,
            ]}
        >
            <Ionicons name={icon} size={13} color={tint} />
            <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                {label}
            </Text>
            <Text style={[styles.filterPillCount, active && styles.filterPillCountActive]}>
                {value}
            </Text>
        </Pressable>
    );
});

const HistoryLeadCard = memo(function HistoryLeadCard({
    item,
    isBusy,
    onOpenActions,
    onOpenMaps,
    onOpenWsp,
    onOpenChat,
}: {
    item: LeadHistoryRowVM;
    isBusy: boolean;
    onOpenActions: (id: string) => void;
    onOpenMaps: (url?: string) => void;
    onOpenWsp: (phone?: string) => void;
    onOpenChat: (id: string) => void;
}) {
    const isIncomplete = item.historyBucket === "incomplete";

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <View style={styles.cardTopMain}>
                    <Text style={styles.phone} numberOfLines={1}>
                        {item.phone || "Sin teléfono"}
                    </Text>

                    {!!item.name ? (
                        <Text style={styles.metaPrimary} numberOfLines={1}>
                            {item.name}
                        </Text>
                    ) : null}

                    {!!item.subtitle ? (
                        <Text style={styles.meta} numberOfLines={1}>
                            {item.subtitle}
                        </Text>
                    ) : null}
                </View>

                <Pressable
                    onPress={() => onOpenActions(item.id)}
                    style={({ pressed }) => [
                        styles.menuBtn,
                        pressed && styles.pressed,
                    ]}
                    disabled={isBusy}
                >
                    <Ionicons name="ellipsis-horizontal" size={16} color={COLORS.text} />
                </Pressable>
            </View>

            <View
                style={[
                    styles.statusBox,
                    isIncomplete ? styles.statusBoxYellow : styles.statusBoxRed,
                ]}
            >
                <Ionicons
                    name={isIncomplete ? "archive-outline" : "ban-outline"}
                    size={14}
                    color={isIncomplete ? "#FDE68A" : "#FCA5A5"}
                />
                <Text
                    style={[
                        styles.statusBoxText,
                        isIncomplete ? styles.statusBoxTextYellow : styles.statusBoxTextRed,
                    ]}
                    numberOfLines={2}
                >
                    {item.quickStatusText}
                </Text>
            </View>

            <View style={styles.historyBadgeRow}>
                <View
                    style={[
                        styles.historyBadge,
                        isIncomplete ? styles.historyBadgeYellow : styles.historyBadgeRed,
                    ]}
                >
                    <Text
                        style={[
                            styles.historyBadgeText,
                            isIncomplete ? styles.historyBadgeTextYellow : styles.historyBadgeTextRed,
                        ]}
                    >
                        {isIncomplete ? "Historial · Incompleto" : "Historial · No apto"}
                    </Text>
                </View>
            </View>

            {!!item.address ? (
                <View style={styles.infoRow}>
                    <Ionicons name="location-outline" size={14} color={COLORS.muted} />
                    <Text style={styles.infoText} numberOfLines={2}>
                        {item.address}
                    </Text>
                </View>
            ) : null}

            <View style={styles.assignedRow}>
                <Ionicons name="time-outline" size={14} color={COLORS.muted} />
                <Text style={styles.assignedText} numberOfLines={1}>
                    Creado: {formatDateLabel(item.createdAtMs)} · Relevante: {formatDateLabel(item.relevantAtMs)}
                </Text>
            </View>

            {item.lastInboundText ? (
                <Pressable
                    onPress={() => onOpenChat(item.id)}
                    style={({ pressed }) => [
                        styles.inboundBox,
                        pressed && styles.pressed,
                    ]}
                >
                    <View style={styles.inboundHeader}>
                        <Ionicons name="chatbubble-ellipses-outline" size={13} color={COLORS.muted} />
                        <Text style={styles.inboundTitle}>Último mensaje</Text>

                        <View style={styles.inboundOpenPill}>
                            <Text style={styles.inboundOpenPillText}>Ir al chat</Text>
                        </View>
                    </View>

                    <Text style={styles.inboundText} numberOfLines={2}>
                        {item.lastInboundText}
                    </Text>
                </Pressable>
            ) : (
                <Pressable
                    onPress={() => onOpenChat(item.id)}
                    style={({ pressed }) => [
                        styles.openChatEmptyBtn,
                        pressed && styles.pressed,
                    ]}
                >
                    <Ionicons name="chatbubble-outline" size={15} color="#93C5FD" />
                    <Text style={styles.openChatEmptyBtnText}>Abrir chat</Text>
                </Pressable>
            )}

            <View style={styles.bottomMiniRow}>
                <Pressable
                    onPress={() => onOpenMaps(item.mapsUrl)}
                    style={({ pressed }) => [styles.miniIconBtn, pressed && styles.iconBtnPressed]}
                >
                    <Ionicons name="map-outline" size={16} color={COLORS.text} />
                </Pressable>

                <Pressable
                    onPress={() => onOpenWsp(item.waPhone || item.phone)}
                    style={({ pressed }) => [styles.miniIconBtn, pressed && styles.iconBtnPressed]}
                >
                    <Ionicons name="logo-whatsapp" size={16} color={COLORS.text} />
                </Pressable>

                {item.historyBucket === "not_suitable" && !!item.notSuitableReason ? (
                    <Text style={styles.bottomReasonText} numberOfLines={1}>
                        {item.notSuitableReason}
                    </Text>
                ) : (
                    <View style={{ flex: 1 }} />
                )}
            </View>

            {isBusy ? <Text style={styles.busyText}>Procesando…</Text> : null}
        </View>
    );
});

export default function AdminLeadHistoryScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [q, setQ] = useState("");
    const debouncedQ = useDebouncedValue(q, 280);

    const [filter, setFilter] = useState<HistoryFilterKey>("all");
    const [busyId, setBusyId] = useState<string | null>(null);

    const [actionSheet, setActionSheet] = useState<ActionSheetState>({
        open: false,
        clientId: null,
    });

    const [editOpen, setEditOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [eName, setEName] = useState("");
    const [eBusiness, setEBusiness] = useState("");
    const [eBusinessRaw, setEBusinessRaw] = useState("");
    const [ePhone, setEPhone] = useState("");
    const [eMapsUrl, setEMapsUrl] = useState("");
    const [eAddress, setEAddress] = useState("");
    const [eVerificationStatus, setEVerificationStatus] = useState<VerificationStatus>("incomplete");
    const [eNotSuitableReason, setENotSuitableReason] = useState("");
    const [eSaving, setESaving] = useState(false);

    const [assignOpen, setAssignOpen] = useState(false);

    const listRef = useRef<any>(null);

    useEffect(() => {
        const unsub = subscribeAdminLeadHistory((list) => setClients(list ?? []), {
            limitCount: 1200,
            verificationStatuses: ["incomplete", "not_suitable"],
        });
        return () => unsub();
    }, []);

    const reloadUsers = useCallback(async () => {
        if (usersLoading) return;
        setUsersLoading(true);
        try {
            const u = await listUsers("user");
            setUsers(u);
        } finally {
            setUsersLoading(false);
        }
    }, [usersLoading]);

    useEffect(() => {
        void reloadUsers();
    }, [reloadUsers]);

    const closeActionSheet = useCallback(() => {
        setActionSheet({ open: false, clientId: null });
    }, []);

    useEffect(() => {
        closeActionSheet();
    }, [filter, debouncedQ, closeActionSheet]);

    const now = Date.now();

    const leadVMs = useMemo(() => {
        return clients
            .map((c) => buildLeadHistoryVM(c, now))
            .filter((x): x is LeadHistoryRowVM => !!x);
    }, [clients, now]);

    const vmById = useMemo(() => {
        const map: Record<string, LeadHistoryRowVM> = {};
        for (const item of leadVMs) {
            map[item.id] = item;
        }
        return map;
    }, [leadVMs]);

    const totals = useMemo(() => {
        let incomplete = 0;
        let notSuitable = 0;

        for (const item of leadVMs) {
            if (item.historyBucket === "incomplete") incomplete++;
            else if (item.historyBucket === "not_suitable") notSuitable++;
        }

        return {
            total: incomplete + notSuitable,
            incomplete,
            notSuitable,
        };
    }, [leadVMs]);

    const filteredIds = useMemo(() => {
        const qtText = debouncedQ.trim().toLowerCase();
        const qtDigits = normalizePhone(debouncedQ);

        const list = leadVMs.filter((item) => {
            if (filter !== "all" && item.historyBucket !== filter) return false;

            if (!qtText && !qtDigits) return true;

            if (qtDigits && normalizePhone(item.phone).includes(qtDigits)) return true;
            if (qtText && item.searchBlob.includes(qtText)) return true;

            return false;
        });

        list.sort((a, b) => {
            return (b.relevantAtMs || b.updatedAtMs || b.createdAtMs) - (a.relevantAtMs || a.updatedAtMs || a.createdAtMs);
        });

        return list.map((x) => x.id);
    }, [leadVMs, debouncedQ, filter]);

    useEffect(() => {
        if (!actionSheet.clientId) return;
        if (!vmById[actionSheet.clientId]) {
            closeActionSheet();
        }
    }, [actionSheet.clientId, vmById, closeActionSheet]);

    const phoneExists = useCallback((phoneDigits: string, excludeId?: string | null) => {
        const p = normalizePhone(phoneDigits);
        if (!p) return false;
        return clients.some((c) => {
            if (excludeId && c.id === excludeId) return false;
            return normalizePhone(c.phone ?? "") === p;
        });
    }, [clients]);

    const openMaps = useCallback(async (url?: string) => {
        const u = (url ?? "").trim();
        if (!u) return;
        try {
            await Linking.openURL(u);
        } catch {
            Alert.alert("Error", "No se pudo abrir el link.");
        }
    }, []);

    const openWsp = useCallback(async (phone?: string) => {
        const p = normalizePhone(phone ?? "");
        if (!p) {
            Alert.alert("Sin teléfono", "Este cliente no tiene teléfono.");
            return;
        }

        const msg = "Olá! Estou entrando em contato sobre seu cadastro 🙌";
        const url = waLink(p, msg);

        try {
            await Linking.openURL(url);
        } catch {
            Alert.alert("Error", "No se pudo abrir WhatsApp.");
        }
    }, []);

    const openChatScreen = useCallback((clientId: string) => {
        const vm = vmById[clientId];
        if (!vm) return;

        const clientName = vm.name || vm.phone || "Lead";

        router.push({
            pathname: "/admin/lead-chat" as any,
            params: {
                clientId: vm.id,
                clientName,
            },
        });
    }, [router, vmById]);

    const confirmDelete = useCallback((id: string) => {
        closeActionSheet();
        Alert.alert("Eliminar lead", "¿Seguro que quieres eliminar este lead?", [
            { text: "Cancelar", style: "cancel" },
            {
                text: "Eliminar",
                style: "destructive",
                onPress: async () => {
                    try {
                        await deleteClient(id);
                    } catch (e: any) {
                        Alert.alert("Error", e?.message ?? "No se pudo eliminar");
                    }
                },
            },
        ]);
    }, [closeActionSheet]);

    const applyVerificationStatus = useCallback(async (
        clientId: string,
        nextStatus: Exclude<VerificationStatus, "verified">,
        reason?: string
    ) => {
        try {
            setBusyId(clientId);
            closeActionSheet();

            const patch: any = {
                verificationStatus: nextStatus,
                updatedAt: Date.now(),
            };

            if (nextStatus === "not_suitable") {
                patch.leadQuality = "not_suitable";
                patch.notSuitableReason = reason?.trim() || "Perfil no apto";
            } else {
                patch.leadQuality = "review";
                patch.notSuitableReason = "";
            }

            await updateClientFields(clientId, patch);
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo actualizar");
        } finally {
            setBusyId(null);
        }
    }, [closeActionSheet]);

    const confirmVerificationStatusChange = useCallback((
        clientId: string,
        nextStatus: Exclude<VerificationStatus, "verified">,
        reason?: string
    ) => {
        closeActionSheet();

        const title =
            nextStatus === "pending_review"
                ? "Marcar por revisar"
                : nextStatus === "incomplete"
                    ? "Marcar incompleto"
                    : "Marcar no apto";

        const description =
            nextStatus === "pending_review"
                ? "¿Seguro que quieres mover este lead a Por revisar?"
                : nextStatus === "incomplete"
                    ? "¿Seguro que quieres mover este lead a Incompleto?"
                    : `¿Seguro que quieres mover este lead a No apto${reason ? `?\n\nMotivo: ${reason}` : "?"}`;

        Alert.alert(title, description, [
            { text: "Cancelar", style: "cancel" },
            {
                text: "Confirmar",
                onPress: () => {
                    void applyVerificationStatus(clientId, nextStatus, reason);
                },
            },
        ]);
    }, [applyVerificationStatus, closeActionSheet]);

    const startEdit = useCallback((vm: LeadHistoryRowVM) => {
        closeActionSheet();
        const c = vm.raw;

        setEditingId(c.id);
        setEName(((c as any).name ?? "").toString());
        setEBusiness(((c as any).business ?? "").toString());
        setEBusinessRaw(((c as any).businessRaw ?? "").toString());
        setEPhone((c.phone ?? "").toString());
        setEMapsUrl((c.mapsUrl ?? "").toString());
        setEAddress((c.address ?? "").toString());

        const derivedStatus = getDerivedVerificationStatus(c);
        setEVerificationStatus(derivedStatus === "verified" ? "incomplete" : derivedStatus);
        setENotSuitableReason(getNotSuitableReason(c));
        setEditOpen(true);
    }, [closeActionSheet]);

    const cancelEdit = useCallback(() => {
        setEditOpen(false);
        setEditingId(null);
        setEName("");
        setEBusiness("");
        setEBusinessRaw("");
        setEPhone("");
        setEMapsUrl("");
        setEAddress("");
        setEVerificationStatus("incomplete");
        setENotSuitableReason("");
    }, []);

    const submitEdit = useCallback(async () => {
        if (!editingId) return;

        const cleanName = eName.trim();
        const cleanBusiness = eBusiness.trim();
        const cleanBusinessRaw = eBusinessRaw.trim();
        const cleanPhone = normalizePhone(ePhone);
        const cleanMaps = eMapsUrl.trim();
        const cleanAddress = eAddress.trim();
        const cleanNotSuitableReason = eNotSuitableReason.trim();

        if (!cleanPhone) {
            Alert.alert("Error", "Teléfono es obligatorio.");
            return;
        }

        if (phoneExists(cleanPhone, editingId)) {
            Alert.alert("Duplicado", "Ese teléfono ya existe. No se puede guardar duplicado.");
            return;
        }

        if (!cleanMaps) {
            Alert.alert("Error", "Link de Google Maps es obligatorio.");
            return;
        }

        if (!looksLikeMapsUrl(cleanMaps)) {
            Alert.alert("Error", "El link no parece ser de Google Maps.");
            return;
        }

        if (eVerificationStatus === "not_suitable" && !cleanNotSuitableReason) {
            Alert.alert("Error", "Indica el motivo de no apto.");
            return;
        }

        const { lat, lng } = extractLatLngFromMapsUrl(cleanMaps);

        setESaving(true);
        try {
            const nowMs = Date.now();
            const finalBusiness = cleanBusiness || cleanBusinessRaw;

            const patch: any = {
                updatedAt: nowMs,
                name: cleanName ? cleanName : "",
                business: cleanBusiness ? cleanBusiness : "",
                businessRaw: cleanBusinessRaw ? cleanBusinessRaw : finalBusiness,
                phone: cleanPhone,
                waId: cleanPhone,
                mapsUrl: cleanMaps,
                address: cleanAddress ? cleanAddress : "",
                lat,
                lng,
                currentLeadMapsConfirmedAt: nowMs,
                parseStatus: finalBusiness && cleanMaps ? "ready" : "partial",
                verificationStatus: eVerificationStatus,
                notSuitableReason: eVerificationStatus === "not_suitable" ? cleanNotSuitableReason : "",
                leadQuality:
                    eVerificationStatus === "not_suitable"
                        ? "not_suitable"
                        : "review",
                verifiedAt: null,
            };

            await updateClientFields(editingId, cleanUndefined(patch) as any);
            cancelEdit();
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo guardar");
        } finally {
            setESaving(false);
        }
    }, [
        editingId,
        eName,
        eBusiness,
        eBusinessRaw,
        ePhone,
        eMapsUrl,
        eAddress,
        eNotSuitableReason,
        eVerificationStatus,
        phoneExists,
        cancelEdit,
    ]);

    const selectedVm = actionSheet.clientId ? vmById[actionSheet.clientId] : null;

    const renderItem = useCallback<ListRenderItem<string>>(({ item: id }) => {
        const vm = vmById[id];
        if (!vm) return null;

        return (
            <HistoryLeadCard
                item={vm}
                isBusy={busyId === id}
                onOpenActions={(clientId) => setActionSheet({ open: true, clientId })}
                onOpenMaps={openMaps}
                onOpenWsp={openWsp}
                onOpenChat={openChatScreen}
            />
        );
    }, [vmById, busyId, openMaps, openWsp, openChatScreen]);

    const keyExtractor = useCallback((id: string) => id, []);

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
            <AdminBackground>
                <View style={styles.screenOverlay}>
                    <View style={[styles.header, { paddingTop: Math.max(10, insets.top * 0.35) }]}>
                        <View style={{ flex: 1, gap: 3 }}>
                            <Text style={styles.hTitle} numberOfLines={1}>
                                Historial de Leads
                            </Text>
                            <Text style={styles.hSub} numberOfLines={1}>
                                Archivados por inactividad · visibles <Text style={styles.hStrong}>{filteredIds.length}</Text> · total{" "}
                                <Text style={styles.hStrong}>{totals.total}</Text>
                            </Text>
                        </View>

                        <Pressable
                            onPress={reloadUsers}
                            style={({ pressed }) => [
                                styles.headerBadge,
                                pressed && styles.pressed,
                                usersLoading && styles.headerBadgeDisabled,
                            ]}
                            disabled={usersLoading}
                            accessibilityLabel="Refrescar usuarios"
                        >
                            <Ionicons
                                name={usersLoading ? "sync" : "people-outline"}
                                size={17}
                                color={COLORS.text}
                            />
                        </Pressable>
                    </View>

                    <View style={styles.filtersWrap}>
                        <FilterPill
                            label="Todos"
                            value={totals.total}
                            icon="apps-outline"
                            active={filter === "all"}
                            onPress={() => setFilter("all")}
                            tint={COLORS.purple}
                        />

                        <FilterPill
                            label="Incompletos"
                            value={totals.incomplete}
                            icon="alert-circle-outline"
                            active={filter === "incomplete"}
                            onPress={() => setFilter("incomplete")}
                            tint={COLORS.yellow}
                        />

                        <FilterPill
                            label="No aptos"
                            value={totals.notSuitable}
                            icon="ban-outline"
                            active={filter === "not_suitable"}
                            onPress={() => setFilter("not_suitable")}
                            tint={COLORS.red}
                        />
                    </View>

                    <View style={styles.searchWrap}>
                        <Ionicons name="search-outline" size={17} color={COLORS.muted} />
                        <TextInput
                            value={q}
                            onChangeText={setQ}
                            placeholder="Buscar lead, teléfono, negocio, dirección..."
                            placeholderTextColor={COLORS.muted}
                            style={styles.searchInput}
                        />
                        {!!q ? (
                            <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                                <Ionicons name="close" size={17} color={COLORS.text} />
                            </Pressable>
                        ) : null}
                    </View>

                    <View style={styles.listWrap}>
                        <FlashList
                            ref={listRef}
                            data={filteredIds}
                            keyExtractor={keyExtractor}
                            renderItem={renderItem}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={styles.listContent}
                            onScrollBeginDrag={closeActionSheet}
                            ListEmptyComponent={
                                <View style={styles.empty}>
                                    <Ionicons name="archive-outline" size={22} color={COLORS.muted} />
                                    <Text style={styles.emptyText}>
                                        {debouncedQ.trim()
                                            ? "No hay resultados."
                                            : "No hay leads archivados en historial."}
                                    </Text>
                                </View>
                            }
                        />
                    </View>

                    <Modal
                        visible={actionSheet.open}
                        transparent
                        animationType="fade"
                        onRequestClose={closeActionSheet}
                    >
                        <View style={styles.sheetOverlay}>
                            <Pressable style={StyleSheet.absoluteFillObject} onPress={closeActionSheet} />
                            <View style={styles.sheetWrap}>
                                <View style={styles.sheetHandle} />

                                <Text style={styles.sheetTitle}>
                                    {selectedVm?.phone || "Lead"}
                                </Text>
                                {!!selectedVm?.subtitle ? (
                                    <Text style={styles.sheetSubtitle} numberOfLines={1}>
                                        {selectedVm.subtitle}
                                    </Text>
                                ) : null}

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        confirmVerificationStatusChange(selectedVm.id, "pending_review");
                                    }}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="shield-checkmark-outline" size={17} color="#93C5FD" />
                                    <Text style={styles.sheetItemText}>Mover a por revisar</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        confirmVerificationStatusChange(selectedVm.id, "incomplete");
                                    }}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="alert-circle-outline" size={17} color="#FDE68A" />
                                    <Text style={styles.sheetItemText}>Mover a incompleto</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        confirmVerificationStatusChange(
                                            selectedVm.id,
                                            "not_suitable",
                                            selectedVm.notSuitableReason || "Perfil no apto"
                                        );
                                    }}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="ban-outline" size={17} color="#FCA5A5" />
                                    <Text style={styles.sheetItemText}>Mover a no apto</Text>
                                </Pressable>

                                <Pressable
                                    onPress={async () => {
                                        closeActionSheet();
                                        if (!users.length && !usersLoading) await reloadUsers();
                                        setAssignOpen(true);
                                    }}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="person-add-outline" size={17} color={COLORS.text} />
                                    <Text style={styles.sheetItemText}>Asignar a usuario</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        startEdit(selectedVm);
                                    }}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="create-outline" size={17} color={COLORS.text} />
                                    <Text style={styles.sheetItemText}>Editar lead</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        confirmDelete(selectedVm.id);
                                    }}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="trash-outline" size={17} color={COLORS.rejected} />
                                    <Text style={[styles.sheetItemText, { color: "#FCA5A5" }]}>Eliminar lead</Text>
                                </Pressable>
                            </View>
                        </View>
                    </Modal>

                    <Modal
                        visible={editOpen}
                        transparent
                        animationType="fade"
                        onRequestClose={cancelEdit}
                    >
                        <View style={styles.inlineModalOverlay}>
                            <View style={styles.inlineModalWrap}>
                                <View style={styles.modalCardBig}>
                                    <View style={styles.modalHeader}>
                                        <Text style={styles.modalTitle}>Editar lead archivado</Text>
                                        <Pressable onPress={cancelEdit} style={styles.modalClose}>
                                            <Ionicons name="close" size={18} color={COLORS.text} />
                                        </Pressable>
                                    </View>

                                    <ScrollView
                                        contentContainerStyle={{ gap: 10, paddingBottom: 6 }}
                                        showsVerticalScrollIndicator={false}
                                        keyboardShouldPersistTaps="handled"
                                    >
                                        <View style={styles.grid2}>
                                            <View style={[styles.field, { flex: 1 }]}>
                                                <Text style={styles.label}>Nombre</Text>
                                                <TextInput
                                                    value={eName}
                                                    onChangeText={setEName}
                                                    placeholder="Opcional"
                                                    placeholderTextColor={COLORS.muted}
                                                    style={styles.input}
                                                />
                                            </View>

                                            <View style={[styles.field, { flex: 1 }]}>
                                                <Text style={styles.label}>Negocio</Text>
                                                <TextInput
                                                    value={eBusiness}
                                                    onChangeText={setEBusiness}
                                                    placeholder="Opcional"
                                                    placeholderTextColor={COLORS.muted}
                                                    style={styles.input}
                                                />
                                            </View>
                                        </View>

                                        <View style={styles.field}>
                                            <Text style={styles.label}>Negocio original / bruto</Text>
                                            <TextInput
                                                value={eBusinessRaw}
                                                onChangeText={setEBusinessRaw}
                                                placeholder="Texto original del cliente"
                                                placeholderTextColor={COLORS.muted}
                                                style={styles.input}
                                            />
                                        </View>

                                        <View style={styles.grid2}>
                                            <View style={[styles.field, { flex: 1 }]}>
                                                <Text style={styles.label}>Teléfono *</Text>
                                                <TextInput
                                                    value={ePhone}
                                                    onChangeText={setEPhone}
                                                    keyboardType="phone-pad"
                                                    placeholder="+55 91 954 23 232"
                                                    placeholderTextColor={COLORS.muted}
                                                    style={styles.input}
                                                />
                                            </View>

                                            <View style={[styles.field, { flex: 1 }]}>
                                                <Text style={styles.label}>Dirección</Text>
                                                <TextInput
                                                    value={eAddress}
                                                    onChangeText={setEAddress}
                                                    placeholder="Opcional"
                                                    placeholderTextColor={COLORS.muted}
                                                    style={styles.input}
                                                />
                                            </View>
                                        </View>

                                        <View style={styles.field}>
                                            <Text style={styles.label}>Google Maps *</Text>
                                            <TextInput
                                                value={eMapsUrl}
                                                onChangeText={setEMapsUrl}
                                                autoCapitalize="none"
                                                placeholder="https://maps.google.com/..."
                                                placeholderTextColor={COLORS.muted}
                                                style={styles.input}
                                            />
                                        </View>

                                        <View style={styles.field}>
                                            <Text style={styles.label}>Estado</Text>
                                            <View style={styles.segmentRow}>
                                                {(["pending_review", "incomplete", "not_suitable"] as Exclude<VerificationStatus, "verified">[]).map((s) => {
                                                    const active = eVerificationStatus === s;
                                                    const label =
                                                        s === "pending_review"
                                                            ? "Por revisar"
                                                            : s === "incomplete"
                                                                ? "Incompleto"
                                                                : "No apto";

                                                    return (
                                                        <Pressable
                                                            key={s}
                                                            onPress={() => setEVerificationStatus(s)}
                                                            style={({ pressed }) => [
                                                                styles.segmentPill,
                                                                active && styles.segmentPillActive,
                                                                pressed && styles.pressed,
                                                            ]}
                                                        >
                                                            <Text style={[styles.segmentPillText, active && styles.segmentPillTextActive]}>
                                                                {label}
                                                            </Text>
                                                        </Pressable>
                                                    );
                                                })}
                                            </View>
                                        </View>

                                        {eVerificationStatus === "not_suitable" ? (
                                            <View style={styles.field}>
                                                <Text style={styles.label}>Motivo no apto *</Text>
                                                <TextInput
                                                    value={eNotSuitableReason}
                                                    onChangeText={setENotSuitableReason}
                                                    placeholder="Ej: Motorista / trabalho de aplicativo"
                                                    placeholderTextColor={COLORS.muted}
                                                    style={styles.input}
                                                />
                                            </View>
                                        ) : null}

                                        <View style={{ flexDirection: "row", gap: 10 }}>
                                            <Pressable
                                                onPress={cancelEdit}
                                                style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed]}
                                                disabled={eSaving}
                                            >
                                                <Ionicons name="close-outline" size={18} color={COLORS.text} />
                                                <Text style={styles.ghostBtnText}>Cancelar</Text>
                                            </Pressable>

                                            <Pressable
                                                onPress={submitEdit}
                                                style={({ pressed }) => [
                                                    styles.primaryBtn,
                                                    pressed && styles.btnPressed,
                                                    eSaving && styles.btnDisabled,
                                                ]}
                                                disabled={eSaving}
                                            >
                                                <Ionicons name="save-outline" size={18} color="#fff" />
                                                <Text style={styles.primaryBtnText}>
                                                    {eSaving ? "Guardando..." : "Guardar"}
                                                </Text>
                                            </Pressable>
                                        </View>
                                    </ScrollView>
                                </View>
                            </View>
                        </View>
                    </Modal>

                    <AdminAssignModal
                        visible={assignOpen}
                        onClose={() => setAssignOpen(false)}
                        entityId={selectedVm?.id ?? null}
                        entityType="lead"
                        entityTitle={selectedVm?.name || selectedVm?.phone || "Lead"}
                        entitySubtitle={selectedVm?.subtitle || selectedVm?.address || ""}
                        users={users}
                        currentAssignedUserId={selectedVm?.raw?.assignedTo ?? null}
                        loadingUsers={usersLoading}
                        busy={!!busyId && busyId === selectedVm?.id}
                        onAssign={async (entityId, userId) => {
                            try {
                                setBusyId(entityId);

                                await updateClientFields(entityId, {
                                    verificationStatus: "verified",
                                    leadQuality: "valid",
                                    notSuitableReason: "",
                                    verifiedAt: Date.now(),
                                    updatedAt: Date.now(),
                                } as any);

                                await assignClient(entityId, userId);
                                setAssignOpen(false);
                            } catch (e: any) {
                                Alert.alert("Error", e?.message ?? "No se pudo asignar");
                            } finally {
                                setBusyId(null);
                            }
                        }}
                    />
                </View>
            </AdminBackground>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },
    screenOverlay: { flex: 1 },
    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    header: {
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    hTitle: { color: COLORS.text, fontSize: 19, fontWeight: "900" },
    hSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    hStrong: { color: COLORS.text, fontWeight: "900" },
    headerBadge: {
        width: 40,
        height: 40,
        borderRadius: 13,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    headerBadgeDisabled: { opacity: 0.55 },

    filtersWrap: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    filterPill: {
        minHeight: 32,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "#0F172A",
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    filterPillActive: {
        backgroundColor: "rgba(124,58,237,0.10)",
        borderColor: "rgba(124,58,237,0.26)",
    },
    filterPillText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    filterPillTextActive: {
        color: COLORS.text,
    },
    filterPillCount: {
        minWidth: 18,
        height: 18,
        borderRadius: 999,
        paddingHorizontal: 5,
        textAlign: "center",
        textAlignVertical: "center",
        overflow: "hidden",
        backgroundColor: "rgba(255,255,255,0.06)",
        color: "#CBD5E1",
        fontSize: 10,
        fontWeight: "900",
        lineHeight: 18,
    },
    filterPillCountActive: {
        backgroundColor: "rgba(124,58,237,0.20)",
        color: "#C4B5FD",
    },

    searchWrap: {
        marginHorizontal: 16,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 15,
        paddingHorizontal: 12,
        height: 46,
    },
    searchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
    },
    clearBtn: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    listWrap: { flex: 1 },
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 28,
        paddingTop: 2,
    },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        gap: 9,
        marginBottom: 10,
    },
    cardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
    },
    cardTopMain: {
        flex: 1,
        gap: 4,
        paddingRight: 4,
    },
    phone: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },
    metaPrimary: {
        color: "#D7DCE5",
        fontSize: 13,
        fontWeight: "900",
    },
    meta: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },

    menuBtn: {
        width: 34,
        height: 34,
        borderRadius: 11,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },

    statusBox: {
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    statusBoxYellow: {
        backgroundColor: "rgba(251,191,36,0.08)",
        borderColor: "rgba(251,191,36,0.22)",
    },
    statusBoxRed: {
        backgroundColor: "rgba(248,113,113,0.08)",
        borderColor: "rgba(248,113,113,0.22)",
    },
    statusBoxText: {
        flex: 1,
        fontSize: 12,
        fontWeight: "900",
    },
    statusBoxTextYellow: { color: "#FDE68A" },
    statusBoxTextRed: { color: "#FCA5A5" },

    historyBadgeRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    historyBadge: {
        minHeight: 24,
        paddingHorizontal: 9,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    historyBadgeYellow: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.24)",
    },
    historyBadgeRed: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.24)",
    },
    historyBadgeText: {
        fontSize: 10,
        fontWeight: "900",
    },
    historyBadgeTextYellow: { color: "#FDE68A" },
    historyBadgeTextRed: { color: "#FCA5A5" },

    infoRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    infoText: {
        flex: 1,
        color: COLORS.text,
        opacity: 0.9,
        fontSize: 12,
        fontWeight: "700",
    },

    assignedRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    assignedText: {
        flex: 1,
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
    },

    inboundBox: {
        padding: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        gap: 5,
    },
    inboundHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    inboundTitle: {
        flex: 1,
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "900",
    },
    inboundText: {
        color: COLORS.text,
        opacity: 0.9,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 17,
    },
    inboundOpenPill: {
        paddingHorizontal: 8,
        height: 20,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(37,99,235,0.12)",
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.26)",
    },
    inboundOpenPillText: {
        color: "#93C5FD",
        fontSize: 10,
        fontWeight: "900",
    },

    openChatEmptyBtn: {
        minHeight: 38,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.26)",
        backgroundColor: "rgba(37,99,235,0.08)",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 12,
    },
    openChatEmptyBtnText: {
        color: "#93C5FD",
        fontSize: 12,
        fontWeight: "900",
    },

    bottomMiniRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    miniIconBtn: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    iconBtnPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },
    bottomReasonText: {
        flex: 1,
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
        marginLeft: 2,
    },

    busyText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },

    empty: {
        marginTop: 48,
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
    },
    emptyText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "900",
        textAlign: "center",
    },

    sheetOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "flex-end",
    },
    sheetWrap: {
        backgroundColor: COLORS.card,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: 1,
        borderColor: COLORS.border,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 18,
        gap: 4,
    },
    sheetHandle: {
        width: 42,
        height: 5,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.18)",
        alignSelf: "center",
        marginBottom: 8,
    },
    sheetTitle: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
        textAlign: "center",
    },
    sheetSubtitle: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        textAlign: "center",
        marginBottom: 8,
    },
    sheetItem: {
        minHeight: 46,
        borderRadius: 14,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: "transparent",
    },
    sheetItemText: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "800",
    },

    inlineModalOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.55)",
        padding: 12,
        justifyContent: "center",
        zIndex: 100,
        elevation: 100,
    },
    inlineModalWrap: { width: "100%" },

    modalCardBig: {
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        maxHeight: "92%",
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
        gap: 10,
    },
    modalTitle: {
        color: COLORS.text,
        fontSize: 16,
        fontWeight: "900",
    },
    modalClose: {
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },

    field: { gap: 6 },
    label: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    input: {
        height: 48,
        borderRadius: 14,
        paddingHorizontal: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
    },
    grid2: {
        flexDirection: "row",
        gap: 10,
    },

    segmentRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    segmentPill: {
        paddingHorizontal: 12,
        height: 36,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    segmentPillActive: {
        backgroundColor: "rgba(37,99,235,0.16)",
        borderColor: "rgba(37,99,235,0.35)",
    },
    segmentPillText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    segmentPillTextActive: {
        color: COLORS.text,
    },

    ghostBtn: {
        flex: 1,
        height: 50,
        borderRadius: 16,
        paddingHorizontal: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
    },
    ghostBtnText: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 14,
    },
    primaryBtn: {
        flex: 1,
        height: 50,
        borderRadius: 16,
        backgroundColor: COLORS.primary,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
        shadowColor: "#14B8A6",
        shadowOpacity: 0.25,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 4,
    },
    primaryBtnText: {
        color: "#fff",
        fontWeight: "900",
        fontSize: 14,
    },
    btnPressed: {
        transform: [{ scale: 0.99 }],
        opacity: 0.96,
    },
    btnDisabled: { opacity: 0.55 },
});