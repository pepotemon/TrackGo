import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Linking,
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
import AdminBackground from "../../components/admin/AdminBackground";
import {
    assignClient,
    deleteClient,
    subscribeAdminClients,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import { subscribeIncomingLeadConversation } from "../../data/repositories/incomingLeadsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, IncomingLeadDoc, UserDoc } from "../../types/models";

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

type ConversationRow =
    | {
        id: string;
        kind: "customer";
        text: string;
        at: number;
        meta?: string;
    }
    | {
        id: string;
        kind: "bot";
        text: string;
        at: number;
        meta?: string;
    };

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

function getClientSourceLabel(c: ClientDoc) {
    const source = String((c as any)?.source ?? "manual").trim().toLowerCase();
    if (source === "whatsapp_meta") return "Meta / WhatsApp";
    return "Manual";
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
    return !!String(c.mapsUrl ?? "").trim();
}

function getMissingFields(c: ClientDoc) {
    const missing: string[] = [];

    if (!hasUsefulBusiness(c)) missing.push("negocio");
    if (!hasUsefulMaps(c)) missing.push("maps");

    return missing;
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

function isMetaUnassignedLead(c: ClientDoc) {
    const source = String((c as any)?.source ?? "").trim().toLowerCase();
    const assigned = String((c as any)?.assignedTo ?? "").trim();
    return source === "whatsapp_meta" && assigned.length === 0;
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
        if (!missing.length) return "Faltan datos por revisar";
        if (missing.length === 2) return "Faltan negocio y Maps";
        return `Falta ${missing[0]}`;
    }

    if (status === "verified") return "Lead validado";
    return "Listo para revisión";
}

function buildConversationRows(items: IncomingLeadDoc[]): ConversationRow[] {
    const rows: ConversationRow[] = [];

    for (const item of items) {
        const inboundText = String(item?.rawText ?? "").trim();
        const inboundAt = toMs(item?.createdAt);
        const botText = String(item?.botReplyText ?? "").trim();
        const botAt = toMs(item?.botReplyAt);
        const botStage = String(item?.botReplyStage ?? "").trim();
        const botStatus = String(item?.botReplyStatus ?? "").trim();
        const messageType = String(item?.messageType ?? "").trim();

        if (inboundText) {
            rows.push({
                id: `${item.id}_customer`,
                kind: "customer",
                text: inboundText,
                at: inboundAt,
                meta: messageType ? `Cliente · ${messageType}` : "Cliente",
            });
        }

        if (botText) {
            rows.push({
                id: `${item.id}_bot`,
                kind: "bot",
                text: botText,
                at: botAt || inboundAt,
                meta: botStage
                    ? `Bot · ${botStage}${botStatus ? ` · ${botStatus}` : ""}`
                    : botStatus
                        ? `Bot · ${botStatus}`
                        : "Bot",
            });
        }
    }

    return rows.sort((a, b) => a.at - b.at);
}

export default function AdminLeadQueueScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [q, setQ] = useState("");
    const [filter, setFilter] = useState<MetaFilterKey>("pending_review");
    const [busyId, setBusyId] = useState<string | null>(null);

    const [editOpen, setEditOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [eName, setEName] = useState("");
    const [eBusiness, setEBusiness] = useState("");
    const [eBusinessRaw, setEBusinessRaw] = useState("");
    const [ePhone, setEPhone] = useState("");
    const [eMapsUrl, setEMapsUrl] = useState("");
    const [eAddress, setEAddress] = useState("");
    const [eVerificationStatus, setEVerificationStatus] = useState<VerificationStatus>("pending_review");
    const [eNotSuitableReason, setENotSuitableReason] = useState("");
    const [eSaving, setESaving] = useState(false);

    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [pickerTargetClientId, setPickerTargetClientId] = useState<string | null>(null);

    const [conversationOpen, setConversationOpen] = useState(false);
    const [conversationClientId, setConversationClientId] = useState<string | null>(null);
    const [conversationClientName, setConversationClientName] = useState("");
    const [conversationItems, setConversationItems] = useState<IncomingLeadDoc[]>([]);
    const [conversationLoading, setConversationLoading] = useState(false);

    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);

    const reloadUsers = async () => {
        if (usersLoading) return;
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!conversationOpen || !conversationClientId) {
            setConversationItems([]);
            setConversationLoading(false);
            return;
        }

        setConversationLoading(true);

        const unsub = subscribeIncomingLeadConversation(conversationClientId, (items) => {
            setConversationItems(items ?? []);
            setConversationLoading(false);
        });

        return () => {
            unsub?.();
        };
    }, [conversationOpen, conversationClientId]);

    const metaUnassignedClients = useMemo(
        () => clients.filter(isMetaUnassignedLead),
        [clients]
    );

    const totals = useMemo(() => {
        let verified = 0;
        let pendingReview = 0;
        let incomplete = 0;
        let notSuitable = 0;

        for (const c of metaUnassignedClients) {
            const s = getDerivedVerificationStatus(c);
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
    }, [metaUnassignedClients]);

    const filteredClients = useMemo(() => {
        const qtText = q.trim().toLowerCase();
        const qtDigits = normalizePhone(q);

        return metaUnassignedClients
            .filter((c) => {
                const verification = getDerivedVerificationStatus(c);

                if (verification === "verified") return false;
                if (filter !== "all" && verification !== filter) return false;

                if (!qtText && !qtDigits) return true;

                if (qtDigits) {
                    const ph = normalizePhone(c.phone ?? "");
                    if (ph.includes(qtDigits)) return true;
                }

                if (qtText) {
                    const hay = `
                        ${safeText((c as any).name)}
                        ${safeText((c as any).business)}
                        ${safeText((c as any).businessRaw)}
                        ${safeText(c.address)}
                        ${safeText(c.mapsUrl)}
                        ${safeText(c.phone)}
                        ${safeText(getClientSourceLabel(c))}
                        ${safeText(getVerificationStatusLabel(verification))}
                        ${safeText(getNotSuitableReason(c))}
                        ${safeText(getQuickStatusText(c))}
                    `;
                    return hay.includes(qtText);
                }

                return true;
            })
            .sort((a, b) => {
                const aMs = toMs((a as any)?.updatedAt) || toMs((a as any)?.createdAt);
                const bMs = toMs((b as any)?.updatedAt) || toMs((b as any)?.createdAt);
                return bMs - aMs;
            });
    }, [metaUnassignedClients, q, filter]);

    const visibleTotal = useMemo(() => {
        return totals.pendingReview + totals.incomplete + totals.notSuitable;
    }, [totals]);

    const conversationRows = useMemo(() => buildConversationRows(conversationItems), [conversationItems]);

    const phoneExists = (phoneDigits: string, excludeId?: string | null) => {
        const p = normalizePhone(phoneDigits);
        if (!p) return false;
        return clients.some((c) => {
            if (excludeId && c.id === excludeId) return false;
            return normalizePhone(c.phone ?? "") === p;
        });
    };

    const openMaps = async (url?: string) => {
        const u = (url ?? "").trim();
        if (!u) return;
        try {
            await Linking.openURL(u);
        } catch {
            Alert.alert("Error", "No se pudo abrir el link.");
        }
    };

    const openWsp = async (phone?: string) => {
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
    };

    const openConversation = (client: ClientDoc) => {
        setConversationClientId(client.id);
        setConversationClientName(
            String((client as any)?.name ?? "").trim() ||
            String((client as any)?.phone ?? "").trim() ||
            "Lead"
        );
        setConversationItems([]);
        setConversationLoading(true);
        setConversationOpen(true);
    };

    const closeConversation = () => {
        setConversationOpen(false);
        setConversationClientId(null);
        setConversationClientName("");
        setConversationItems([]);
        setConversationLoading(false);
    };

    const confirmDelete = (id: string) => {
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
    };

    const openAssignPicker = async (clientId: string) => {
        if (!users.length && !usersLoading) await reloadUsers();
        setPickerTargetClientId(clientId);
        setPickerQuery("");
        setUserPickerOpen(true);
    };

    const onPickUser = async (u: UserDoc) => {
        const clientId = pickerTargetClientId;
        setUserPickerOpen(false);
        if (!clientId) return;

        Alert.alert(
            "Confirmar asignación",
            `¿Asignar este lead a ${u.name || u.email || "este usuario"}?\n\nAl asignarlo, pasará automáticamente a verificado.`,
            [
                { text: "Cancelar", style: "cancel", onPress: () => setPickerTargetClientId(null) },
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
    };

    const applyVerificationStatus = async (
        clientId: string,
        nextStatus: Exclude<VerificationStatus, "verified">,
        reason?: string
    ) => {
        try {
            setBusyId(clientId);

            const patch: any = {
                verificationStatus: nextStatus,
                updatedAt: Date.now(),
            };

            if (nextStatus === "not_suitable") {
                patch.leadQuality = "not_suitable";
                patch.notSuitableReason = reason?.trim() || "Perfil no apto";
            } else if (nextStatus === "pending_review") {
                patch.leadQuality = "review";
                patch.notSuitableReason = "";
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
    };

    const confirmVerificationStatusChange = (
        clientId: string,
        nextStatus: Exclude<VerificationStatus, "verified">,
        reason?: string
    ) => {
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
    };

    const startEdit = (c: ClientDoc) => {
        setEditingId(c.id);
        setEName(((c as any).name ?? "").toString());
        setEBusiness(((c as any).business ?? "").toString());
        setEBusinessRaw(((c as any).businessRaw ?? "").toString());
        setEPhone((c.phone ?? "").toString());
        setEMapsUrl((c.mapsUrl ?? "").toString());
        setEAddress((c.address ?? "").toString());

        const derivedStatus = getDerivedVerificationStatus(c);
        setEVerificationStatus(derivedStatus === "verified" ? "pending_review" : derivedStatus);
        setENotSuitableReason(getNotSuitableReason(c));
        setEditOpen(true);
    };

    const cancelEdit = () => {
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
    };

    const submitEdit = async () => {
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
    };

    const pickerUsers = useMemo(() => {
        const qt = pickerQuery.trim().toLowerCase();
        if (!qt) return users;

        return users.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, pickerQuery]);

    const modalBottomPad = Math.max(10, insets.bottom + 10);

    const FilterPill = ({
        k,
        label,
        value,
    }: {
        k: MetaFilterKey;
        label: string;
        value: number;
    }) => {
        const active = filter === k;
        return (
            <Pressable
                onPress={() => setFilter(k)}
                style={({ pressed }) => [
                    styles.filterPill,
                    active && styles.filterPillActive,
                    pressed && styles.pressed,
                ]}
            >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
                <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
                    <Text style={[styles.filterBadgeText, active && styles.filterBadgeTextActive]}>{value}</Text>
                </View>
            </Pressable>
        );
    };

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
            <AdminBackground>
                <View style={styles.header}>
                    <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
                        <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                    </Pressable>

                    <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.hTitle} numberOfLines={1}>
                            Leads Meta
                        </Text>
                        <Text style={styles.hSub} numberOfLines={1}>
                            Cola activa · T <Text style={styles.hStrong}>{visibleTotal}</Text>
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
                        <Ionicons name={usersLoading ? "sync" : "people-outline"} size={18} color={COLORS.text} />
                    </Pressable>
                </View>

                <View style={styles.summaryRow}>
                    <View style={[styles.summaryBadge, styles.summaryBadgeBlue]}>
                        <Ionicons name="shield-checkmark-outline" size={13} color="#93C5FD" />
                        <Text style={[styles.summaryBadgeText, styles.summaryBadgeTextBlue]}>
                            {totals.pendingReview}
                        </Text>
                    </View>

                    <View style={[styles.summaryBadge, styles.summaryBadgeYellow]}>
                        <Ionicons name="alert-circle-outline" size={13} color="#FDE68A" />
                        <Text style={[styles.summaryBadgeText, styles.summaryBadgeTextYellow]}>
                            {totals.incomplete}
                        </Text>
                    </View>

                    <View style={[styles.summaryBadge, styles.summaryBadgeRed]}>
                        <Ionicons name="close-circle-outline" size={13} color="#FCA5A5" />
                        <Text style={[styles.summaryBadgeText, styles.summaryBadgeTextRed]}>
                            {totals.notSuitable}
                        </Text>
                    </View>
                </View>

                <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                    <TextInput
                        value={q}
                        onChangeText={setQ}
                        placeholder="Buscar lead"
                        placeholderTextColor={COLORS.muted}
                        style={styles.searchInput}
                    />
                    {!!q ? (
                        <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    ) : null}
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
                    <FilterPill k="pending_review" label="Por revisar" value={totals.pendingReview} />
                    <FilterPill k="incomplete" label="Incompletos" value={totals.incomplete} />
                    <FilterPill k="not_suitable" label="No aptos" value={totals.notSuitable} />
                    <FilterPill k="all" label="Todos" value={visibleTotal} />
                </ScrollView>

                <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                    {filteredClients.map((c) => {
                        const name = ((c as any).name ?? "").trim();
                        const subtitle = getPrimarySubtitle(c);
                        const verificationStatus = getDerivedVerificationStatus(c);
                        const verificationLabel = getVerificationStatusLabel(verificationStatus);
                        const sourceLabel = getClientSourceLabel(c);
                        const createdAt = toMs((c as any)?.createdAt);
                        const lastInboundAt = toMs((c as any)?.lastInboundMessageAt);
                        const isBusy = busyId === c.id;
                        const lastInboundText = String((c as any)?.lastInboundText ?? "").trim();
                        const notSuitableReason = getNotSuitableReason(c);
                        const quickStatus = getQuickStatusText(c);

                        return (
                            <View key={c.id} style={styles.card}>
                                <View style={styles.cardTop}>
                                    <View style={{ flex: 1, gap: 6 }}>
                                        <Text style={styles.phone} numberOfLines={1}>
                                            {c.phone}
                                        </Text>

                                        {!!name ? (
                                            <Text style={styles.metaPrimary} numberOfLines={1}>
                                                {name}
                                            </Text>
                                        ) : null}

                                        {!!subtitle ? (
                                            <Text style={styles.meta} numberOfLines={1}>
                                                {subtitle}
                                            </Text>
                                        ) : null}

                                        <View style={styles.infoBadgeRow}>
                                            <View style={[styles.infoBadge, styles.infoBadgeBlue]}>
                                                <Ionicons name="logo-whatsapp" size={12} color={COLORS.text} />
                                                <Text style={styles.infoBadgeText}>{sourceLabel}</Text>
                                            </View>

                                            <View
                                                style={[
                                                    styles.infoBadge,
                                                    verificationStatus === "pending_review"
                                                        ? styles.infoBadgeBlue
                                                        : verificationStatus === "not_suitable"
                                                            ? styles.infoBadgeRed
                                                            : styles.infoBadgeYellow,
                                                ]}
                                            >
                                                <Ionicons
                                                    name={
                                                        verificationStatus === "pending_review"
                                                            ? "shield-checkmark-outline"
                                                            : verificationStatus === "not_suitable"
                                                                ? "close-circle-outline"
                                                                : "alert-circle-outline"
                                                    }
                                                    size={12}
                                                    color={COLORS.text}
                                                />
                                                <Text style={styles.infoBadgeText}>{verificationLabel}</Text>
                                            </View>
                                        </View>

                                        <View
                                            style={[
                                                styles.statusBox,
                                                verificationStatus === "pending_review"
                                                    ? styles.statusBoxBlue
                                                    : verificationStatus === "not_suitable"
                                                        ? styles.statusBoxRed
                                                        : styles.statusBoxYellow,
                                            ]}
                                        >
                                            <Ionicons
                                                name={
                                                    verificationStatus === "pending_review"
                                                        ? "search-outline"
                                                        : verificationStatus === "not_suitable"
                                                            ? "ban-outline"
                                                            : "warning-outline"
                                                }
                                                size={15}
                                                color={
                                                    verificationStatus === "pending_review"
                                                        ? "#93C5FD"
                                                        : verificationStatus === "not_suitable"
                                                            ? "#FCA5A5"
                                                            : "#FDE68A"
                                                }
                                            />
                                            <Text
                                                style={[
                                                    styles.statusBoxText,
                                                    verificationStatus === "pending_review"
                                                        ? styles.statusBoxTextBlue
                                                        : verificationStatus === "not_suitable"
                                                            ? styles.statusBoxTextRed
                                                            : styles.statusBoxTextYellow,
                                                ]}
                                            >
                                                {quickStatus}
                                            </Text>
                                        </View>

                                        {verificationStatus === "not_suitable" && !!notSuitableReason ? (
                                            <View style={styles.reasonRow}>
                                                <Ionicons name="information-circle-outline" size={14} color={COLORS.muted} />
                                                <Text style={styles.reasonText}>{notSuitableReason}</Text>
                                            </View>
                                        ) : null}
                                    </View>
                                </View>

                                {!!c.address ? (
                                    <View style={styles.infoRow}>
                                        <Ionicons name="location-outline" size={16} color={COLORS.muted} />
                                        <Text style={styles.infoText} numberOfLines={2}>
                                            {c.address}
                                        </Text>
                                    </View>
                                ) : null}

                                <View style={styles.assignedRow}>
                                    <Ionicons name="time-outline" size={16} color={COLORS.muted} />
                                    <Text style={styles.assignedText} numberOfLines={1}>
                                        Creado: {formatDateLabel(createdAt)} · Último: {formatDateLabel(lastInboundAt || createdAt)}
                                    </Text>
                                </View>

                                {lastInboundText ? (
                                    <Pressable
                                        onPress={() => openConversation(c)}
                                        style={({ pressed }) => [
                                            styles.inboundBox,
                                            pressed && styles.pressed,
                                        ]}
                                    >
                                        <View style={styles.inboundHeader}>
                                            <Ionicons name="chatbubble-ellipses-outline" size={14} color={COLORS.muted} />
                                            <Text style={styles.inboundTitle}>Último mensaje recibido</Text>
                                            <View style={styles.inboundOpenPill}>
                                                <Text style={styles.inboundOpenPillText}>Abrir</Text>
                                            </View>
                                        </View>

                                        <Text style={styles.inboundText} numberOfLines={3}>
                                            {lastInboundText}
                                        </Text>
                                    </Pressable>
                                ) : null}

                                <View style={styles.quickRow}>
                                    <Pressable
                                        onPress={() => confirmVerificationStatusChange(c.id, "pending_review")}
                                        disabled={isBusy}
                                        style={({ pressed }) => [
                                            styles.quickBtn,
                                            styles.quickBtnBlue,
                                            pressed && styles.pressed,
                                            isBusy && styles.btnDisabled,
                                        ]}
                                    >
                                        <Ionicons name="shield-checkmark-outline" size={16} color="#93C5FD" />
                                        <Text style={[styles.quickBtnText, styles.quickBtnTextBlue]}>Revisar</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={() => confirmVerificationStatusChange(c.id, "incomplete")}
                                        disabled={isBusy}
                                        style={({ pressed }) => [
                                            styles.quickBtn,
                                            styles.quickBtnYellow,
                                            pressed && styles.pressed,
                                            isBusy && styles.btnDisabled,
                                        ]}
                                    >
                                        <Ionicons name="alert-circle-outline" size={16} color="#FDE68A" />
                                        <Text style={[styles.quickBtnText, styles.quickBtnTextYellow]}>Incompleto</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={() =>
                                            confirmVerificationStatusChange(
                                                c.id,
                                                "not_suitable",
                                                getNotSuitableReason(c) || "Perfil no apto"
                                            )
                                        }
                                        disabled={isBusy}
                                        style={({ pressed }) => [
                                            styles.quickBtn,
                                            styles.quickBtnRed,
                                            pressed && styles.pressed,
                                            isBusy && styles.btnDisabled,
                                        ]}
                                    >
                                        <Ionicons name="close-outline" size={16} color="#FCA5A5" />
                                        <Text style={[styles.quickBtnText, styles.quickBtnTextRed]}>No apto</Text>
                                    </Pressable>
                                </View>

                                <View style={styles.actionsRow}>
                                    <Pressable onPress={() => openMaps(c.mapsUrl)} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
                                        <Ionicons name="map-outline" size={18} color={COLORS.text} />
                                    </Pressable>

                                    <Pressable onPress={() => openWsp((c as any).waId || c.phone)} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
                                        <Ionicons name="logo-whatsapp" size={18} color={COLORS.text} />
                                    </Pressable>

                                    <Pressable
                                        onPress={() => openAssignPicker(c.id)}
                                        disabled={isBusy}
                                        style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed, isBusy && styles.iconBtnDisabled]}
                                    >
                                        <Ionicons name="person-add-outline" size={18} color={COLORS.text} />
                                    </Pressable>

                                    <Pressable
                                        onPress={() => startEdit(c)}
                                        disabled={isBusy}
                                        style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed, isBusy && styles.iconBtnDisabled]}
                                    >
                                        <Ionicons name="create-outline" size={18} color={COLORS.text} />
                                    </Pressable>

                                    <Pressable
                                        onPress={() => confirmDelete(c.id)}
                                        disabled={isBusy}
                                        style={({ pressed }) => [styles.iconBtn, styles.iconBtnDanger, pressed && styles.iconBtnPressed, isBusy && styles.iconBtnDisabled]}
                                    >
                                        <Ionicons name="trash-outline" size={18} color={COLORS.rejected} />
                                    </Pressable>
                                </View>

                                {isBusy ? <Text style={styles.busyText}>Procesando…</Text> : null}
                            </View>
                        );
                    })}

                    {!filteredClients.length ? (
                        <View style={styles.empty}>
                            <Ionicons name="file-tray-outline" size={24} color={COLORS.muted} />
                            <Text style={styles.emptyText}>
                                {q.trim() ? "No hay resultados." : "No hay leads Meta pendientes en la cola."}
                            </Text>
                        </View>
                    ) : null}
                </ScrollView>

                <Modal visible={editOpen} transparent animationType="fade" onRequestClose={cancelEdit}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                            <View style={[styles.modalCardBig, { paddingBottom: 14 + modalBottomPad }]}>
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>Editar lead Meta</Text>
                                    <Pressable onPress={cancelEdit} style={styles.modalClose}>
                                        <Ionicons name="close" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>
                                <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                    <View style={styles.grid2}>
                                        <View style={[styles.field, { flex: 1 }]}>
                                            <Text style={styles.label}>Nombre</Text>
                                            <TextInput value={eName} onChangeText={setEName} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                        </View>

                                        <View style={[styles.field, { flex: 1 }]}>
                                            <Text style={styles.label}>Negocio</Text>
                                            <TextInput value={eBusiness} onChangeText={setEBusiness} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                        </View>
                                    </View>

                                    <View style={styles.field}>
                                        <Text style={styles.label}>Negocio original / bruto</Text>
                                        <TextInput value={eBusinessRaw} onChangeText={setEBusinessRaw} placeholder="Texto original del cliente" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>

                                    <View style={styles.grid2}>
                                        <View style={[styles.field, { flex: 1 }]}>
                                            <Text style={styles.label}>Teléfono *</Text>
                                            <TextInput value={ePhone} onChangeText={setEPhone} keyboardType="phone-pad" placeholder="+55 91 954 23 232" placeholderTextColor={COLORS.muted} style={styles.input} />
                                        </View>

                                        <View style={[styles.field, { flex: 1 }]}>
                                            <Text style={styles.label}>Dirección</Text>
                                            <TextInput value={eAddress} onChangeText={setEAddress} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
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
                                            {(["pending_review", "incomplete", "not_suitable"] as Exclude<VerificationStatus, "verified">[]).map((s) => {
                                                const active = eVerificationStatus === s;
                                                const label = getVerificationStatusFilterLabel(s);

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
                                        <Pressable onPress={cancelEdit} style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed]} disabled={eSaving}>
                                            <Ionicons name="close-outline" size={18} color={COLORS.text} />
                                            <Text style={styles.ghostBtnText}>Cancelar</Text>
                                        </Pressable>

                                        <Pressable
                                            onPress={submitEdit}
                                            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, eSaving && styles.btnDisabled]}
                                            disabled={eSaving}
                                        >
                                            <Ionicons name="save-outline" size={18} color="#fff" />
                                            <Text style={styles.primaryBtnText}>{eSaving ? "Guardando..." : "Guardar"}</Text>
                                        </Pressable>
                                    </View>
                                </ScrollView>
                            </View>
                        </KeyboardAvoidingView>
                    </View>
                </Modal>

                <Modal visible={userPickerOpen} transparent animationType="fade" onRequestClose={() => setUserPickerOpen(false)}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.pickerWrap}>
                            <View style={styles.pickerCard}>
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>Asignar lead a</Text>
                                    <Pressable onPress={() => setUserPickerOpen(false)} style={styles.modalClose}>
                                        <Ionicons name="close" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <View style={styles.searchWrapModal}>
                                    <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                                    <TextInput value={pickerQuery} onChangeText={setPickerQuery} placeholder="Buscar…" placeholderTextColor={COLORS.muted} style={styles.searchInput} />
                                    {!!pickerQuery ? (
                                        <Pressable onPress={() => setPickerQuery("")} style={styles.clearBtn}>
                                            <Ionicons name="close" size={18} color={COLORS.text} />
                                        </Pressable>
                                    ) : null}
                                </View>

                                <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                    {pickerUsers.map((u) => (
                                        <Pressable key={u.id} onPress={() => onPickUser(u)} style={({ pressed }) => [styles.userRow, pressed && styles.userRowPressed]}>
                                            <View style={styles.userAvatar}>
                                                <Ionicons name="person-outline" size={18} color={COLORS.text} />
                                            </View>

                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.userName} numberOfLines={1}>{u.name}</Text>
                                                <Text style={styles.userEmail} numberOfLines={1}>{u.email}</Text>
                                            </View>

                                            <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
                                        </Pressable>
                                    ))}

                                    {!pickerUsers.length ? (
                                        <View style={styles.emptySmall}>
                                            <Text style={styles.emptyText}>No hay resultados.</Text>
                                        </View>
                                    ) : null}
                                </ScrollView>
                            </View>
                        </View>
                    </View>
                </Modal>

                <Modal visible={conversationOpen} transparent animationType="fade" onRequestClose={closeConversation}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                            <View style={[styles.modalCardBig, { paddingBottom: 14 + modalBottomPad }]}>
                                <View style={styles.modalHeader}>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text style={styles.modalTitle} numberOfLines={1}>
                                            Conversación
                                        </Text>
                                        <Text style={styles.modalSub} numberOfLines={1}>
                                            {conversationClientName || "Lead"}
                                        </Text>
                                    </View>

                                    <Pressable onPress={closeConversation} style={styles.modalClose}>
                                        <Ionicons name="close" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <ScrollView contentContainerStyle={styles.conversationList} showsVerticalScrollIndicator={false}>
                                    {conversationLoading ? (
                                        <View style={styles.emptySmall}>
                                            <Text style={styles.emptyText}>Cargando conversación…</Text>
                                        </View>
                                    ) : conversationRows.length ? (
                                        conversationRows.map((row) => (
                                            <View
                                                key={row.id}
                                                style={[
                                                    styles.chatBubbleWrap,
                                                    row.kind === "customer"
                                                        ? styles.chatBubbleWrapLeft
                                                        : styles.chatBubbleWrapRight,
                                                ]}
                                            >
                                                <View
                                                    style={[
                                                        styles.chatBubble,
                                                        row.kind === "customer"
                                                            ? styles.chatBubbleCustomer
                                                            : styles.chatBubbleBot,
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.chatMeta,
                                                            row.kind === "customer"
                                                                ? styles.chatMetaCustomer
                                                                : styles.chatMetaBot,
                                                        ]}
                                                    >
                                                        {row.meta || (row.kind === "customer" ? "Cliente" : "Bot")} · {formatDateTimeLabel(row.at)}
                                                    </Text>

                                                    <Text style={styles.chatText}>{row.text}</Text>
                                                </View>
                                            </View>
                                        ))
                                    ) : (
                                        <View style={styles.emptySmall}>
                                            <Text style={styles.emptyText}>No hay historial guardado para este lead.</Text>
                                        </View>
                                    )}
                                </ScrollView>
                            </View>
                        </KeyboardAvoidingView>
                    </View>
                </Modal>
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

    rejected: "#F87171",
    primary: "#2563EB",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

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
    hTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
    hSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    hStrong: { color: COLORS.text, fontWeight: "900" },
    headerBadge: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    headerBadgeDisabled: { opacity: 0.55 },

    summaryRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    summaryBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        borderWidth: 1,
    },
    summaryBadgeText: {
        fontSize: 11,
        fontWeight: "900",
    },
    summaryBadgeBlue: {
        backgroundColor: "rgba(37,99,235,0.12)",
        borderColor: "rgba(37,99,235,0.26)",
    },
    summaryBadgeTextBlue: { color: "#93C5FD" },
    summaryBadgeYellow: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.24)",
    },
    summaryBadgeTextYellow: { color: "#FDE68A" },
    summaryBadgeRed: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.24)",
    },
    summaryBadgeTextRed: { color: "#FCA5A5" },

    searchWrap: {
        marginHorizontal: 16,
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
    searchInput: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "700" },
    clearBtn: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    filtersRow: { paddingHorizontal: 16, gap: 10, paddingBottom: 10 },
    filterPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 38,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    filterPillActive: {
        backgroundColor: "rgba(37,99,235,0.16)",
        borderColor: "rgba(37,99,235,0.35)",
    },
    filterText: { color: COLORS.muted, fontWeight: "900", fontSize: 12 },
    filterTextActive: { color: COLORS.text },

    filterBadge: {
        minWidth: 28,
        height: 24,
        borderRadius: 999,
        paddingHorizontal: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    filterBadgeActive: {
        backgroundColor: "rgba(37,99,235,0.25)",
        borderColor: "rgba(37,99,235,0.35)",
    },
    filterBadgeText: { color: COLORS.muted, fontWeight: "900", fontSize: 12 },
    filterBadgeTextActive: { color: COLORS.text },

    listContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 10,
    },
    cardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
    },
    phone: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    metaPrimary: { color: "#D7DCE5", fontSize: 13, fontWeight: "900" },
    meta: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    infoBadgeRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        marginTop: 2,
    },
    infoBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 26,
        paddingHorizontal: 9,
        borderRadius: 999,
        borderWidth: 1,
    },
    infoBadgeText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "900",
    },
    infoBadgeBlue: {
        backgroundColor: "rgba(37,99,235,0.12)",
        borderColor: "rgba(37,99,235,0.26)",
    },
    infoBadgeYellow: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.24)",
    },
    infoBadgeRed: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.24)",
    },

    statusBox: {
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
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

    reasonRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    reasonText: {
        flex: 1,
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },

    infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    infoText: { flex: 1, color: COLORS.text, opacity: 0.9, fontSize: 12, fontWeight: "700" },

    assignedRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
    assignedText: { flex: 1, color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    inboundBox: {
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        gap: 6,
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
        lineHeight: 18,
    },
    inboundOpenPill: {
        paddingHorizontal: 8,
        height: 22,
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

    quickRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    quickBtn: {
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 6,
    },
    quickBtnText: {
        fontSize: 12,
        fontWeight: "900",
    },
    quickBtnBlue: {
        backgroundColor: "rgba(37,99,235,0.10)",
        borderColor: "rgba(37,99,235,0.24)",
    },
    quickBtnTextBlue: { color: "#93C5FD" },
    quickBtnYellow: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.24)",
    },
    quickBtnTextYellow: { color: "#FDE68A" },
    quickBtnRed: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.24)",
    },
    quickBtnTextRed: { color: "#FCA5A5" },

    actionsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        justifyContent: "flex-end",
    },
    iconBtn: {
        width: 44,
        height: 44,
        borderRadius: 16,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    iconBtnDanger: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.30)",
    },
    iconBtnPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },
    iconBtnDisabled: { opacity: 0.5 },

    busyText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },

    empty: { marginTop: 40, alignItems: "center", gap: 10, paddingHorizontal: 16 },
    emptySmall: { paddingVertical: 10, alignItems: "center" },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900", textAlign: "center" },

    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 12, justifyContent: "center" },
    modalWrap: { width: "100%" },
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
    modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
    modalSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
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
    userName: { color: COLORS.text, fontSize: 13, fontWeight: "900" },
    userEmail: { color: COLORS.muted, fontSize: 12, fontWeight: "800", marginTop: 2 },

    field: { gap: 6 },
    label: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
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
    grid2: { flexDirection: "row", gap: 10 },

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
    ghostBtnText: { color: COLORS.text, fontWeight: "900", fontSize: 14 },
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
    primaryBtnText: { color: "#fff", fontWeight: "900", fontSize: 14 },
    btnPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    btnDisabled: { opacity: 0.55 },

    conversationList: {
        gap: 10,
        paddingBottom: 6,
    },
    chatBubbleWrap: {
        width: "100%",
    },
    chatBubbleWrapLeft: {
        alignItems: "flex-start",
    },
    chatBubbleWrapRight: {
        alignItems: "flex-end",
    },
    chatBubble: {
        maxWidth: "88%",
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        gap: 6,
    },
    chatBubbleCustomer: {
        backgroundColor: "#0F172A",
        borderColor: "rgba(255,255,255,0.10)",
    },
    chatBubbleBot: {
        backgroundColor: "rgba(37,99,235,0.10)",
        borderColor: "rgba(37,99,235,0.26)",
    },
    chatMeta: {
        fontSize: 10,
        fontWeight: "900",
    },
    chatMetaCustomer: {
        color: COLORS.muted,
    },
    chatMetaBot: {
        color: "#93C5FD",
    },
    chatText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 19,
    },
});