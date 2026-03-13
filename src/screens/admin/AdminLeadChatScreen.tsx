import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { onSnapshot } from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
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

import AdminBackground from "../../components/admin/AdminBackground";
import { docRef } from "../../data/firestore";
import { updateClientFields } from "../../data/repositories/clientsRepo";
import {
    subscribeClientMessages,
    type ClientMessageDoc,
} from "../../data/repositories/incomingLeadsRepo";
import type { ClientDoc } from "../../types/models";

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

export default function AdminLeadChatScreen() {
    const router = useRouter();
    const params = useLocalSearchParams<{
        clientId?: string;
        clientName?: string;
    }>();
    const insets = useSafeAreaInsets();
    const scrollRef = useRef<ScrollView>(null);

    const clientId = String(params.clientId ?? "").trim();
    const fallbackName = String(params.clientName ?? "").trim();

    const [client, setClient] = useState<ClientDoc | null>(null);
    const [messages, setMessages] = useState<ClientMessageDoc[]>([]);
    const [loadingClient, setLoadingClient] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [busyMode, setBusyMode] = useState(false);
    const [sending, setSending] = useState(false);
    const [draft, setDraft] = useState("");

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

                setClient({
                    id: snap.id,
                    ...(snap.data() as Omit<ClientDoc, "id">),
                });
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

        const unsub = subscribeClientMessages(clientId, (items) => {
            setMessages(items ?? []);
            setLoadingMessages(false);
        });

        return () => unsub?.();
    }, [clientId]);

    useEffect(() => {
        if (!messages.length) return;

        const t = setTimeout(() => {
            scrollRef.current?.scrollToEnd({ animated: true });
        }, 80);

        return () => clearTimeout(t);
    }, [messages]);

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

            await postAuthedJson("sendManualLeadMessage", {
                clientId,
                text,
                markHumanTakeover: true,
            });

            setDraft("");
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo enviar el mensaje.");
        } finally {
            setSending(false);
        }
    };

    const loading = loadingClient || loadingMessages;

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
            <AdminBackground>
                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                    <View style={styles.header}>
                        <Pressable
                            onPress={() => router.back()}
                            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
                        >
                            <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                        </Pressable>

                        <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.hTitle} numberOfLines={1}>
                                {title}
                            </Text>
                            <Text style={styles.hSub} numberOfLines={1}>
                                {subtitle}
                            </Text>
                        </View>

                        <Pressable
                            onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
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
                            <ScrollView
                                ref={scrollRef}
                                contentContainerStyle={[
                                    styles.messagesContent,
                                    { paddingBottom: Math.max(16, insets.bottom + 10) },
                                ]}
                                showsVerticalScrollIndicator={false}
                            >
                                {messages.map((item) => {
                                    const isInbound = item.direction === "inbound";
                                    const isBot = item.senderType === "bot";
                                    const isAdmin = item.senderType === "admin";

                                    return (
                                        <View
                                            key={item.id}
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
                                })}
                            </ScrollView>
                        )}
                    </View>

                    <View style={[styles.composerWrap, { paddingBottom: Math.max(12, insets.bottom + 8) }]}>
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
                                    : "Modo humano activo. Tus mensajes se enviarán por WhatsApp desde aquí."
                                : "El bot está activo. Pulsa “Tomar chat” para responder manualmente."}
                        </Text>
                    </View>
                </KeyboardAvoidingView>
            </AdminBackground>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    primary: "#2563EB",
};

const styles = StyleSheet.create({
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
    backBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
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
    messagesContent: {
        padding: 12,
        gap: 10,
    },

    bubbleWrap: {
        width: "100%",
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
});