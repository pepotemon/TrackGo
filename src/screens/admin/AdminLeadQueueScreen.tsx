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
import AdminBackground from "../../components/admin/AdminBackground";
import AssignCoverageModal from "../../components/admin/AssignCoverageModal";
import {
    assignClient,
    deleteClient,
    getClientLeadHistoryBucket,
    getClientRelevantLeadActivityAt,
    isClientInActiveLeadQueue,
    subscribeAdminLeadHistory,
    subscribeAdminLeadQueue,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, UserDoc } from "../../types/models";
type MetaFilterKey =
    | "pending_review"
    | "incomplete"
    | "not_suitable"
    | "all";

type VerificationStatus =
    | "verified"
    | "pending_review"
    | "incomplete"
    | "not_suitable";

type QueueScope = "today" | "all";

type ActionSheetState = {
    open: boolean;
    clientId: string | null;
};

type LeadRowVM = {
    id: string;
    raw: ClientDoc;
    phone: string;
    waPhone: string;
    name: string;
    subtitle: string;
    address: string;
    mapsUrl: string;
    verificationStatus: VerificationStatus;
    verificationLabel: string;
    quickStatusText: string;
    notSuitableReason: string;
    createdAtMs: number;
    updatedAtMs: number;
    lastInboundAtMs: number;
    baseDateMs: number;
    lastInboundText: string;
    searchBlob: string;
    hasNewInbound: boolean;
    historyBucket: "incomplete" | "not_suitable" | null;
    cityLabel: string;
    cityNormalized: string;
    isOutOfCoverage: boolean;
};

const localSeenInboundMap: Record<string, number> = {};

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

