import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import AdminAssignModal from "../../components/admin/AdminAssignModal";
import AdminBackground from "../../components/admin/AdminBackground";

import {
    assignClient,
    deleteClient,
    subscribeAdminClients,
    subscribeUserClients,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import { dayKeyFromMs } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, UserDoc } from "../../types/models";

type VerificationStatus =
    | "verified"
    | "pending_review"
    | "incomplete"
    | "not_suitable";

type RangeKey = "today" | "7d" | "30d" | "90d";
type RealStatus = "pending" | "visited" | "rejected";

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

function safeStatus(value?: string | null): RealStatus {
    if (value === "visited") return "visited";
    if (value === "rejected") return "rejected";
    return "pending";
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

function formatStatusDateLabel(ms?: number) {
    if (!ms || !Number.isFinite(ms)) return undefined;

    const d = new Date(ms);
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const targetStart = new Date(d);
    targetStart.setHours(0, 0, 0, 0);

    if (targetStart.getTime() === todayStart.getTime()) return "Hoy";
    if (targetStart.getTime() === yesterdayStart.getTime()) return "Ayer";

    const day = String(d.getDate()).padStart(2, "0");
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const month = months[d.getMonth()];
    const year = d.getFullYear();

    return `${day} ${month} ${year}`;
}

function formatRangeLabel(key: RangeKey) {
    if (key === "today") return "Hoy";
    if (key === "7d") return "7 días";
    if (key === "30d") return "30 días";
    return "90 días";
}

function isUnassignedClient(c: ClientDoc) {
    const assigned = ((c.assignedTo ?? "") as any).toString().trim();
    return assigned.length === 0;
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

function getClientParseStatusLabel(c: ClientDoc) {
    const s = getClientParseStatus(c);
    if (s === "ready") return "Completo";
    if (s === "partial") return "Parcial";
    return "Vacío";
}

function getVerificationStatus(c: ClientDoc): VerificationStatus {
    const raw = String((c as any)?.verificationStatus ?? "").trim().toLowerCase();

    if (raw === "verified") return "verified";
    if (raw === "not_suitable") return "not_suitable";
    if (raw === "pending_review") return "pending_review";
    return "incomplete";
}

function getVerificationStatusLabel(c: ClientDoc) {
    const s = getVerificationStatus(c);
    if (s === "verified") return "Verificado";
    if (s === "pending_review") return "Por revisar";
    if (s === "not_suitable") return "No apto";
    return "Incompleto";
}

function getNotSuitableReason(c: ClientDoc) {
    return String((c as any)?.notSuitableReason ?? "").trim();
}

function getBusinessRaw(c: ClientDoc) {
    return String((c as any)?.businessRaw ?? "").trim();
}

function getVisitedLikeDateMs(c: ClientDoc) {
    return (
        toMs((c as any)?.statusAt) ||
        toMs((c as any)?.visitedAt) ||
        toMs((c as any)?.updatedAt) ||
        toMs((c as any)?.assignedAt) ||
        toMs((c as any)?.createdAt)
    );
}

export default function AdminUserClientsVisitedHistoryScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ userId?: string }>();
    const userId = (params?.userId ?? "").toString().trim();
    const isUnassignedView = userId === "UNASSIGNED";

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [q, setQ] = useState("");
    const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
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
    const [eAssigneeId, setEAssigneeId] = useState<string | null>(null);
    const [eSaving, setESaving] = useState(false);

    const [assignOpen, setAssignOpen] = useState(false);
    const [assignClientId, setAssignClientId] = useState<string | null>(null);

    const [menuOpen, setMenuOpen] = useState(false);
    const [menuClientId, setMenuClientId] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) {
            setClients([]);
            return;
        }

        if (isUnassignedView) {
            const unsub = subscribeAdminClients((list) => {
                const all = Array.isArray(list) ? list : [];
                setClients(
                    all.filter((c) => String((c.assignedTo ?? "") as any).trim().length === 0)
                );
            });
            return () => unsub();
        }

        const unsub = subscribeUserClients(userId, (list) => {
            setClients(Array.isArray(list) ? list : []);
        });

        return () => unsub();
    }, [userId, isUnassignedView]);

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

    const userById = useMemo(() => {
        const m = new Map<string, UserDoc>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);

    const user = useMemo(() => {
        if (isUnassignedView) return null;
        return users.find((u) => u.id === userId) ?? null;
    }, [users, userId, isUnassignedView]);

    const visitedClients = useMemo(() => {
        return clients.filter((c) => safeStatus((c as any)?.status) === "visited");
    }, [clients]);

    const filteredClients = useMemo(() => {
        const qtText = q.trim().toLowerCase();
        const qtDigits = normalizePhone(q);

        return visitedClients
            .filter((c) => {
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
                        ${safeText(getClientParseStatusLabel(c))}
                        ${safeText(getVerificationStatusLabel(c))}
                        ${safeText(getNotSuitableReason(c))}
                    `;
                    return hay.includes(qtText);
                }

                return true;
            })
            .slice()
            .sort((a, b) => getVisitedLikeDateMs(b) - getVisitedLikeDateMs(a));
    }, [visitedClients, q]);

    const menuClient = useMemo(() => {
        if (!menuClientId) return null;
        return clients.find((c) => c.id === menuClientId) ?? null;
    }, [clients, menuClientId]);

    const assignClientDoc = useMemo(() => {
        if (!assignClientId) return null;
        return clients.find((c) => c.id === assignClientId) ?? null;
    }, [clients, assignClientId]);

    const title = isUnassignedView ? "Visitados sin asignar" : user?.name?.trim() || "Visitados";
    const subtitle = `${formatRangeLabel(rangeKey)} · ${filteredClients.length}`;

    const modalBottomPad = Math.max(10, insets.bottom + 10);

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

        const msg = "Olá! Estou entrando em contato sobre a visita 🙌";
        const url = waLink(p, msg);

        try {
            await Linking.openURL(url);
        } catch {
            Alert.alert("Error", "No se pudo abrir WhatsApp.");
        }
    };

    const openAssignPicker = async (clientId: string) => {
        if (!users.length && !usersLoading) await reloadUsers();
        setAssignClientId(clientId);
        setAssignOpen(true);
    };

    const closeAssign = () => {
        setAssignOpen(false);
        setAssignClientId(null);
    };

    const clearAssign = async (clientId: string) => {
        try {
            setBusyId(clientId);
            await assignClient(clientId, "" as any);
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo desasignar");
        } finally {
            setBusyId(null);
        }
    };

    const confirmDelete = (id: string) => {
        Alert.alert("Eliminar cliente", "¿Seguro que quieres eliminar este cliente?", [
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

    const startEdit = async (c: ClientDoc) => {
        if (!users.length && !usersLoading) await reloadUsers();

        setEditingId(c.id);
        setEName(((c as any).name ?? "").toString());
        setEBusiness(((c as any).business ?? "").toString());
        setEBusinessRaw(((c as any).businessRaw ?? "").toString());
        setEPhone((c.phone ?? "").toString());
        setEMapsUrl((c.mapsUrl ?? "").toString());
        setEAddress((c.address ?? "").toString());
        setEVerificationStatus(getVerificationStatus(c));
        setENotSuitableReason(getNotSuitableReason(c));

        const a = ((c.assignedTo ?? "") as any).toString().trim();
        setEAssigneeId(a ? a : null);

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
        setEAssigneeId(null);
    };

    const phoneExists = (phoneDigits: string, excludeId?: string | null) => {
        const p = normalizePhone(phoneDigits);
        if (!p) return false;
        return clients.some((c) => {
            if (excludeId && c.id === excludeId) return false;
            return normalizePhone(c.phone ?? "") === p;
        });
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

            const patch: any = {
                phone: cleanPhone,
                mapsUrl: cleanMaps,
                updatedAt: now,
                name: cleanName ? cleanName : "",
                business: cleanBusiness ? cleanBusiness : "",
                businessRaw: cleanBusinessRaw ? cleanBusinessRaw : cleanBusiness ? cleanBusiness : "",
                address: cleanAddress ? cleanAddress : "",
                waId: cleanPhone,
                lat,
                lng,
                verificationStatus: eVerificationStatus,
                notSuitableReason: eVerificationStatus === "not_suitable" ? cleanNotSuitableReason : "",
                leadQuality:
                    eVerificationStatus === "verified"
                        ? "valid"
                        : eVerificationStatus === "not_suitable"
                            ? "not_suitable"
                            : "review",
                profileType:
                    eVerificationStatus === "not_suitable"
                        ? (((clients.find((x) => x.id === editingId) as any)?.profileType ?? "business").toString() || "business")
                        : "business",
                currentLeadMapsConfirmedAt: now,
                parseStatus: cleanBusiness && cleanMaps ? "ready" : "partial",
            };

            if (eVerificationStatus === "verified") {
                patch.verifiedAt = now;
            }

            const ass = (eAssigneeId ?? "").toString().trim();

            if (ass) {
                patch.assignedTo = ass;
                patch.assignedAt = now;
                patch.assignedDayKey = dayKeyFromMs(now);
            } else {
                patch.assignedTo = "";
                patch.assignedAt = 0;
                patch.assignedDayKey = "";
            }

            await updateClientFields(editingId, cleanUndefined(patch) as any);
            cancelEdit();
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo guardar");
        } finally {
            setESaving(false);
        }
    };

    const openMenu = (clientId: string) => {
        setMenuClientId(clientId);
        setMenuOpen(true);
    };

    const closeMenu = () => {
        setMenuOpen(false);
        setMenuClientId(null);
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
                            {title}
                        </Text>
                        <Text style={styles.hSub} numberOfLines={1}>
                            {subtitle}
                        </Text>
                    </View>

                    <Pressable
                        onPress={reloadUsers}
                        style={({ pressed }) => [styles.headerBadge, pressed && styles.pressed, usersLoading && styles.headerBadgeDisabled]}
                        disabled={usersLoading}
                        accessibilityLabel="Refrescar usuarios"
                    >
                        <Ionicons name={usersLoading ? "sync" : "people-outline"} size={18} color={COLORS.text} />
                    </Pressable>
                </View>

                <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                    <TextInput
                        value={q}
                        onChangeText={setQ}
                        placeholder="Buscar por nombre o número"
                        placeholderTextColor={COLORS.muted}
                        style={styles.searchInput}
                    />
                    {!!q ? (
                        <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    ) : null}
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rangeRow}>
                    {(["today", "7d", "30d", "90d"] as RangeKey[]).map((k) => {
                        const active = rangeKey === k;
                        return (
                            <Pressable
                                key={k}
                                onPress={() => setRangeKey(k)}
                                style={({ pressed }) => [
                                    styles.rangePill,
                                    active && styles.rangePillActive,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={[styles.rangePillText, active && styles.rangePillTextActive]}>
                                    {formatRangeLabel(k)}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>

                <View style={styles.banner}>
                    <View style={styles.bannerDot} />
                    <Text style={styles.bannerText}>
                        Historial visitados · {filteredClients.length}
                    </Text>
                </View>

                <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                    {filteredClients.map((c) => {
                        const name = ((c as any).name ?? "").trim();
                        const biz = ((c as any).business ?? "").trim();
                        const bizRaw = getBusinessRaw(c);
                        const isBusy = busyId === c.id;

                        const visitedAt = getVisitedLikeDateMs(c);

                        const assignedLabel = (() => {
                            const a = ((c.assignedTo ?? "") as any).toString().trim();
                            if (!a) return "Sin asignar";
                            const u = userById.get(a);
                            if (!u) return "Asignado";
                            return (u.name ?? "").trim() || (u.email ?? "").trim() || "Usuario";
                        })();

                        const sourceLabel = getClientSourceLabel(c);
                        const parseLabel = getClientParseStatusLabel(c);
                        const verificationLabel = getVerificationStatusLabel(c);
                        const notSuitableReason = getNotSuitableReason(c);

                        const lastInboundAt = toMs((c as any)?.lastInboundMessageAt);
                        const lastInboundText = String((c as any)?.lastInboundText ?? "").trim();

                        const verificationStatus = getVerificationStatus(c);
                        const parseStatus = getClientParseStatus(c);

                        return (
                            <View key={c.id} style={styles.card}>
                                <View style={styles.cardTop}>
                                    <View style={styles.cardHeadLeft}>
                                        <Text style={styles.phone} numberOfLines={1}>
                                            {name || c.phone}
                                        </Text>

                                        {!!name ? (
                                            <Text style={styles.meta} numberOfLines={1}>
                                                {c.phone}
                                            </Text>
                                        ) : null}

                                        {!!biz ? (
                                            <Text style={styles.metaStrong} numberOfLines={1}>
                                                {biz}
                                            </Text>
                                        ) : null}

                                        {!!bizRaw && bizRaw !== biz ? (
                                            <Text style={styles.metaSoft} numberOfLines={1}>
                                                Original: {bizRaw}
                                            </Text>
                                        ) : null}
                                    </View>

                                    <Pressable
                                        onPress={() => openMenu(c.id)}
                                        disabled={isBusy}
                                        style={({ pressed }) => [styles.menuBtn, pressed && styles.pressed, isBusy && styles.iconBtnDisabled]}
                                    >
                                        <Ionicons name="ellipsis-horizontal" size={16} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <View style={styles.topBadgesRow}>
                                    <View style={[styles.pill, styles.pillVisited]}>
                                        <Text style={[styles.pillText, styles.pillTextVisited]} numberOfLines={1}>
                                            visitado
                                        </Text>
                                    </View>

                                    {visitedAt > 0 ? (
                                        <View style={[styles.datePill, styles.datePillVisited]}>
                                            <Text style={[styles.datePillText, styles.datePillTextVisited]} numberOfLines={1}>
                                                {formatStatusDateLabel(visitedAt)}
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>

                                <View style={styles.infoBadgeRow}>
                                    <View
                                        style={[
                                            styles.infoBadge,
                                            String((c as any)?.source ?? "").toLowerCase() === "whatsapp_meta"
                                                ? styles.infoBadgeBlue
                                                : styles.infoBadgeNeutral,
                                        ]}
                                    >
                                        <Ionicons
                                            name={
                                                String((c as any)?.source ?? "").toLowerCase() === "whatsapp_meta"
                                                    ? "logo-whatsapp"
                                                    : "create-outline"
                                            }
                                            size={12}
                                            color={COLORS.text}
                                        />
                                        <Text style={styles.infoBadgeText}>{sourceLabel}</Text>
                                    </View>

                                    <View
                                        style={[
                                            styles.infoBadge,
                                            parseStatus === "ready"
                                                ? styles.infoBadgeGreen
                                                : parseStatus === "partial"
                                                    ? styles.infoBadgeYellow
                                                    : styles.infoBadgeNeutral,
                                        ]}
                                    >
                                        <Ionicons name="document-text-outline" size={12} color={COLORS.text} />
                                        <Text style={styles.infoBadgeText}>{parseLabel}</Text>
                                    </View>

                                    <View
                                        style={[
                                            styles.infoBadge,
                                            verificationStatus === "verified"
                                                ? styles.infoBadgeGreen
                                                : verificationStatus === "pending_review"
                                                    ? styles.infoBadgeBlue
                                                    : verificationStatus === "not_suitable"
                                                        ? styles.infoBadgeRed
                                                        : styles.infoBadgeYellow,
                                        ]}
                                    >
                                        <Ionicons
                                            name={
                                                verificationStatus === "verified"
                                                    ? "checkmark-done-outline"
                                                    : verificationStatus === "not_suitable"
                                                        ? "close-circle-outline"
                                                        : verificationStatus === "pending_review"
                                                            ? "shield-checkmark-outline"
                                                            : "alert-circle-outline"
                                            }
                                            size={12}
                                            color={COLORS.text}
                                        />
                                        <Text style={styles.infoBadgeText}>{verificationLabel}</Text>
                                    </View>
                                </View>

                                {!!c.address ? (
                                    <View style={styles.infoRow}>
                                        <Ionicons name="location-outline" size={15} color={COLORS.muted} />
                                        <Text style={styles.infoText} numberOfLines={2}>
                                            {c.address}
                                        </Text>
                                    </View>
                                ) : null}

                                <View style={styles.assignedRow}>
                                    <Ionicons
                                        name={isUnassignedClient(c) ? "person-remove-outline" : "person-outline"}
                                        size={15}
                                        color={COLORS.muted}
                                    />
                                    <Text style={styles.assignedText} numberOfLines={1}>
                                        {assignedLabel}
                                    </Text>
                                </View>

                                {verificationStatus === "not_suitable" ? (
                                    <View style={styles.notSuitableTag}>
                                        <Ionicons name="ban-outline" size={14} color={COLORS.rejected} />
                                        <Text style={styles.notSuitableTagText}>
                                            {notSuitableReason || "Perfil no apto"}
                                        </Text>
                                    </View>
                                ) : null}

                                {lastInboundAt > 0 ? (
                                    <View style={styles.inboundBox}>
                                        <View style={styles.inboundHeader}>
                                            <Ionicons name="chatbubble-ellipses-outline" size={14} color={COLORS.muted} />
                                            <Text style={styles.inboundTitle}>
                                                Último mensaje · {formatStatusDateLabel(lastInboundAt) ?? "—"}
                                            </Text>
                                        </View>

                                        {!!lastInboundText ? (
                                            <Text style={styles.inboundText} numberOfLines={3}>
                                                {lastInboundText}
                                            </Text>
                                        ) : (
                                            <Text style={styles.inboundTextMuted}>
                                                Sin texto guardado.
                                            </Text>
                                        )}
                                    </View>
                                ) : null}

                                <View style={styles.actionsRow}>
                                    <Pressable
                                        onPress={() => openMaps(c.mapsUrl)}
                                        style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                                    >
                                        <Ionicons name="map-outline" size={18} color={COLORS.text} />
                                    </Pressable>

                                    <Pressable
                                        onPress={() => openWsp((c as any).waId || c.phone)}
                                        style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                                    >
                                        <Ionicons name="logo-whatsapp" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                {isBusy ? <Text style={styles.busyText}>Procesando…</Text> : null}
                            </View>
                        );
                    })}

                    {!filteredClients.length ? (
                        <View style={styles.empty}>
                            <Ionicons name="checkmark-done-outline" size={24} color={COLORS.muted} />
                            <Text style={styles.emptyText}>
                                {q.trim()
                                    ? "No hay resultados."
                                    : "No hay clientes con estado visitado para este usuario."}
                            </Text>
                        </View>
                    ) : null}
                </ScrollView>

                <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
                    <View style={styles.sheetOverlay}>
                        <Pressable style={StyleSheet.absoluteFillObject} onPress={closeMenu} />
                        <View style={styles.sheetWrap}>
                            <View style={styles.sheetHandle} />

                            <Text style={styles.sheetTitle}>
                                {((menuClient as any)?.name ?? "").toString().trim() || menuClient?.phone || "Opciones"}
                            </Text>

                            {!!((menuClient as any)?.business ?? "").toString().trim() ? (
                                <Text style={styles.sheetSubtitle} numberOfLines={1}>
                                    {((menuClient as any)?.business ?? "").toString().trim()}
                                </Text>
                            ) : null}

                            <Pressable
                                onPress={async () => {
                                    const cid = menuClientId;
                                    closeMenu();
                                    if (!cid) return;
                                    await openAssignPicker(cid);
                                }}
                                style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                            >
                                <Ionicons name="person-add-outline" size={17} color={COLORS.text} />
                                <Text style={styles.sheetItemText}>Reasignar</Text>
                            </Pressable>

                            <Pressable
                                onPress={async () => {
                                    const c = menuClient;
                                    closeMenu();
                                    if (!c) return;
                                    await startEdit(c);
                                }}
                                style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                            >
                                <Ionicons name="create-outline" size={17} color={COLORS.text} />
                                <Text style={styles.sheetItemText}>Editar cliente</Text>
                            </Pressable>

                            <Pressable
                                onPress={async () => {
                                    const cid = menuClientId;
                                    closeMenu();
                                    if (!cid) return;
                                    await clearAssign(cid);
                                }}
                                style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                            >
                                <Ionicons name="remove-circle-outline" size={17} color={COLORS.text} />
                                <Text style={styles.sheetItemText}>Quitar asignación</Text>
                            </Pressable>

                            <Pressable
                                onPress={() => {
                                    const cid = menuClientId;
                                    closeMenu();
                                    if (!cid) return;
                                    confirmDelete(cid);
                                }}
                                style={({ pressed }) => [styles.sheetItem, pressed && styles.pressed]}
                            >
                                <Ionicons name="trash-outline" size={17} color={COLORS.rejected} />
                                <Text style={[styles.sheetItemText, { color: "#FCA5A5" }]}>
                                    Eliminar cliente
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </Modal>

                <Modal visible={editOpen} transparent animationType="fade" onRequestClose={cancelEdit}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                            <View style={[styles.modalCardBig, { paddingBottom: 14 + modalBottomPad }]}>
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>Editar</Text>
                                    <Pressable onPress={cancelEdit} style={styles.modalClose}>
                                        <Ionicons name="close" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
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
                                        <Text style={styles.label}>Clasificación manual</Text>
                                        <View style={styles.segmentRow}>
                                            {(["pending_review", "verified", "incomplete", "not_suitable"] as VerificationStatus[]).map((s) => {
                                                const active = eVerificationStatus === s;
                                                const label =
                                                    s === "pending_review"
                                                        ? "Por revisar"
                                                        : s === "verified"
                                                            ? "Verificado"
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

                <AdminAssignModal
                    visible={assignOpen}
                    onClose={closeAssign}
                    entityId={assignClientId}
                    entityType="cliente"
                    entityTitle={
                        assignClientDoc
                            ? ((((assignClientDoc as any)?.name ??
                                (assignClientDoc as any)?.business ??
                                assignClientDoc.phone ??
                                "Cliente") as string).trim() || "Cliente")
                            : ""
                    }
                    entitySubtitle={
                        assignClientDoc
                            ? (
                                assignClientDoc.address ||
                                assignClientDoc.phone ||
                                ""
                            )
                            : ""
                    }
                    users={users}
                    currentAssignedUserId={assignClientDoc?.assignedTo ?? null}
                    loadingUsers={usersLoading}
                    busy={busyId === assignClientId}
                    onAssign={async (entityId, toUserId) => {
                        try {
                            setBusyId(entityId);
                            await assignClient(entityId, toUserId);
                        } catch (e: any) {
                            Alert.alert("Error", e?.message ?? "No se pudo reasignar");
                        } finally {
                            setBusyId(null);
                        }
                    }}
                />
            </AdminBackground>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    cardAlt: "#0F172A",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    soft: "#CBD5E1",

    visited: "#22C55E",
    rejected: "#F87171",
    pending: "#FBBF24",
    primary: "#2563EB",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 13,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    hTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
    hSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
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

    searchWrap: {
        marginHorizontal: 16,
        marginBottom: 10,
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
    searchInput: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "700" },
    clearBtn: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    rangeRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
    rangePill: {
        height: 34,
        paddingHorizontal: 13,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
    },
    rangePillActive: {
        backgroundColor: "rgba(34,197,94,0.12)",
        borderColor: "rgba(34,197,94,0.28)",
    },
    rangePillText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    rangePillTextActive: {
        color: "#86EFAC",
    },

    banner: {
        marginHorizontal: 16,
        marginBottom: 10,
        minHeight: 40,
        borderRadius: 14,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: "rgba(34,197,94,0.10)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.20)",
    },
    bannerDot: {
        width: 8,
        height: 8,
        borderRadius: 999,
        backgroundColor: COLORS.visited,
    },
    bannerText: {
        color: "#86EFAC",
        fontSize: 12,
        fontWeight: "900",
    },

    listContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 13,
        gap: 10,
    },
    cardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
    },
    cardHeadLeft: {
        flex: 1,
        gap: 4,
        paddingRight: 6,
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

    phone: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    meta: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    metaStrong: { color: COLORS.soft, fontSize: 12, fontWeight: "900" },
    metaSoft: { color: "#7D8AA6", fontSize: 11, fontWeight: "800" },

    topBadgesRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
    },

    infoBadgeRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
    },
    infoBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 25,
        paddingHorizontal: 9,
        borderRadius: 999,
        borderWidth: 1,
    },
    infoBadgeText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "900",
    },
    infoBadgeNeutral: {
        backgroundColor: "rgba(255,255,255,0.05)",
        borderColor: "rgba(255,255,255,0.10)",
    },
    infoBadgeBlue: {
        backgroundColor: "rgba(37,99,235,0.12)",
        borderColor: "rgba(37,99,235,0.26)",
    },
    infoBadgeGreen: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.24)",
    },
    infoBadgeYellow: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.24)",
    },
    infoBadgeRed: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.24)",
    },

    pill: {
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        maxWidth: 140,
    },
    pillText: { fontSize: 12, fontWeight: "900", textTransform: "lowercase" },
    pillVisited: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)" },
    pillTextVisited: { color: "#86EFAC" },

    datePill: {
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    datePillText: {
        fontSize: 12,
        fontWeight: "900",
    },
    datePillVisited: {
        backgroundColor: "rgba(34,197,94,0.08)",
        borderColor: "rgba(34,197,94,0.22)",
    },
    datePillTextVisited: {
        color: "#86EFAC",
    },

    notSuitableTag: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        minHeight: 30,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: "rgba(248,113,113,0.12)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.34)",
    },
    notSuitableTagText: {
        color: "#FCA5A5",
        fontSize: 12,
        fontWeight: "900",
    },

    infoRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    infoText: {
        flex: 1,
        color: COLORS.text,
        opacity: 0.9,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 18,
    },

    assignedRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    assignedText: {
        flex: 1,
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },

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
    inboundTextMuted: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "700",
    },

    actionsRow: {
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
        justifyContent: "flex-end",
    },
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
    iconBtnPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },
    iconBtnDisabled: { opacity: 0.5 },

    busyText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },

    empty: { marginTop: 40, alignItems: "center", gap: 10, paddingHorizontal: 16 },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900", textAlign: "center" },

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
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 },
    modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: "900", flex: 1 },
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
});