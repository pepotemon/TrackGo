import { Ionicons } from "@expo/vector-icons";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { onSnapshot } from "firebase/firestore";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
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
import { docRef } from "../../data/firestore";
import {
    assignClient,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import {
    subscribeClientMessages,
    type ClientMessageDoc,
} from "../../data/repositories/incomingLeadsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, UserDoc } from "../../types/models";

type VerificationStatus =
    | "verified"
    | "pending_review"
    | "incomplete"
    | "not_suitable";

type ActionSheetState = {
    open: boolean;
};

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    primary: "#2563EB",
};

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

function normalizePhone(raw?: string | null) {
    return String(raw ?? "").replace(/\D+/g, "");
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

function formatDateTimeLabel(ms?: number) {
    if (!ms || !Number.isFinite(ms)) return "—";

    const d = new Date(ms);
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const month = months[d.getMonth()];
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");

    return `${day} ${month} · ${hh}:${mm}`;
}

function getChatModeLabel(mode?: string | null) {
    const v = String(mode ?? "bot").trim().toLowerCase();
    if (v === "human") return "Humano";
    if (v === "hybrid") return "Híbrido";
    return "Bot";
}

function getVerificationLabel(client?: ClientDoc | null) {
    const raw = String((client as any)?.verificationStatus ?? "").trim().toLowerCase();
    if (raw === "verified") return "Verificado";
    if (raw === "pending_review") return "Por revisar";
    if (raw === "not_suitable") return "No apto";
    return "Incompleto";
}

function getClientDisplayName(client?: ClientDoc | null, fallback?: string) {
    const a = String((client as any)?.name ?? "").trim();
    const b = String((client as any)?.phone ?? "").trim();
    return a || fallback || b || "Lead";
}

function getClientSubtitle(client?: ClientDoc | null) {
    const business = String((client as any)?.business ?? "").trim();
    const businessRaw = String((client as any)?.businessRaw ?? "").trim();
    return business || businessRaw || "Sin negocio definido";
}

function getBubbleMeta(item: ClientMessageDoc) {
    const senderType = String(item.senderType ?? "").trim().toLowerCase();
    const stage = String(item.stage ?? "").trim();
    const source = String(item.source ?? "").trim();

    let title = "Mensaje";

    if (senderType === "client") title = "Cliente";
    else if (senderType === "bot") title = "Bot";
    else if (senderType === "admin") title = "Admin";

    if (stage) return `${title} · ${stage}`;
    if (source) return `${title} · ${source}`;
    return title;
}

function getFunctionsBaseUrl() {
    const app = getApp();
    const projectId = app?.options?.projectId;
    if (!projectId) {
        throw new Error("missing_project_id");
    }
    return `https://us-central1-${projectId}.cloudfunctions.net`;
}

async function postAuthedJson(path: string, body: Record<string, any>) {
    const auth = getAuth(getApp());
    const currentUser = auth.currentUser;

    if (!currentUser) {
        throw new Error("not_authenticated");
    }

    const token = await currentUser.getIdToken();
    const baseUrl = getFunctionsBaseUrl();

    const res = await fetch(`${baseUrl}/${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.ok === false) {
        throw new Error(String(json?.error || `request_failed_${res.status}`));
    }

    return json;
}

function getNotSuitableReason(client?: ClientDoc | null) {
    return String((client as any)?.notSuitableReason ?? "").trim();
}

function MessageBubble({ item }: { item: ClientMessageDoc }) {
    const isInbound = item.direction === "inbound";
    const isBot = item.senderType === "bot";
    const isAdmin = item.senderType === "admin";

    return (
        <View
            style={[
                styles.bubbleWrap,
                isInbound ? styles.bubbleWrapLeft : styles.bubbleWrapRight,
            ]}
        >
            <View
                style={[
                    styles.bubble,
                    isInbound
                        ? styles.bubbleClient
                        : isBot
                            ? styles.bubbleBot
                            : styles.bubbleAdmin,
                ]}
            >
                <Text
                    style={[
                        styles.bubbleMeta,
                        isInbound
                            ? styles.bubbleMetaClient
                            : isBot
                                ? styles.bubbleMetaBot
                                : styles.bubbleMetaAdmin,
                    ]}
                >
                    {getBubbleMeta(item)} · {formatDateTimeLabel(toMs(item.createdAt))}
                </Text>

                <Text style={styles.bubbleText}>{item.text}</Text>
            </View>
        </View>
    );
}

export default function AdminLeadChatScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{
        clientId?: string;
        clientName?: string;
    }>();
    const insets = useSafeAreaInsets();

    const clientId = String(params.clientId ?? "").trim();
    const fallbackName = String(params.clientName ?? "").trim();

    const [client, setClient] = useState<ClientDoc | null>(null);
    const [messages, setMessages] = useState<ClientMessageDoc[]>([]);
    const [loadingClient, setLoadingClient] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [busyMode, setBusyMode] = useState(false);
    const [sending, setSending] = useState(false);
    const [draft, setDraft] = useState("");

    const [actionSheet, setActionSheet] = useState<ActionSheetState>({ open: false });

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [assignOpen, setAssignOpen] = useState(false);

    const [editOpen, setEditOpen] = useState(false);
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

    const listRef = useRef<any>(null);
    const lastChatModeRef = useRef("bot");
    const autoResumingRef = useRef(false);

    const initialScrollDoneRef = useRef(false);
    const isNearBottomRef = useRef(true);
    const lastRenderedMessageIdRef = useRef<string | null>(null);
    const forceScrollAfterSendRef = useRef(false);

    useEffect(() => {
        if (!clientId) {
            setClient(null);
            setLoadingClient(false);
            return;
        }

        const unsub = onSnapshot(
            docRef.client(clientId),
            (snap) => {
                if (!snap.exists()) {
                    setClient(null);
                    setLoadingClient(false);
                    return;
                }

                const next = {
                    id: snap.id,
                    ...(snap.data() as Omit<ClientDoc, "id">),
                } as ClientDoc;

                setClient(next);
                lastChatModeRef.current = String((next as any)?.chatMode ?? "bot").trim().toLowerCase();
                setLoadingClient(false);
            },
            () => {
                setClient(null);
                setLoadingClient(false);
            }
        );

        return () => unsub();
    }, [clientId]);

    useEffect(() => {
        if (!clientId) {
            setMessages([]);
            setLoadingMessages(false);
            return;
        }

        setLoadingMessages(true);
        initialScrollDoneRef.current = false;
        lastRenderedMessageIdRef.current = null;
        isNearBottomRef.current = true;

        const unsub = subscribeClientMessages(
            clientId,
            (items) => {
                setMessages(items ?? []);
                setLoadingMessages(false);
            },
            { limitCount: 400 }
        );

        return () => unsub?.();
    }, [clientId]);

    useEffect(() => {
        if (!messages.length) return;

        const lastMessage = messages[messages.length - 1];
        const lastId = lastMessage?.id ?? null;
        const changedLastMessage = lastId !== lastRenderedMessageIdRef.current;

        if (!initialScrollDoneRef.current) {
            initialScrollDoneRef.current = true;
            lastRenderedMessageIdRef.current = lastId;

            const t = setTimeout(() => {
                listRef.current?.scrollToEnd({ animated: false });
            }, 40);

            return () => clearTimeout(t);
        }

        if (!changedLastMessage) return;

        lastRenderedMessageIdRef.current = lastId;

        if (forceScrollAfterSendRef.current || isNearBottomRef.current) {
            forceScrollAfterSendRef.current = false;

            const t = setTimeout(() => {
                listRef.current?.scrollToEnd({ animated: true });
            }, 40);

            return () => clearTimeout(t);
        }
    }, [messages]);

    useEffect(() => {
        if (!clientId) return;
        if (loadingClient || loadingMessages) return;

        const lastInboundFromMessages = messages
            .filter((m) => String(m.direction ?? "").trim().toLowerCase() === "inbound")
            .reduce((max, item) => {
                const created = toMs(item.createdAt);
                return created > max ? created : max;
            }, 0);

        const lastInboundFromClient = toMs((client as any)?.lastInboundMessageAt);
        const lastInboundAt = Math.max(lastInboundFromMessages, lastInboundFromClient);
        const seenAt = toMs((client as any)?.adminQueueLastSeenMessageAt);

        if (!lastInboundAt) return;
        if (seenAt >= lastInboundAt) return;

        void updateClientFields(clientId, {
            adminQueueLastSeenMessageAt: lastInboundAt,
            adminQueueSeenAt: Date.now(),
            updatedAt: Date.now(),
        } as any);
    }, [clientId, client, messages, loadingClient, loadingMessages]);

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

    const autoReturnBotIfNeeded = useCallback(async () => {
        if (!clientId) return;
        if (autoResumingRef.current) return;

        const mode = lastChatModeRef.current;
        if (mode !== "human") return;

        try {
            autoResumingRef.current = true;
            await postAuthedJson("resumeBotLead", { clientId });
        } catch {
        } finally {
            autoResumingRef.current = false;
        }
    }, [clientId]);

    useFocusEffect(
        useCallback(() => {
            return () => {
                void autoReturnBotIfNeeded();
            };
        }, [autoReturnBotIfNeeded])
    );

    const title = useMemo(
        () => getClientDisplayName(client, fallbackName),
        [client, fallbackName]
    );

    const subtitle = useMemo(
        () => getClientSubtitle(client),
        [client]
    );

    const chatMode = String((client as any)?.chatMode ?? "bot").trim().toLowerCase();
    const verificationLabel = getVerificationLabel(client);
    const phoneLabel = String((client as any)?.phone ?? "").trim();
    const lastInboundText = String((client as any)?.lastInboundText ?? "").trim();

    const setChatMode = async (nextMode: "bot" | "human") => {
        if (!clientId) return;

        try {
            setBusyMode(true);

            const auth = getAuth(getApp());
            const uid = String(auth.currentUser?.uid || "").trim();
            if (!uid) {
                throw new Error("not_authenticated");
            }

            const now = Date.now();

            if (nextMode === "human") {
                const patch: any = {
                    chatMode: "human",
                    botPausedAt: now,
                    botPausedBy: uid,
                    humanTakeoverAt: now,
                    humanTakeoverBy: uid,
                    updatedAt: now,
                };

                await updateClientFields(clientId, patch);
            } else {
                await postAuthedJson("resumeBotLead", {
                    clientId,
                });
            }
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo cambiar el modo del chat.");
        } finally {
            setBusyMode(false);
        }
    };

    const onPressSend = async () => {
        const text = draft.trim();
        if (!text || !clientId) return;

        try {
            setSending(true);
            forceScrollAfterSendRef.current = true;

            await postAuthedJson("sendManualLeadMessage", {
                clientId,
                text,
                markHumanTakeover: true,
            });

            setDraft("");
        } catch (e: any) {
            forceScrollAfterSendRef.current = false;
            Alert.alert("Error", e?.message ?? "No se pudo enviar el mensaje.");
        } finally {
            setSending(false);
        }
    };

    const closeActionSheet = useCallback(() => {
        setActionSheet({ open: false });
    }, []);

    const confirmVerificationStatusChange = useCallback((
        nextStatus: Exclude<VerificationStatus, "verified">,
        reason?: string
    ) => {
        closeActionSheet();

        const titleText =
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

        Alert.alert(titleText, description, [
            { text: "Cancelar", style: "cancel" },
            {
                text: "Confirmar",
                onPress: async () => {
                    if (!clientId) return;
                    try {
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
                    }
                },
            },
        ]);
    }, [clientId, closeActionSheet]);

    const startEdit = useCallback(() => {
        closeActionSheet();
        if (!client) return;

        setEName(String((client as any)?.name ?? ""));
        setEBusiness(String((client as any)?.business ?? ""));
        setEBusinessRaw(String((client as any)?.businessRaw ?? ""));
        setEPhone(String(client.phone ?? ""));
        setEMapsUrl(String(client.mapsUrl ?? ""));
        setEAddress(String(client.address ?? ""));
        const derived = String((client as any)?.verificationStatus ?? "pending_review").trim().toLowerCase();
        setEVerificationStatus(
            derived === "verified"
                ? "pending_review"
                : (derived as VerificationStatus)
        );
        setENotSuitableReason(getNotSuitableReason(client));
        setEditOpen(true);
    }, [client, closeActionSheet]);

    const cancelEdit = useCallback(() => {
        setEditOpen(false);
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
        if (!clientId) return;

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
                notSuitableReason: eVerificationStatus === "not_suitable" ? cleanNotSuitableReason : "",
                leadQuality:
                    eVerificationStatus === "not_suitable"
                        ? "not_suitable"
                        : "review",
                verifiedAt: null,
            };

            await updateClientFields(clientId, cleanUndefined(patch) as any);
            cancelEdit();
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo guardar");
        } finally {
            setESaving(false);
        }
    }, [
        clientId,
        eName,
        eBusiness,
        eBusinessRaw,
        ePhone,
        eMapsUrl,
        eAddress,
        eNotSuitableReason,
        eVerificationStatus,
        cancelEdit,
    ]);

    const loading = loadingClient || loadingMessages;

    const renderMessage = useCallback<ListRenderItem<ClientMessageDoc>>(
        ({ item }) => <MessageBubble item={item} />,
        []
    );

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
            <AdminBackground>
                <KeyboardAvoidingView
                    style={styles.flex}
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
                >
                    <View style={styles.header}>
                        <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.hTitle} numberOfLines={1}>
                                {title}
                            </Text>
                            <Text style={styles.hSub} numberOfLines={1}>
                                {subtitle}
                            </Text>
                        </View>

                        <Pressable
                            onPress={() => setActionSheet({ open: true })}
                            style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                        >
                            <Ionicons name="chevron-down-outline" size={18} color={COLORS.text} />
                        </Pressable>
                    </View>

                    <View style={styles.infoPanel}>
                        <View style={styles.badgesRow}>
                            <View style={[styles.infoBadge, styles.infoBadgeBlue]}>
                                <Ionicons name="chatbubble-ellipses-outline" size={12} color={COLORS.text} />
                                <Text style={styles.infoBadgeText}>Modo: {getChatModeLabel(chatMode)}</Text>
                            </View>

                            <View style={[styles.infoBadge, styles.infoBadgeYellow]}>
                                <Ionicons name="shield-checkmark-outline" size={12} color={COLORS.text} />
                                <Text style={styles.infoBadgeText}>{verificationLabel}</Text>
                            </View>
                        </View>

                        {!!phoneLabel ? (
                            <Text style={styles.metaLine} numberOfLines={1}>
                                {phoneLabel}
                            </Text>
                        ) : null}

                        {!!lastInboundText ? (
                            <Text style={styles.lastInboundPreview} numberOfLines={2}>
                                Último inbound: {lastInboundText}
                            </Text>
                        ) : null}

                        <View style={styles.modeActionsRow}>
                            <Pressable
                                onPress={() => setChatMode("human")}
                                disabled={busyMode || sending || chatMode === "human"}
                                style={({ pressed }) => [
                                    styles.modeBtn,
                                    styles.modeBtnHuman,
                                    pressed && styles.pressed,
                                    (busyMode || sending || chatMode === "human") && styles.btnDisabled,
                                ]}
                            >
                                <Ionicons name="hand-left-outline" size={16} color="#93C5FD" />
                                <Text style={[styles.modeBtnText, styles.modeBtnTextHuman]}>
                                    Tomar chat
                                </Text>
                            </Pressable>

                            <Pressable
                                onPress={() => setChatMode("bot")}
                                disabled={busyMode || sending || chatMode === "bot"}
                                style={({ pressed }) => [
                                    styles.modeBtn,
                                    styles.modeBtnBot,
                                    pressed && styles.pressed,
                                    (busyMode || sending || chatMode === "bot") && styles.btnDisabled,
                                ]}
                            >
                                <Ionicons name="hardware-chip-outline" size={16} color="#86EFAC" />
                                <Text style={[styles.modeBtnText, styles.modeBtnTextBot]}>
                                    Devolver al bot
                                </Text>
                            </Pressable>
                        </View>
                    </View>

                    <View style={styles.chatWrap}>
                        {loading ? (
                            <View style={styles.centerEmpty}>
                                <Text style={styles.emptyText}>Cargando conversación…</Text>
                            </View>
                        ) : !messages.length ? (
                            <View style={styles.centerEmpty}>
                                <Ionicons name="chatbubble-outline" size={24} color={COLORS.muted} />
                                <Text style={styles.emptyText}>No hay mensajes guardados todavía.</Text>
                            </View>
                        ) : (
                            <FlashList
                                ref={listRef}
                                data={messages}
                                renderItem={renderMessage}
                                keyExtractor={(item) => item.id}

                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                                contentContainerStyle={{
                                    padding: 12,
                                    paddingBottom: 14,
                                }}
                                onScroll={(e) => {
                                    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                                    const distanceFromBottom =
                                        contentSize.height - (contentOffset.y + layoutMeasurement.height);
                                    isNearBottomRef.current = distanceFromBottom <= 90;
                                }}
                                scrollEventThrottle={16}
                            />
                        )}
                    </View>

                    <View
                        style={[
                            styles.composerWrap,
                            { paddingBottom: Math.max(12, insets.bottom + 8) },
                        ]}
                    >
                        <View style={styles.composerCard}>
                            <TextInput
                                value={draft}
                                onChangeText={setDraft}
                                placeholder={
                                    chatMode === "human"
                                        ? "Escribe una respuesta manual…"
                                        : "Toma el chat para responder manualmente…"
                                }
                                placeholderTextColor={COLORS.muted}
                                style={styles.composerInput}
                                multiline
                                editable={chatMode === "human" && !sending}
                                textAlignVertical="top"
                            />

                            <Pressable
                                onPress={onPressSend}
                                disabled={chatMode !== "human" || !draft.trim() || sending}
                                style={({ pressed }) => [
                                    styles.sendBtn,
                                    pressed && styles.pressed,
                                    (chatMode !== "human" || !draft.trim() || sending) && styles.btnDisabled,
                                ]}
                            >
                                <Ionicons name={sending ? "hourglass-outline" : "send"} size={18} color="#fff" />
                            </Pressable>
                        </View>

                        <Text style={styles.composerHint}>
                            {chatMode === "human"
                                ? sending
                                    ? "Enviando mensaje manual…"
                                    : "Modo humano activo. Si sales de esta pantalla, el bot retomará el control automáticamente."
                                : "El bot está activo. Pulsa “Tomar chat” para responder manualmente."}
                        </Text>
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

                                <Text style={styles.sheetTitle}>{title}</Text>
                                <Text style={styles.sheetSubtitle} numberOfLines={1}>
                                    {subtitle}
                                </Text>

                                <Pressable
                                    onPress={() => confirmVerificationStatusChange("pending_review")}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="shield-checkmark-outline" size={17} color="#93C5FD" />
                                    <Text style={styles.sheetItemText}>Marcar por revisar</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => confirmVerificationStatusChange("incomplete")}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="alert-circle-outline" size={17} color="#FDE68A" />
                                    <Text style={styles.sheetItemText}>Marcar incompleto</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() =>
                                        confirmVerificationStatusChange(
                                            "not_suitable",
                                            getNotSuitableReason(client) || "Perfil no apto"
                                        )
                                    }
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="ban-outline" size={17} color="#FCA5A5" />
                                    <Text style={styles.sheetItemText}>Marcar no apto</Text>
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
                                    onPress={startEdit}
                                    style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="create-outline" size={17} color={COLORS.text} />
                                    <Text style={styles.sheetItemText}>Editar lead</Text>
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
                                        <Text style={styles.modalTitle}>Editar lead</Text>
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
                        entityId={clientId}
                        entityType="lead"
                        entityTitle={title}
                        entitySubtitle={subtitle}
                        users={users}
                        currentAssignedUserId={client?.assignedTo ?? null}
                        loadingUsers={usersLoading}
                        busy={false}
                        onAssign={async (entityId, userId) => {
                            try {
                                await updateClientFields(entityId, {
                                    verificationStatus: "verified",
                                    leadQuality: "valid",
                                    notSuitableReason: "",
                                    verifiedAt: Date.now(),
                                    updatedAt: Date.now(),
                                } as any);

                                await assignClient(entityId, userId);
                                router.back();
                            } catch (e: any) {
                                Alert.alert("Error", e?.message ?? "No se pudo asignar");
                            }
                        }}
                    />
                </KeyboardAvoidingView>
            </AdminBackground>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: COLORS.bg },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    btnDisabled: { opacity: 0.5 },

    header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    headerBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    hTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
    hSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    infoPanel: {
        marginHorizontal: 16,
        marginBottom: 10,
        padding: 14,
        borderRadius: 18,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        gap: 10,
    },
    badgesRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    infoBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 26,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
    },
    infoBadgeBlue: {
        backgroundColor: "rgba(37,99,235,0.12)",
        borderColor: "rgba(37,99,235,0.26)",
    },
    infoBadgeYellow: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.24)",
    },
    infoBadgeText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "900",
    },
    metaLine: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "800",
    },
    lastInboundPreview: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 18,
    },

    modeActionsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },
    modeBtn: {
        minHeight: 40,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    modeBtnHuman: {
        backgroundColor: "rgba(37,99,235,0.10)",
        borderColor: "rgba(37,99,235,0.26)",
    },
    modeBtnBot: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.26)",
    },
    modeBtnText: {
        fontSize: 12,
        fontWeight: "900",
    },
    modeBtnTextHuman: { color: "#93C5FD" },
    modeBtnTextBot: { color: "#86EFAC" },

    chatWrap: {
        flex: 1,
        marginHorizontal: 16,
        marginBottom: 10,
        borderRadius: 18,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        overflow: "hidden",
    },
    centerEmpty: {
        flex: 1,
        minHeight: 220,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        paddingHorizontal: 16,
    },
    emptyText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "900",
        textAlign: "center",
    },

    bubbleWrap: {
        width: "100%",
        marginBottom: 10,
    },
    bubbleWrapLeft: {
        alignItems: "flex-start",
    },
    bubbleWrapRight: {
        alignItems: "flex-end",
    },
    bubble: {
        maxWidth: "88%",
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        gap: 6,
    },
    bubbleClient: {
        backgroundColor: "#0F172A",
        borderColor: "rgba(255,255,255,0.10)",
    },
    bubbleBot: {
        backgroundColor: "rgba(37,99,235,0.10)",
        borderColor: "rgba(37,99,235,0.26)",
    },
    bubbleAdmin: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.26)",
    },
    bubbleMeta: {
        fontSize: 10,
        fontWeight: "900",
    },
    bubbleMetaClient: {
        color: COLORS.muted,
    },
    bubbleMetaBot: {
        color: "#93C5FD",
    },
    bubbleMetaAdmin: {
        color: "#86EFAC",
    },
    bubbleText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 19,
    },

    composerWrap: {
        paddingHorizontal: 16,
        paddingTop: 4,
    },
    composerCard: {
        minHeight: 62,
        borderRadius: 18,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 10,
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 10,
    },
    composerInput: {
        flex: 1,
        maxHeight: 120,
        minHeight: 40,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
        paddingTop: 8,
        paddingBottom: 8,
    },
    sendBtn: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: COLORS.primary,
        alignItems: "center",
        justifyContent: "center",
    },
    composerHint: {
        marginTop: 8,
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
        lineHeight: 16,
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
});