function safeText(x?: string | null) {
    return String(x ?? "").toLowerCase();
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

function isSameLocalDay(aMs?: number, bMs?: number) {
    if (!aMs || !bMs) return false;
    const a = new Date(aMs);
    const b = new Date(bMs);

    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
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

function getVerificationStatusLabel(status: VerificationStatus) {
    if (status === "verified") return "Verificado";
    if (status === "pending_review") return "Por revisar";
    if (status === "not_suitable") return "No apto";
    return "Incompleto";
}

function getVerificationStatusFilterLabel(status: VerificationStatus | "all") {
    if (status === "verified") return "Verificados";
    if (status === "pending_review") return "Por revisar";
    if (status === "not_suitable") return "No aptos";
    if (status === "incomplete") return "Incompletos";
    return "Todos";
}

function getNotSuitableReason(c: ClientDoc) {
    return String((c as any)?.notSuitableReason ?? "").trim();
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

function getServerSeenAt(c: ClientDoc) {
    return toMs((c as any)?.adminQueueLastSeenMessageAt);
}

function useDebouncedValue<T>(value: T, delay = 250) {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);

    return debounced;
}

function stringOrEmpty(v: any) {
    return String(v ?? "").trim();
}

function getCityLabel(c: ClientDoc) {
    const direct =
        stringOrEmpty((c as any)?.geoCityLabel) ||
        stringOrEmpty((c as any)?.geoAdminDisplayLabel) ||
        stringOrEmpty((c as any)?.geoAdminCityLabel) ||
        stringOrEmpty((c as any)?.geoAdminStateLabel) ||
        stringOrEmpty((c as any)?.cityLabel) ||
        stringOrEmpty((c as any)?.leadCityLabel);

    return direct;
}

function getCityNormalized(c: ClientDoc) {
    return (
        stringOrEmpty((c as any)?.geoCityNormalized) ||
        stringOrEmpty((c as any)?.geoAdminCityNormalized) ||
        stringOrEmpty((c as any)?.geoAdminStateNormalized) ||
        stringOrEmpty((c as any)?.cityNormalized) ||
        stringOrEmpty((c as any)?.leadCityNormalized)
    );
}

function getCityOutOfCoverage(c: ClientDoc) {
    const v =
        (c as any)?.geoOutOfCoverage ??
        (c as any)?.cityOutOfCoverage ??
        false;

    return v === true;
}

function buildLeadVM(c: ClientDoc): LeadRowVM {
    const verificationStatus = getDerivedVerificationStatus(c);
    const createdAtMs = toMs((c as any)?.createdAt);
    const updatedAtMs = toMs((c as any)?.updatedAt);
    const lastInboundAtMs = toMs((c as any)?.lastInboundMessageAt);
    const localSeen = localSeenInboundMap[c.id] ?? 0;
    const serverSeen = getServerSeenAt(c);
    const effectiveSeen = Math.max(localSeen, serverSeen);
    const hasNewInbound = !!lastInboundAtMs && lastInboundAtMs > effectiveSeen;

    const phone = String(c.phone ?? "").trim();
    const waPhone = String((c as any)?.waId ?? c.phone ?? "").trim();
    const name = String((c as any)?.name ?? "").trim();
    const subtitle = String((c as any)?.business ?? (c as any)?.businessRaw ?? "").trim();
    const address = String(c.address ?? "").trim();
    const mapsUrl = String(c.mapsUrl ?? "").trim();
    const quickStatusText = getQuickStatusText(c);
    const notSuitableReason = getNotSuitableReason(c);
    const lastInboundText = String((c as any)?.lastInboundText ?? "").trim();
    const verificationLabel = getVerificationStatusLabel(verificationStatus);
    const baseDateMs = getClientRelevantLeadActivityAt(c);
    const historyBucket = getClientLeadHistoryBucket(c);
    const cityLabel = getCityLabel(c);
    const cityNormalized = getCityNormalized(c);
    const isOutOfCoverage = getCityOutOfCoverage(c);

    const searchBlob = `
        ${safeText(name)}
        ${safeText(subtitle)}
        ${safeText(address)}
        ${safeText(mapsUrl)}
        ${safeText(phone)}
        ${safeText(verificationLabel)}
        ${safeText(notSuitableReason)}
        ${safeText(quickStatusText)}
        ${safeText(lastInboundText)}
        ${safeText(cityLabel)}
        ${safeText(cityNormalized)}
        ${safeText((c as any)?.geoAdminStateLabel)}
        ${safeText((c as any)?.geoAdminDisplayLabel)}
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
        verificationLabel,
        quickStatusText,
        notSuitableReason,
        createdAtMs,
        updatedAtMs,
        lastInboundAtMs,
        baseDateMs,
        lastInboundText,
        searchBlob,
        hasNewInbound,
        historyBucket,
        cityLabel,
        cityNormalized,
        isOutOfCoverage,
    };
}

const LeadCard = memo(function LeadCard({
    item,
    isBusy,
    onOpenActions,
    onOpenMaps,
    onOpenWsp,
    onOpenChat,
}: {
    item: LeadRowVM;
    isBusy: boolean;
    onOpenActions: (id: string) => void;
    onOpenMaps: (url?: string) => void;
    onOpenWsp: (phone?: string) => void;
    onOpenChat: (id: string) => void;
}) {
    const statusBoxStyle =
        item.verificationStatus === "pending_review"
            ? styles.statusBoxBlue
            : item.verificationStatus === "not_suitable"
                ? styles.statusBoxRed
                : styles.statusBoxYellow;

    const statusTextStyle =
        item.verificationStatus === "pending_review"
            ? styles.statusBoxTextBlue
            : item.verificationStatus === "not_suitable"
                ? styles.statusBoxTextRed
                : styles.statusBoxTextYellow;

    const statusIconName =
        item.verificationStatus === "pending_review"
            ? "search-outline"
            : item.verificationStatus === "not_suitable"
                ? "ban-outline"
                : "warning-outline";

    const statusIconColor =
        item.verificationStatus === "pending_review"
            ? "#93C5FD"
            : item.verificationStatus === "not_suitable"
                ? "#FCA5A5"
                : "#FDE68A";

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <View style={styles.cardTopMain}>
                    <View style={styles.topLine}>
                        <Text style={styles.phone} numberOfLines={1}>
                            {item.phone || "Sin teléfono"}
                        </Text>

                        {item.hasNewInbound ? (
                            <View style={styles.newPillInline}>
                                <Text style={styles.newPillText}>NEW</Text>
                            </View>
                        ) : null}
                    </View>

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

                    {!!item.cityLabel ? (
                        <View
                            style={[
                                styles.cityPill,
                                item.isOutOfCoverage && styles.cityPillOut,
                            ]}
                        >
                            <Ionicons
                                name={
                                    item.isOutOfCoverage
                                        ? "alert-circle-outline"
                                        : "location-outline"
                                }
                                size={12}
                                color={item.isOutOfCoverage ? "#FDE68A" : "#93C5FD"}
                            />
                            <Text
                                style={[
                                    styles.cityPillText,
                                    item.isOutOfCoverage && styles.cityPillTextOut,
                                ]}
                                numberOfLines={1}
                            >
                                {item.cityLabel}
                            </Text>
                        </View>
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

            <View style={[styles.statusBox, statusBoxStyle]}>
                <Ionicons name={statusIconName} size={14} color={statusIconColor} />
                <Text style={[styles.statusBoxText, statusTextStyle]} numberOfLines={2}>
                    {item.quickStatusText}
                </Text>
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
                    Creado: {formatDateLabel(item.createdAtMs)} · Relevante:{" "}
                    {formatDateLabel(item.baseDateMs || item.createdAtMs)}
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
                        <Ionicons
                            name="chatbubble-ellipses-outline"
                            size={13}
                            color={COLORS.muted}
                        />
                        <Text style={styles.inboundTitle}>Último mensaje recibido</Text>

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

                {item.verificationStatus === "not_suitable" && !!item.notSuitableReason ? (
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

const FooterFilterButton = memo(function FooterFilterButton({
    label,
    count,
    icon,
    active,
    tint,
    onPress,
}: {
    label: string;
    count: number;
    icon: any;
    active: boolean;
    tint: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.footerFilterBtn,
                active && styles.footerFilterBtnActive,
                pressed && styles.pressed,
            ]}
        >
            <View style={styles.footerFilterTop}>
                <Ionicons
                    name={icon}
                    size={16}
                    color={active ? COLORS.text : tint}
                />
                <View
                    style={[
                        styles.footerFilterCountWrap,
                        active && styles.footerFilterCountWrapActive,
                    ]}
                >
                    <Text
                        style={[
                            styles.footerFilterCount,
                            active && styles.footerFilterCountActive,
                        ]}
                    >
                        {count}
                    </Text>
                </View>
            </View>

            <Text
                style={[
                    styles.footerFilterLabel,
                    active && styles.footerFilterLabelActive,
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
        </Pressable>
    );
});

export default function AdminLeadQueueScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [queueClients, setQueueClients] = useState<ClientDoc[]>([]);
    const [historyBaseClients, setHistoryBaseClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [coverageModalOpen, setCoverageModalOpen] = useState(false);
    const [q, setQ] = useState("");
    const debouncedQ = useDebouncedValue(q, 280);

    const [filter, setFilter] = useState<MetaFilterKey>("pending_review");
    const [queueScope, setQueueScope] = useState<QueueScope>("all");
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
    const [eVerificationStatus, setEVerificationStatus] =
        useState<VerificationStatus>("pending_review");
    const [eNotSuitableReason, setENotSuitableReason] = useState("");
    const [eSaving, setESaving] = useState(false);

    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [pickerTargetClientId, setPickerTargetClientId] = useState<string | null>(null);

    const listRef = useRef<any>(null);

    useEffect(() => {
        const unsubQueue = subscribeAdminLeadQueue(
            (list) => setQueueClients(list ?? []),
            {
                limitCount: 800,
                verificationStatuses: ["pending_review", "incomplete", "not_suitable"],
            }
        );

        const unsubHistory = subscribeAdminLeadHistory(
            (list) => setHistoryBaseClients(list ?? []),
            {
                limitCount: 800,
                verificationStatuses: ["incomplete", "not_suitable"],
            }
        );

        return () => {
            unsubQueue();
            unsubHistory();
        };
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
    }, [filter, queueScope, debouncedQ, closeActionSheet]);

    const activeQueueClients = useMemo(() => {
        const now = Date.now();
        return queueClients.filter((c) => isClientInActiveLeadQueue(c, now));
    }, [queueClients]);

    const historyCandidates = useMemo(() => {
        const now = Date.now();
        return historyBaseClients.filter((c) => !!getClientLeadHistoryBucket(c, now));
    }, [historyBaseClients]);

    const leadVMs = useMemo(() => {
        return activeQueueClients.map(buildLeadVM);
    }, [activeQueueClients]);

    const vmById = useMemo(() => {
        const map: Record<string, LeadRowVM> = {};
        for (const item of leadVMs) {
            map[item.id] = item;
        }
        return map;
    }, [leadVMs]);

    const totals = useMemo(() => {
        let verified = 0;
        let pendingReview = 0;
        let incomplete = 0;
        let notSuitable = 0;

        for (const item of leadVMs) {
            const s = item.verificationStatus;
            if (s === "verified") verified++;
            else if (s === "pending_review") pendingReview++;
            else if (s === "not_suitable") notSuitable++;
            else incomplete++;
        }

        return {
            total: verified + pendingReview + incomplete + notSuitable,
            verified,
            pendingReview,
            incomplete,
            notSuitable,
        };
    }, [leadVMs]);

    const todayCounts = useMemo(() => {
        const now = Date.now();

        let pendingReview = 0;
        let incomplete = 0;
        let notSuitable = 0;

        for (const item of leadVMs) {
            if (!isSameLocalDay(item.baseDateMs, now)) continue;

            if (item.verificationStatus === "pending_review") pendingReview++;
            else if (item.verificationStatus === "incomplete") incomplete++;
            else if (item.verificationStatus === "not_suitable") notSuitable++;
        }

        return {
            pendingReview,
            incomplete,
            notSuitable,
        };
    }, [leadVMs]);

    const filteredIds = useMemo(() => {
        const qtText = debouncedQ.trim().toLowerCase();
        const qtDigits = normalizePhone(debouncedQ);
        const now = Date.now();

        const list = leadVMs.filter((item) => {
            const verification = item.verificationStatus;

            if (verification === "verified") return false;
            if (filter !== "all" && verification !== filter) return false;

            const shouldShowScope =
                filter === "pending_review" ||
                filter === "incomplete" ||
                filter === "not_suitable";

            if (shouldShowScope && queueScope === "today") {
                if (!isSameLocalDay(item.baseDateMs, now)) return false;
            }

            if (!qtText && !qtDigits) return true;

            if (qtDigits && normalizePhone(item.phone).includes(qtDigits)) return true;
            if (qtText && item.searchBlob.includes(qtText)) return true;

            return false;
        });

        list.sort((a, b) => {
            const aNew = a.hasNewInbound ? 1 : 0;
            const bNew = b.hasNewInbound ? 1 : 0;

            if (aNew !== bNew) return bNew - aNew;

            const aMs = a.updatedAtMs || a.createdAtMs;
            const bMs = b.updatedAtMs || b.createdAtMs;
            return bMs - aMs;
        });

        return list.map((x) => x.id);
    }, [leadVMs, debouncedQ, filter, queueScope]);

    useEffect(() => {
        if (!actionSheet.clientId) return;
        if (!vmById[actionSheet.clientId]) {
            closeActionSheet();
        }
    }, [actionSheet.clientId, vmById, closeActionSheet]);

    const visibleTotal = useMemo(() => {
        return totals.pendingReview + totals.incomplete + totals.notSuitable;
    }, [totals]);

    const currentScopeAllCount = useMemo(() => {
        if (filter === "pending_review") return totals.pendingReview;
        if (filter === "incomplete") return totals.incomplete;
        if (filter === "not_suitable") return totals.notSuitable;
        return visibleTotal;
    }, [filter, totals, visibleTotal]);

    const currentScopeTodayCount = useMemo(() => {
        if (filter === "pending_review") return todayCounts.pendingReview;
        if (filter === "incomplete") return todayCounts.incomplete;
        if (filter === "not_suitable") return todayCounts.notSuitable;
        return 0;
    }, [filter, todayCounts]);

    const showScopeFilter =
        filter === "pending_review" ||
        filter === "incomplete" ||
        filter === "not_suitable";

    const allKnownClients = useMemo(() => {
        const map = new Map<string, ClientDoc>();
        for (const c of queueClients) map.set(c.id, c);
        for (const c of historyBaseClients) map.set(c.id, c);
        return Array.from(map.values());
    }, [queueClients, historyBaseClients]);

    const phoneExists = useCallback(
        (phoneDigits: string, excludeId?: string | null) => {
            const p = normalizePhone(phoneDigits);
            if (!p) return false;
            return allKnownClients.some((c) => {
                if (excludeId && c.id === excludeId) return false;
                return normalizePhone(c.phone ?? "") === p;
            });
        },
        [allKnownClients]
    );

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

    const markClientSeenInstant = useCallback((vm: LeadRowVM) => {
        const lastInboundAt = vm.lastInboundAtMs;
        if (!lastInboundAt) return;

        localSeenInboundMap[vm.id] = Math.max(
            localSeenInboundMap[vm.id] ?? 0,
            lastInboundAt
        );

        void updateClientFields(vm.id, {
            adminQueueLastSeenMessageAt: lastInboundAt,
            adminQueueSeenAt: Date.now(),
        } as any).catch(() => {
            // efecto local se mantiene aunque Firebase falle
        });
    }, []);

    const openChatScreen = useCallback(
        (clientId: string) => {
            const vm = vmById[clientId];
            if (!vm) return;

            const clientName = vm.name || vm.phone || "Lead";
            markClientSeenInstant(vm);

            router.push({
                pathname: "/admin/lead-chat" as any,
                params: {
                    clientId: vm.id,
                    clientName,
                },
            });
        },
        [markClientSeenInstant, router, vmById]
    );

    const goToHistory = useCallback(() => {
        closeActionSheet();
        router.push("/admin/lead-history" as any);
    }, [closeActionSheet, router]);

    const confirmDelete = useCallback(
        (id: string) => {
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
        },
        [closeActionSheet]
    );

    const openAssignPicker = useCallback(
        async (clientId: string) => {
            closeActionSheet();
            if (!users.length && !usersLoading) await reloadUsers();
            setPickerTargetClientId(clientId);
            setPickerQuery("");
            setUserPickerOpen(true);
        },
        [closeActionSheet, reloadUsers, users.length, usersLoading]
    );

    const onPickUser = useCallback(
        async (u: UserDoc) => {
            const clientId = pickerTargetClientId;
            setUserPickerOpen(false);
            if (!clientId) return;

            Alert.alert(
                "Confirmar asignación",
                `¿Asignar este lead a ${u.name || u.email || "este usuario"}?\n\nAl asignarlo, pasará automáticamente a verificado.`,
                [
                    {
                        text: "Cancelar",
                        style: "cancel",
                        onPress: () => setPickerTargetClientId(null),
                    },
                    {
                        text: "Asignar",
                        onPress: async () => {
                            try {
                                setBusyId(clientId);

                                await updateClientFields(clientId, {
                                    verificationStatus: "verified",
                                    leadQuality: "valid",
                                    notSuitableReason: "",
                                    verifiedAt: Date.now(),
                                    updatedAt: Date.now(),
                                } as any);

                                await assignClient(clientId, u.id);
                            } catch (e: any) {
                                Alert.alert("Error", e?.message ?? "No se pudo asignar");
                            } finally {
                                setBusyId(null);
                                setPickerTargetClientId(null);
                            }
                        },
                    },
                ]
            );
        },
        [pickerTargetClientId]
    );

    const applyVerificationStatus = useCallback(
        async (
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
        },
        [closeActionSheet]
    );

    const confirmVerificationStatusChange = useCallback(
        (
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
                        : `¿Seguro que quieres mover este lead a No apto${reason ? `?\n\nMotivo: ${reason}` : "?"
                        }`;

            Alert.alert(title, description, [
                { text: "Cancelar", style: "cancel" },
                {
                    text: "Confirmar",
                    onPress: () => {
                        void applyVerificationStatus(clientId, nextStatus, reason);
                    },
                },
            ]);
        },
        [applyVerificationStatus, closeActionSheet]
    );

    const startEdit = useCallback(
        (vm: LeadRowVM) => {
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
            setEVerificationStatus(
                derivedStatus === "verified" ? "pending_review" : derivedStatus
            );
            setENotSuitableReason(getNotSuitableReason(c));
            setEditOpen(true);
        },
        [closeActionSheet]
    );

    const cancelEdit = useCallback(() => {
        setEditOpen(false);
        setEditingId(null);
        setEName("");
        setEBusiness("");
        setEBusinessRaw("");
        setEPhone("");
        setEMapsUrl("");
        setEAddress("");
        setEVerificationStatus("pending_review");
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
            const now = Date.now();
            const finalBusiness = cleanBusiness || cleanBusinessRaw;

            const patch: any = {
                updatedAt: now,
                name: cleanName ? cleanName : "",
                business: cleanBusiness ? cleanBusiness : "",
                businessRaw: cleanBusinessRaw ? cleanBusinessRaw : finalBusiness,
                phone: cleanPhone,
                waId: cleanPhone,
                mapsUrl: cleanMaps,
                address: cleanAddress ? cleanAddress : "",
                lat,
                lng,
                currentLeadMapsConfirmedAt: now,
                parseStatus: finalBusiness && cleanMaps ? "ready" : "partial",
                verificationStatus: eVerificationStatus,
                notSuitableReason:
                    eVerificationStatus === "not_suitable" ? cleanNotSuitableReason : "",
                leadQuality:
                    eVerificationStatus === "not_suitable" ? "not_suitable" : "review",
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

    const pickerUsers = useMemo(() => {
        const qt = pickerQuery.trim().toLowerCase();
        if (!qt) return users;

        return users.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, pickerQuery]);

    const selectedVm = actionSheet.clientId ? vmById[actionSheet.clientId] : null;

    const renderItem = useCallback<ListRenderItem<string>>(
        ({ item: id }) => {
            const vm = vmById[id];
            if (!vm) return null;

            return (
                <LeadCard
                    item={vm}
                    isBusy={busyId === id}
                    onOpenActions={(clientId) => setActionSheet({ open: true, clientId })}
                    onOpenMaps={openMaps}
                    onOpenWsp={openWsp}
                    onOpenChat={openChatScreen}
                />
            );
        },
        [vmById, busyId, openMaps, openWsp, openChatScreen]
    );

    const keyExtractor = useCallback((id: string) => id, []);

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
            <AdminBackground>
                <View style={styles.screenOverlay}>
                    <View
                        style={[
                            styles.header,
                            { paddingTop: Math.max(10, insets.top * 0.35) },
                        ]}
                    >
                        <View style={{ flex: 1, gap: 3 }}>
                            <Text style={styles.hTitle} numberOfLines={1}>
                                Leads Meta
                            </Text>
                            <Text style={styles.hSub} numberOfLines={1}>
                                Cola activa · visibles{" "}
                                <Text style={styles.hStrong}>{filteredIds.length}</Text> · total{" "}
                                <Text style={styles.hStrong}>{visibleTotal}</Text>
                            </Text>
                        </View>



                        <Pressable
                            onPress={() => setCoverageModalOpen(true)}
                            style={({ pressed }) => [
                                styles.headerBadge,
                                pressed && styles.pressed,
                            ]}
                        >
                            <Ionicons name="git-merge-outline" size={18} color={COLORS.text} />
                        </Pressable>
                        <Pressable
                            onPress={goToHistory}
                            style={({ pressed }) => [
                                styles.headerHistoryBtn,
                                pressed && styles.pressed,
                            ]}
                            accessibilityLabel="Abrir historial de leads"
                        >
                            <Ionicons name="archive-outline" size={17} color={COLORS.text} />
                            <Text style={styles.headerHistoryBtnText}>
                                {historyCandidates.length}
                            </Text>
                        </Pressable>

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

                    <View style={styles.searchWrap}>
                        <Ionicons name="search-outline" size={17} color={COLORS.muted} />
                        <TextInput
                            value={q}
                            onChangeText={setQ}
                            placeholder=""
                            placeholderTextColor={COLORS.muted}
                            style={styles.searchInput}
                        />
                        {!!q ? (
                            <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                                <Ionicons name="close" size={17} color={COLORS.text} />
                            </Pressable>
                        ) : null}
                    </View>

                    {showScopeFilter ? (
                        <View style={styles.secondaryFilterWrap}>
                            <View style={styles.secondaryFilterRow}>
                                <Pressable
                                    onPress={() => setQueueScope("today")}
                                    style={({ pressed }) => [
                                        styles.secondaryFilterPill,
                                        queueScope === "today" &&
                                        styles.secondaryFilterPillActive,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="today-outline"
                                        size={13}
                                        color={
                                            queueScope === "today"
                                                ? "#93C5FD"
                                                : COLORS.muted
                                        }
                                    />
                                    <Text
                                        style={[
                                            styles.secondaryFilterPillText,
                                            queueScope === "today" &&
                                            styles.secondaryFilterPillTextActive,
                                        ]}
                                    >
                                        Hoy
                                    </Text>
                                    <Text
                                        style={[
                                            styles.secondaryFilterPillCount,
                                            queueScope === "today" &&
                                            styles.secondaryFilterPillCountActive,
                                        ]}
                                    >
                                        {currentScopeTodayCount}
                                    </Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => setQueueScope("all")}
                                    style={({ pressed }) => [
                                        styles.secondaryFilterPill,
                                        queueScope === "all" &&
                                        styles.secondaryFilterPillActive,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="albums-outline"
                                        size={13}
                                        color={
                                            queueScope === "all"
                                                ? "#93C5FD"
                                                : COLORS.muted
                                        }
                                    />
                                    <Text
                                        style={[
                                            styles.secondaryFilterPillText,
                                            queueScope === "all" &&
                                            styles.secondaryFilterPillTextActive,
                                        ]}
                                    >
                                        Todos
                                    </Text>
                                    <Text
                                        style={[
                                            styles.secondaryFilterPillCount,
                                            queueScope === "all" &&
                                            styles.secondaryFilterPillCountActive,
                                        ]}
                                    >
                                        {currentScopeAllCount}
                                    </Text>
                                </Pressable>
                            </View>
                        </View>
                    ) : null}

                    <View style={styles.listWrap}>
                        <FlashList
                            ref={listRef}
                            data={filteredIds}
                            keyExtractor={keyExtractor}
                            renderItem={renderItem}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={[
                                styles.listContent,
                                { paddingBottom: 130 + insets.bottom },
                            ]}
                            onScrollBeginDrag={closeActionSheet}

                            ListEmptyComponent={
                                <View style={styles.empty}>
                                    <Ionicons
                                        name="file-tray-outline"
                                        size={22}
                                        color={COLORS.muted}
                                    />
                                    <Text style={styles.emptyText}>
                                        {debouncedQ.trim()
                                            ? "No hay resultados."
                                            : showScopeFilter && queueScope === "today"
                                                ? "No hay leads activos de hoy en este filtro."
                                                : "No hay leads Meta en la cola activa."}
                                    </Text>
                                </View>
                            }
                        />
                    </View>

                    <View
                        style={[
                            styles.footerFilterBar,
                            { paddingBottom: Math.max(insets.bottom, 10) },
                        ]}
                    >
                        <View style={styles.footerFilterInner}>
                            <FooterFilterButton
                                label="Revisar"
                                count={totals.pendingReview}
                                icon="shield-checkmark-outline"
                                active={filter === "pending_review"}
                                tint="#93C5FD"
                                onPress={() => {
                                    closeActionSheet();
                                    setFilter("pending_review");
                                }}
                            />

                            <FooterFilterButton
                                label="Incompletos"
                                count={totals.incomplete}
                                icon="alert-circle-outline"
                                active={filter === "incomplete"}
                                tint="#FDE68A"
                                onPress={() => {
                                    closeActionSheet();
                                    setFilter("incomplete");
                                }}
                            />

                            <FooterFilterButton
                                label="No aptos"
                                count={totals.notSuitable}
                                icon="ban-outline"
                                active={filter === "not_suitable"}
                                tint="#FCA5A5"
                                onPress={() => {
                                    closeActionSheet();
                                    setFilter("not_suitable");
                                }}
                            />

                            <FooterFilterButton
                                label="Todos"
                                count={visibleTotal}
                                icon="apps-outline"
                                active={filter === "all"}
                                tint="#C4B5FD"
                                onPress={() => {
                                    closeActionSheet();
                                    setFilter("all");
                                    setQueueScope("all");
                                }}
                            />
                        </View>
                    </View>

                    <Modal
                        visible={actionSheet.open}
                        transparent
                        animationType="fade"
                        onRequestClose={closeActionSheet}
                    >
                        <View style={styles.sheetOverlay}>
                            <Pressable
                                style={StyleSheet.absoluteFillObject}
                                onPress={closeActionSheet}
                            />
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
                                        confirmVerificationStatusChange(
                                            selectedVm.id,
                                            "pending_review"
                                        );
                                    }}
                                    style={({ pressed }) => [
                                        styles.sheetItem,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="shield-checkmark-outline"
                                        size={17}
                                        color="#93C5FD"
                                    />
                                    <Text style={styles.sheetItemText}>
                                        Marcar por revisar
                                    </Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        confirmVerificationStatusChange(
                                            selectedVm.id,
                                            "incomplete"
                                        );
                                    }}
                                    style={({ pressed }) => [
                                        styles.sheetItem,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="alert-circle-outline"
                                        size={17}
                                        color="#FDE68A"
                                    />
                                    <Text style={styles.sheetItemText}>
                                        Marcar incompleto
                                    </Text>
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
                                    style={({ pressed }) => [
                                        styles.sheetItem,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="ban-outline"
                                        size={17}
                                        color="#FCA5A5"
                                    />
                                    <Text style={styles.sheetItemText}>
                                        Marcar no apto
                                    </Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        void openAssignPicker(selectedVm.id);
                                    }}
                                    style={({ pressed }) => [
                                        styles.sheetItem,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="person-add-outline"
                                        size={17}
                                        color={COLORS.text}
                                    />
                                    <Text style={styles.sheetItemText}>
                                        Asignar a usuario
                                    </Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        startEdit(selectedVm);
                                    }}
                                    style={({ pressed }) => [
                                        styles.sheetItem,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="create-outline"
                                        size={17}
                                        color={COLORS.text}
                                    />
                                    <Text style={styles.sheetItemText}>Editar lead</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        if (!selectedVm) return;
                                        confirmDelete(selectedVm.id);
                                    }}
                                    style={({ pressed }) => [
                                        styles.sheetItem,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons
                                        name="trash-outline"
                                        size={17}
                                        color={COLORS.rejected}
                                    />
                                    <Text
                                        style={[
                                            styles.sheetItemText,
                                            { color: "#FCA5A5" },
                                        ]}
                                    >
                                        Eliminar lead
                                    </Text>
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
                                        <Text style={styles.modalTitle}>
                                            Editar lead Meta
                                        </Text>
                                        <Pressable
                                            onPress={cancelEdit}
                                            style={styles.modalClose}
                                        >
                                            <Ionicons
                                                name="close"
                                                size={18}
                                                color={COLORS.text}
                                            />
                                        </Pressable>
                                    </View>

                                    <ScrollView
                                        contentContainerStyle={{
                                            gap: 10,
                                            paddingBottom: 6,
                                        }}
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
                                            <Text style={styles.label}>
                                                Negocio original / bruto
                                            </Text>
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
                                            <Text style={styles.label}>Estado en cola</Text>
                                            <View style={styles.segmentRow}>
                                                {(
                                                    [
                                                        "pending_review",
                                                        "incomplete",
                                                        "not_suitable",
                                                    ] as Exclude<
                                                        VerificationStatus,
                                                        "verified"
                                                    >[]
                                                ).map((s) => {
                                                    const active = eVerificationStatus === s;
                                                    const label =
                                                        getVerificationStatusFilterLabel(s);

                                                    return (
                                                        <Pressable
                                                            key={s}
                                                            onPress={() =>
                                                                setEVerificationStatus(s)
                                                            }
                                                            style={({ pressed }) => [
                                                                styles.segmentPill,
                                                                active &&
                                                                styles.segmentPillActive,
                                                                pressed && styles.pressed,
                                                            ]}
                                                        >
                                                            <Text
                                                                style={[
                                                                    styles.segmentPillText,
                                                                    active &&
                                                                    styles.segmentPillTextActive,
                                                                ]}
                                                            >
                                                                {label}
                                                            </Text>
                                                        </Pressable>
                                                    );
                                                })}
                                            </View>
                                        </View>

                                        {eVerificationStatus === "not_suitable" ? (
                                            <View style={styles.field}>
                                                <Text style={styles.label}>
                                                    Motivo no apto *
                                                </Text>
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
                                                style={({ pressed }) => [
                                                    styles.ghostBtn,
                                                    pressed && styles.btnPressed,
                                                ]}
                                                disabled={eSaving}
                                            >
                                                <Ionicons
                                                    name="close-outline"
                                                    size={18}
                                                    color={COLORS.text}
                                                />
                                                <Text style={styles.ghostBtnText}>
                                                    Cancelar
                                                </Text>
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
                                                <Ionicons
                                                    name="save-outline"
                                                    size={18}
                                                    color="#fff"
                                                />
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

                    <Modal
                        visible={userPickerOpen}
                        transparent
                        animationType="fade"
                        onRequestClose={() => setUserPickerOpen(false)}
                    >
                        <View style={styles.inlineModalOverlay}>
                            <View style={styles.pickerWrap}>
                                <View style={styles.pickerCard}>
                                    <View style={styles.modalHeader}>
                                        <Text style={styles.modalTitle}>
                                            Asignar lead a
                                        </Text>
                                        <Pressable
                                            onPress={() => setUserPickerOpen(false)}
                                            style={styles.modalClose}
                                        >
                                            <Ionicons
                                                name="close"
                                                size={18}
                                                color={COLORS.text}
                                            />
                                        </Pressable>
                                    </View>

                                    <View style={styles.searchWrapModal}>
                                        <Ionicons
                                            name="search-outline"
                                            size={18}
                                            color={COLORS.muted}
                                        />
                                        <TextInput
                                            value={pickerQuery}
                                            onChangeText={setPickerQuery}
                                            placeholder="Buscar usuario…"
                                            placeholderTextColor={COLORS.muted}
                                            style={styles.searchInput}
                                        />
                                        {!!pickerQuery ? (
                                            <Pressable
                                                onPress={() => setPickerQuery("")}
                                                style={styles.clearBtn}
                                            >
                                                <Ionicons
                                                    name="close"
                                                    size={18}
                                                    color={COLORS.text}
                                                />
                                            </Pressable>
                                        ) : null}
                                    </View>

                                    <ScrollView
                                        contentContainerStyle={{
                                            gap: 10,
                                            paddingBottom: 6,
                                        }}
                                        showsVerticalScrollIndicator={false}
                                        keyboardShouldPersistTaps="handled"
                                    >
                                        {pickerUsers.map((u) => (
                                            <Pressable
                                                key={u.id}
                                                onPress={() => void onPickUser(u)}
                                                style={({ pressed }) => [
                                                    styles.userRow,
                                                    pressed && styles.userRowPressed,
                                                ]}
                                            >
                                                <View style={styles.userAvatar}>
                                                    <Ionicons
                                                        name="person-outline"
                                                        size={18}
                                                        color={COLORS.text}
                                                    />
                                                </View>

                                                <View style={{ flex: 1 }}>
                                                    <Text
                                                        style={styles.userName}
                                                        numberOfLines={1}
                                                    >
                                                        {u.name}
                                                    </Text>
                                                    <Text
                                                        style={styles.userEmail}
                                                        numberOfLines={1}
                                                    >
                                                        {u.email}
                                                    </Text>
                                                </View>

                                                <Ionicons
                                                    name="chevron-forward"
                                                    size={16}
                                                    color={COLORS.muted}
                                                />
                                            </Pressable>
                                        ))}

                                        {!pickerUsers.length ? (
                                            <View style={styles.emptySmall}>
                                                <Text style={styles.emptyText}>
                                                    No hay resultados.
                                                </Text>
                                            </View>
                                        ) : null}
                                    </ScrollView>
                                </View>
                            </View>
                        </View>
                    </Modal>

                    <AssignCoverageModal
                        open={coverageModalOpen}
                        onClose={() => setCoverageModalOpen(false)}
                        leads={activeQueueClients}
                        users={users}
                        onAssign={async (leadId: string, userId: string) => {
                            await updateClientFields(leadId, {
                                verificationStatus: "verified",
                                leadQuality: "valid",
                                notSuitableReason: "",
                                verifiedAt: Date.now(),
                                updatedAt: Date.now(),
                            } as any);

                            await assignClient(leadId, userId);
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

    headerHistoryBtn: {
        minWidth: 40,
        height: 40,
        borderRadius: 13,
        backgroundColor: "rgba(124,58,237,0.12)",
        borderWidth: 1,
        borderColor: "rgba(124,58,237,0.26)",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 9,
        flexDirection: "row",
        gap: 6,
    },
    headerHistoryBtnText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "900",
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
    searchWrapModal: {
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

    secondaryFilterWrap: {
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    secondaryFilterRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    secondaryFilterPill: {
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
    secondaryFilterPillActive: {
        backgroundColor: "rgba(37,99,235,0.10)",
        borderColor: "rgba(37,99,235,0.26)",
    },
    secondaryFilterPillText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    secondaryFilterPillTextActive: {
        color: "#DDEAFE",
    },
    secondaryFilterPillCount: {
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
    secondaryFilterPillCountActive: {
        backgroundColor: "rgba(37,99,235,0.22)",
        color: "#93C5FD",
    },

    listWrap: { flex: 1 },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 2,
    },

    footerFilterBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 12,
        paddingTop: 10,
        backgroundColor: "rgba(11,18,32,0.92)",
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.06)",
    },
    footerFilterInner: {
        flexDirection: "row",
        gap: 8,
    },
    footerFilterBtn: {
        flex: 1,
        minHeight: 68,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "#0F172A",
        paddingHorizontal: 8,
        paddingVertical: 10,
        justifyContent: "space-between",
    },
    footerFilterBtnActive: {
        backgroundColor: "rgba(37,99,235,0.16)",
        borderColor: "rgba(255,255,255,0.18)",
    },
    footerFilterTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    footerFilterCountWrap: {
        minWidth: 22,
        height: 22,
        borderRadius: 999,
        paddingHorizontal: 6,
        backgroundColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
    },
    footerFilterCountWrapActive: {
        backgroundColor: "rgba(255,255,255,0.16)",
    },
    footerFilterCount: {
        color: COLORS.soft,
        fontSize: 10,
        fontWeight: "900",
    },
    footerFilterCountActive: {
        color: COLORS.text,
    },
    footerFilterLabel: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "900",
        marginTop: 8,
    },
    footerFilterLabelActive: {
        color: COLORS.text,
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
    topLine: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    phone: {
        flex: 1,
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

    cityPill: {
        alignSelf: "flex-start",
        marginTop: 2,
        minHeight: 24,
        maxWidth: "92%",
        paddingHorizontal: 9,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.28)",
        backgroundColor: "rgba(37,99,235,0.12)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    cityPillOut: {
        borderColor: "rgba(251,191,36,0.28)",
        backgroundColor: "rgba(251,191,36,0.10)",
    },
    cityPillText: {
        color: "#93C5FD",
        fontSize: 11,
        fontWeight: "900",
        flexShrink: 1,
    },
    cityPillTextOut: {
        color: "#FDE68A",
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
    statusBoxBlue: {
        backgroundColor: "rgba(37,99,235,0.08)",
        borderColor: "rgba(37,99,235,0.22)",
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
    statusBoxTextBlue: { color: "#93C5FD" },
    statusBoxTextYellow: { color: "#FDE68A" },
    statusBoxTextRed: { color: "#FCA5A5" },

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

    newPillInline: {
        height: 20,
        paddingHorizontal: 7,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(34,197,94,0.14)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.32)",
    },
    newPillText: {
        color: "#86EFAC",
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0.3,
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
    emptySmall: {
        paddingVertical: 10,
        alignItems: "center",
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

    pickerWrap: { width: "100%" },
    pickerCard: {
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        maxHeight: "80%",
    },

    userRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: 16,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    userRowPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    userAvatar: {
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    userName: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    userEmail: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        marginTop: 2,
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