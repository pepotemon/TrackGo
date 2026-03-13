import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Dimensions,
    Linking,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    UIManager,
    View,
    findNodeHandle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AdminBackground from "../../components/admin/AdminBackground";
import {
    assignClient,
    deleteClient,
    subscribeAdminClients,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, UserDoc } from "../../types/models";

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

type MenuAnchor = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    openUp: boolean;
} | null;

const MENU_WIDTH = 186;
const MENU_HEIGHT = 258;
const MENU_GAP = 8;

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
        if (missing.length === 2) return "Falta negocio y maps";
        if (missing.length === 1) return `Falta ${missing[0]}`;
        return "Faltan datos por revisar";
    }

    if (status === "verified") return "Lead validado";
    return "Listo para revisión";
}

export default function AdminLeadQueueScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const menuButtonRefs = useRef<Record<string, View | null>>({});

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [q, setQ] = useState("");
    const [filter, setFilter] = useState<MetaFilterKey>("pending_review");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<MenuAnchor>(null);

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

    const closeMenu = () => {
        setMenuOpenId(null);
        setMenuAnchor(null);
    };

    const openSmartMenu = (clientId: string) => {
        const ref = menuButtonRefs.current[clientId];
        const node = ref ? findNodeHandle(ref) : null;

        if (!ref || !node) {
            setMenuOpenId((prev) => (prev === clientId ? null : clientId));
            return;
        }

        UIManager.measureInWindow(
            node,
            (x: number, y: number, width: number, height: number) => {
                const windowHeight = Dimensions.get("window").height;
                const safeTop = insets.top + 12;
                const safeBottom = insets.bottom + 12;

                const spaceBelow = windowHeight - (y + height) - safeBottom;
                const spaceAbove = y - safeTop;
                const openUp = spaceBelow < MENU_HEIGHT && spaceAbove > spaceBelow;

                setMenuOpenId((prev) => {
                    const next = prev === clientId ? null : clientId;
                    if (!next) {
                        setMenuAnchor(null);
                        return null;
                    }

                    setMenuAnchor({
                        id: clientId,
                        x,
                        y,
                        width,
                        height,
                        openUp,
                    });
                    return clientId;
                });
            }
        );
    };

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
                        ${safeText(getVerificationStatusLabel(verification))}
                        ${safeText(getNotSuitableReason(c))}
                        ${safeText(getQuickStatusText(c))}
                        ${safeText(String((c as any)?.lastInboundText ?? ""))}
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

    const openChatScreen = (client: ClientDoc) => {
        const clientName =
            String((client as any)?.name ?? "").trim() ||
            String((client as any)?.phone ?? "").trim() ||
            "Lead";

        router.push({
            pathname: "/admin/lead-chat" as any,
            params: {
                clientId: client.id,
                clientName,
            },
        });
    };

    const confirmDelete = (id: string) => {
        closeMenu();
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
        closeMenu();
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
            closeMenu();

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
        closeMenu();

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
        closeMenu();
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

    const SummaryFilter = ({
        icon,
        value,
        label,
        color,
        bgStyle,
        textStyle,
        k,
    }: {
        icon: any;
        value: number;
        label: string;
        color: string;
        bgStyle: any;
        textStyle: any;
        k: MetaFilterKey;
    }) => {
        const active = filter === k;
        return (
            <Pressable
                onPress={() => {
                    closeMenu();
                    setFilter(k);
                }}
                style={({ pressed }) => [
                    styles.summaryBadge,
                    bgStyle,
                    active && styles.summaryBadgeActive,
                    pressed && styles.pressed,
                ]}
            >
                <Ionicons name={icon} size={12} color={color} />
                <Text style={[styles.summaryBadgeText, textStyle]}>{value}</Text>
                <Text style={[styles.summaryBadgeLabel, active && styles.summaryBadgeLabelActive]}>
                    {label}
                </Text>
            </Pressable>
        );
    };

    const menuTop = useMemo(() => {
        if (!menuAnchor) return 0;
        if (menuAnchor.openUp) {
            return Math.max(insets.top + 8, menuAnchor.y - MENU_HEIGHT - MENU_GAP);
        }
        const maxTop = Dimensions.get("window").height - insets.bottom - MENU_HEIGHT - 8;
        return Math.min(maxTop, menuAnchor.y + menuAnchor.height + MENU_GAP);
    }, [menuAnchor, insets.top, insets.bottom]);

    const menuLeft = useMemo(() => {
        if (!menuAnchor) return 0;
        const windowWidth = Dimensions.get("window").width;
        const preferred = menuAnchor.x + menuAnchor.width - MENU_WIDTH;
        return Math.max(10, Math.min(preferred, windowWidth - MENU_WIDTH - 10));
    }, [menuAnchor]);

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
            <AdminBackground>
                <View style={styles.screenOverlay}>
                    <View style={styles.header}>
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
                            <Ionicons name={usersLoading ? "sync" : "people-outline"} size={17} color={COLORS.text} />
                        </Pressable>
                    </View>

                    <View style={styles.summaryRow}>
                        <SummaryFilter
                            k="pending_review"
                            icon="shield-checkmark-outline"
                            value={totals.pendingReview}
                            label="Revisar"
                            color="#93C5FD"
                            bgStyle={styles.summaryBadgeBlue}
                            textStyle={styles.summaryBadgeTextBlue}
                        />

                        <SummaryFilter
                            k="incomplete"
                            icon="alert-circle-outline"
                            value={totals.incomplete}
                            label=""
                            color="#FDE68A"
                            bgStyle={styles.summaryBadgeYellow}
                            textStyle={styles.summaryBadgeTextYellow}
                        />

                        <SummaryFilter
                            k="not_suitable"
                            icon="ban-outline"
                            value={totals.notSuitable}
                            label="No aptos"
                            color="#FCA5A5"
                            bgStyle={styles.summaryBadgeRed}
                            textStyle={styles.summaryBadgeTextRed}
                        />

                        <SummaryFilter
                            k="all"
                            icon="apps-outline"
                            value={visibleTotal}
                            label="Todos"
                            color="#C4B5FD"
                            bgStyle={styles.summaryBadgeAll}
                            textStyle={styles.summaryBadgeTextAll}
                        />
                    </View>

                    <View style={styles.searchWrap}>
                        <Ionicons name="search-outline" size={17} color={COLORS.muted} />
                        <TextInput
                            value={q}
                            onChangeText={setQ}
                            placeholder="Buscar lead"
                            placeholderTextColor={COLORS.muted}
                            style={styles.searchInput}
                        />
                        {!!q ? (
                            <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                                <Ionicons name="close" size={17} color={COLORS.text} />
                            </Pressable>
                        ) : null}
                    </View>

                    <ScrollView
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        onScrollBeginDrag={closeMenu}
                    >
                        {filteredClients.map((c) => {
                            const name = ((c as any).name ?? "").trim();
                            const subtitle = getPrimarySubtitle(c);
                            const verificationStatus = getDerivedVerificationStatus(c);
                            const createdAt = toMs((c as any)?.createdAt);
                            const lastInboundAt = toMs((c as any)?.lastInboundMessageAt);
                            const isBusy = busyId === c.id;
                            const lastInboundText = String((c as any)?.lastInboundText ?? "").trim();
                            const notSuitableReason = getNotSuitableReason(c);

                            return (
                                <View key={c.id} style={styles.card}>
                                    <View style={styles.cardTop}>
                                        <View style={styles.cardTopMain}>
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
                                        </View>

                                        <View style={styles.menuWrap}>
                                            <View
                                                ref={(ref) => {
                                                    menuButtonRefs.current[c.id] = ref;
                                                }}
                                                collapsable={false}
                                            >
                                                <Pressable
                                                    onPress={() => openSmartMenu(c.id)}
                                                    style={({ pressed }) => [
                                                        styles.menuBtn,
                                                        pressed && styles.pressed,
                                                    ]}
                                                    disabled={isBusy}
                                                >
                                                    <Ionicons name="ellipsis-vertical" size={16} color={COLORS.text} />
                                                </Pressable>
                                            </View>
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
                                            size={14}
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
                                            {getQuickStatusText(c)}
                                        </Text>
                                    </View>

                                    {!!c.address ? (
                                        <View style={styles.infoRow}>
                                            <Ionicons name="location-outline" size={14} color={COLORS.muted} />
                                            <Text style={styles.infoText} numberOfLines={2}>
                                                {c.address}
                                            </Text>
                                        </View>
                                    ) : null}

                                    <View style={styles.assignedRow}>
                                        <Ionicons name="time-outline" size={14} color={COLORS.muted} />
                                        <Text style={styles.assignedText} numberOfLines={1}>
                                            Creado: {formatDateLabel(createdAt)} · Último: {formatDateLabel(lastInboundAt || createdAt)}
                                        </Text>
                                    </View>

                                    {lastInboundText ? (
                                        <View style={styles.inboundBox}>
                                            <View style={styles.inboundHeader}>
                                                <Ionicons name="chatbubble-ellipses-outline" size={13} color={COLORS.muted} />
                                                <Text style={styles.inboundTitle}>Último mensaje recibido</Text>

                                                <Pressable
                                                    onPress={() => openChatScreen(c)}
                                                    style={({ pressed }) => [
                                                        styles.inboundOpenPill,
                                                        pressed && styles.pressed,
                                                    ]}
                                                >
                                                    <Text style={styles.inboundOpenPillText}>Ir al chat</Text>
                                                </Pressable>
                                            </View>

                                            <Text style={styles.inboundText} numberOfLines={2}>
                                                {lastInboundText}
                                            </Text>
                                        </View>
                                    ) : (
                                        <Pressable
                                            onPress={() => openChatScreen(c)}
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
                                            onPress={() => openMaps(c.mapsUrl)}
                                            style={({ pressed }) => [styles.miniIconBtn, pressed && styles.iconBtnPressed]}
                                        >
                                            <Ionicons name="map-outline" size={16} color={COLORS.text} />
                                        </Pressable>

                                        <Pressable
                                            onPress={() => openWsp((c as any).waId || c.phone)}
                                            style={({ pressed }) => [styles.miniIconBtn, pressed && styles.iconBtnPressed]}
                                        >
                                            <Ionicons name="logo-whatsapp" size={16} color={COLORS.text} />
                                        </Pressable>

                                        {verificationStatus === "not_suitable" && !!notSuitableReason ? (
                                            <Text style={styles.bottomReasonText} numberOfLines={1}>
                                                {notSuitableReason}
                                            </Text>
                                        ) : (
                                            <View style={{ flex: 1 }} />
                                        )}
                                    </View>

                                    {isBusy ? <Text style={styles.busyText}>Procesando…</Text> : null}
                                </View>
                            );
                        })}

                        {!filteredClients.length ? (
                            <View style={styles.empty}>
                                <Ionicons name="file-tray-outline" size={22} color={COLORS.muted} />
                                <Text style={styles.emptyText}>
                                    {q.trim() ? "No hay resultados." : "No hay leads Meta pendientes en la cola."}
                                </Text>
                            </View>
                        ) : null}
                    </ScrollView>

                    {menuOpenId && menuAnchor ? (
                        <View style={styles.menuOverlay} pointerEvents="box-none">
                            <Pressable style={StyleSheet.absoluteFillObject} onPress={closeMenu} />
                            <View
                                style={[
                                    styles.menuPanelPortal,
                                    {
                                        top: menuTop,
                                        left: menuLeft,
                                    },
                                ]}
                            >
                                <Pressable
                                    onPress={() => confirmVerificationStatusChange(menuOpenId, "pending_review")}
                                    style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="shield-checkmark-outline" size={15} color="#93C5FD" />
                                    <Text style={styles.menuItemText}>Revisar</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => confirmVerificationStatusChange(menuOpenId, "incomplete")}
                                    style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="alert-circle-outline" size={15} color="#FDE68A" />
                                    <Text style={styles.menuItemText}>Incompleto</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        const target = filteredClients.find((x) => x.id === menuOpenId);
                                        confirmVerificationStatusChange(
                                            menuOpenId,
                                            "not_suitable",
                                            target ? getNotSuitableReason(target) || "Perfil no apto" : "Perfil no apto"
                                        );
                                    }}
                                    style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="ban-outline" size={15} color="#FCA5A5" />
                                    <Text style={styles.menuItemText}>No apto</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => openAssignPicker(menuOpenId)}
                                    style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="person-add-outline" size={15} color={COLORS.text} />
                                    <Text style={styles.menuItemText}>Reasignar</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => {
                                        const target = filteredClients.find((x) => x.id === menuOpenId);
                                        if (target) startEdit(target);
                                    }}
                                    style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="create-outline" size={15} color={COLORS.text} />
                                    <Text style={styles.menuItemText}>Editar</Text>
                                </Pressable>

                                <Pressable
                                    onPress={() => confirmDelete(menuOpenId)}
                                    style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                                >
                                    <Ionicons name="trash-outline" size={15} color={COLORS.rejected} />
                                    <Text style={[styles.menuItemText, { color: "#FCA5A5" }]}>Eliminar</Text>
                                </Pressable>
                            </View>
                        </View>
                    ) : null}

                    {editOpen ? (
                        <View style={styles.inlineModalOverlay}>
                            <View style={styles.inlineModalWrap}>
                                <View style={styles.modalCardBig}>
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
                            </View>
                        </View>
                    ) : null}

                    {userPickerOpen ? (
                        <View style={styles.inlineModalOverlay}>
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
                    ) : null}
                </View>
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
    screenOverlay: { flex: 1 },

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

    header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    hTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
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

    summaryRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    summaryBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        height: 26,
        borderRadius: 999,
        borderWidth: 1,
    },
    summaryBadgeActive: {
        transform: [{ scale: 1.01 }],
        borderColor: "rgba(255,255,255,0.22)",
    },
    summaryBadgeText: {
        fontSize: 11,
        fontWeight: "900",
    },
    summaryBadgeLabel: {
        color: "#D1D5DB",
        fontSize: 11,
        fontWeight: "900",
    },
    summaryBadgeLabelActive: {
        color: COLORS.text,
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
    summaryBadgeAll: {
        backgroundColor: "rgba(124,58,237,0.12)",
        borderColor: "rgba(124,58,237,0.26)",
    },
    summaryBadgeTextAll: { color: "#C4B5FD" },

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
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    listContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },

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
    cardTopMain: {
        flex: 1,
        gap: 4,
        paddingRight: 4,
    },
    phone: { color: COLORS.text, fontSize: 14, fontWeight: "900" },
    metaPrimary: { color: "#D7DCE5", fontSize: 13, fontWeight: "900" },
    meta: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    menuWrap: {
        position: "relative",
        zIndex: 2,
    },
    menuOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 50,
        elevation: 50,
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
    menuPanelPortal: {
        position: "absolute",
        width: MENU_WIDTH,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        paddingVertical: 6,
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
        elevation: 12,
    },
    menuItem: {
        minHeight: 40,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
    },
    menuItemText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "800",
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

    infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    infoText: { flex: 1, color: COLORS.text, opacity: 0.9, fontSize: 12, fontWeight: "700" },

    assignedRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    assignedText: { flex: 1, color: COLORS.muted, fontSize: 11, fontWeight: "800" },

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

    busyText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },

    empty: { marginTop: 40, alignItems: "center", gap: 10, paddingHorizontal: 16 },
    emptySmall: { paddingVertical: 10, alignItems: "center" },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900", textAlign: "center" },

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
    modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
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
});