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
import AdminBackground from "../../components/admin/AdminBackground";

import {
    assignClient,
    deleteClient,
    subscribeAdminClients,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import {
    dayKeyFromMs,
    subscribeDailyEventsByRange,
} from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, DailyEventDoc, UserDoc } from "../../types/models";

type VerificationStatus =
    | "verified"
    | "pending_review"
    | "incomplete"
    | "not_suitable";

type RangeKey = "today" | "7d" | "30d" | "90d";

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

function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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

function getRangeDates(key: RangeKey) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    if (key === "today") return { start, end };

    if (key === "7d") {
        start.setDate(start.getDate() - 6);
        return { start, end };
    }

    if (key === "30d") {
        start.setDate(start.getDate() - 29);
        return { start, end };
    }

    start.setDate(start.getDate() - 89);
    return { start, end };
}

function latestRejectedEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();

    for (const e of events) {
        const cid = (e as any)?.clientId as string | undefined;
        const type = (e as any)?.type as string | undefined;
        if (!cid || type !== "rejected") continue;

        const prev = map.get(cid);
        const eMs = toMs((e as any)?.createdAt);
        const pMs = prev ? toMs((prev as any)?.createdAt) : 0;

        if (!prev || eMs >= pMs) map.set(cid, e);
    }

    return map;
}

function extractRejectReasonFromEvent(ev?: DailyEventDoc | null): RejectReason | undefined {
    if (!ev) return undefined;
    const anyEv: any = ev as any;

    const raw =
        (anyEv?.reason ??
            anyEv?.rejectReason ??
            anyEv?.rejectedReason ??
            anyEv?.meta?.reason) as string | undefined;

    if (!raw) return undefined;

    const r = String(raw).toLowerCase().trim();

    if (r === "clavo") return "clavo";
    if (r === "localizacion" || r === "localización" || r === "localizacao" || r === "localização")
        return "localizacion";
    if (r === "zona_riesgosa") return "zona_riesgosa";
    if (r === "ingresos_insuficientes") return "ingresos_insuficientes";
    if (r === "muy_endeudado") return "muy_endeudado";
    if (r === "informacion_dudosa") return "informacion_dudosa";
    if (r === "no_le_interesa") return "no_le_interesa";
    if (r === "no_estaba_cerrado") return "no_estaba_cerrado";
    if (r === "fuera_de_ruta") return "fuera_de_ruta";
    if (r === "otro" || r === "outro") return "otro";

    return undefined;
}

function extractRejectReasonFromClient(c: ClientDoc): RejectReason | undefined {
    const anyC: any = c as any;

    const raw =
        (anyC?.rejectReason ??
            anyC?.rejectedReason ??
            anyC?.statusReason ??
            anyC?.rejectedMeta?.reason ??
            anyC?.statusMeta?.reason) as string | undefined;

    if (!raw) return undefined;

    const r = String(raw).toLowerCase().trim();

    if (r === "clavo") return "clavo";
    if (r === "localizacion" || r === "localización" || r === "localizacao" || r === "localização")
        return "localizacion";
    if (r === "zona_riesgosa") return "zona_riesgosa";
    if (r === "ingresos_insuficientes") return "ingresos_insuficientes";
    if (r === "muy_endeudado") return "muy_endeudado";
    if (r === "informacion_dudosa") return "informacion_dudosa";
    if (r === "no_le_interesa") return "no_le_interesa";
    if (r === "no_estaba_cerrado") return "no_estaba_cerrado";
    if (r === "fuera_de_ruta") return "fuera_de_ruta";
    if (r === "otro" || r === "outro") return "otro";

    return undefined;
}

function reasonLabel(r?: RejectReason) {
    if (r === "clavo") return "Clavo";
    if (r === "localizacion") return "Localización";
    if (r === "zona_riesgosa") return "Zona riesgosa";
    if (r === "ingresos_insuficientes") return "Ingresos insuficientes";
    if (r === "muy_endeudado") return "Muy endeudado";
    if (r === "informacion_dudosa") return "Información dudosa";
    if (r === "no_le_interesa") return "No le interesa";
    if (r === "no_estaba_cerrado") return "No estaba / cerrado";
    if (r === "fuera_de_ruta") return "Fuera de ruta";
    if (r === "otro") return "Otro";
    return "Sin motivo";
}

function reasonIcon(r?: RejectReason) {
    if (r === "clavo") return "alert-circle-outline";
    if (r === "localizacion") return "navigate-outline";
    if (r === "zona_riesgosa") return "warning-outline";
    if (r === "ingresos_insuficientes") return "cash-outline";
    if (r === "muy_endeudado") return "trending-down-outline";
    if (r === "informacion_dudosa") return "help-circle-outline";
    if (r === "no_le_interesa") return "close-circle-outline";
    if (r === "no_estaba_cerrado") return "storefront-outline";
    if (r === "fuera_de_ruta") return "map-outline";
    if (r === "otro") return "help-circle-outline";
    return "information-circle-outline";
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

export default function AdminUserClientsRejectedHistoryScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ userId?: string }>();
    const userId = (params?.userId ?? "").toString().trim();
    const isUnassignedView = userId === "UNASSIGNED";

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);

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

    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [pickerTargetClientId, setPickerTargetClientId] = useState<string | null>(null);

    const [menuOpen, setMenuOpen] = useState(false);
    const [menuClientId, setMenuClientId] = useState<string | null>(null);

    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);

    useEffect(() => {
        const { start, end } = getRangeDates(rangeKey);

        const unsub = subscribeDailyEventsByRange(
            dayKeyFromDate(start),
            dayKeyFromDate(end),
            (list) => setEvents(list ?? []),
            (err) => console.log("[RejectedHistory] events err:", err?.code, err?.message)
        );

        return () => unsub();
    }, [rangeKey]);

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

    const belongsToThisView = (c: ClientDoc) => {
        const assignedTo = String((c.assignedTo ?? "") as any).trim();

        if (isUnassignedView) return assignedTo.length === 0;
        return assignedTo === userId;
    };

    const assignedClients = useMemo(() => {
        return clients.filter(belongsToThisView);
    }, [clients, userId, isUnassignedView]);

    const rejectedEventByClient = useMemo(() => latestRejectedEventByClient(events), [events]);

    const rejectedClients = useMemo(() => {
        return assignedClients.filter((c) => rejectedEventByClient.has(c.id));
    }, [assignedClients, rejectedEventByClient]);

    const filteredClients = useMemo(() => {
        const qtText = q.trim().toLowerCase();
        const qtDigits = normalizePhone(q);

        return rejectedClients
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
            .sort((a, b) => {
                const aMs = toMs((rejectedEventByClient.get(a.id) as any)?.createdAt);
                const bMs = toMs((rejectedEventByClient.get(b.id) as any)?.createdAt);
                return bMs - aMs;
            });
    }, [rejectedClients, q, rejectedEventByClient]);

    const pickerUsers = useMemo(() => {
        const qt = pickerQuery.trim().toLowerCase();
        if (!qt) return users;

        return users.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, pickerQuery]);

    const menuClient = useMemo(() => {
        if (!menuClientId) return null;
        return clients.find((c) => c.id === menuClientId) ?? null;
    }, [clients, menuClientId]);

    const title = isUnassignedView ? "Rechazados sin asignar" : user?.name?.trim() || "Rechazados";
    const subtitle = isUnassignedView
        ? `${formatRangeLabel(rangeKey)} · ${filteredClients.length}`
        : `${formatRangeLabel(rangeKey)} · ${filteredClients.length}`;

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

        const msg = "Olá! Estou entrando em contato 🙌";
        const url = waLink(p, msg);

        try {
            await Linking.openURL(url);
        } catch {
            Alert.alert("Error", "No se pudo abrir WhatsApp.");
        }
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

        try {
            setBusyId(clientId);
            await assignClient(clientId, u.id);
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo reasignar");
        } finally {
            setBusyId(null);
            setPickerTargetClientId(null);
        }
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
                        Historial rechazados · {filteredClients.length}
                    </Text>
                </View>

                <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                    {filteredClients.map((c) => {
                        const name = ((c as any).name ?? "").trim();
                        const biz = ((c as any).business ?? "").trim();
                        const bizRaw = getBusinessRaw(c);
                        const isBusy = busyId === c.id;

                        const rejectedEvent = rejectedEventByClient.get(c.id);
                        const rejectedAt = toMs((rejectedEvent as any)?.createdAt);

                        const fromClient = extractRejectReasonFromClient(c);
                        const fromEvent = extractRejectReasonFromEvent(rejectedEvent);
                        const rejectReason = fromClient ?? fromEvent;

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
                                    <View style={[styles.pill, styles.pillRejected]}>
                                        <Text style={[styles.pillText, styles.pillTextRejected]} numberOfLines={1}>
                                            rechazado
                                        </Text>
                                    </View>

                                    {rejectedAt > 0 ? (
                                        <View style={[styles.datePill, styles.datePillRejected]}>
                                            <Text style={[styles.datePillText, styles.datePillTextRejected]} numberOfLines={1}>
                                                {formatStatusDateLabel(rejectedAt)}
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

                                <View style={styles.rejectTag}>
                                    <Ionicons name={reasonIcon(rejectReason) as any} size={14} color={COLORS.rejected} />
                                    <Text style={styles.rejectTagText}>
                                        {reasonLabel(rejectReason)}
                                    </Text>
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
                            <Ionicons name="close-circle-outline" size={24} color={COLORS.muted} />
                            <Text style={styles.emptyText}>
                                {q.trim()
                                    ? "No hay resultados."
                                    : "No hay rechazados en este rango."}
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

                <Modal visible={userPickerOpen} transparent animationType="fade" onRequestClose={() => setUserPickerOpen(false)}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.pickerWrap}>
                            <View style={styles.pickerCard}>
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>Reasignar a</Text>
                                    <Pressable onPress={() => setUserPickerOpen(false)} style={styles.modalClose}>
                                        <Ionicons name="close" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <View style={styles.searchWrapModal}>
                                    <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                                    <TextInput
                                        value={pickerQuery}
                                        onChangeText={setPickerQuery}
                                        placeholder="Buscar…"
                                        placeholderTextColor={COLORS.muted}
                                        style={styles.searchInput}
                                    />
                                    {!!pickerQuery ? (
                                        <Pressable onPress={() => setPickerQuery("")} style={styles.clearBtn}>
                                            <Ionicons name="close" size={18} color={COLORS.text} />
                                        </Pressable>
                                    ) : null}
                                </View>

                                <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                    <Pressable
                                        onPress={async () => {
                                            const clientId = pickerTargetClientId;
                                            setUserPickerOpen(false);
                                            if (!clientId) return;
                                            try {
                                                setBusyId(clientId);
                                                await assignClient(clientId, "" as any);
                                            } catch (e: any) {
                                                Alert.alert("Error", e?.message ?? "No se pudo desasignar");
                                            } finally {
                                                setBusyId(null);
                                                setPickerTargetClientId(null);
                                            }
                                        }}
                                        style={({ pressed }) => [styles.userRow, pressed && styles.userRowPressed]}
                                    >
                                        <View style={styles.userAvatar}>
                                            <Ionicons name="remove-outline" size={18} color={COLORS.text} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.userName}>Sin asignar</Text>
                                            <Text style={styles.userEmail}>Quitar asignación</Text>
                                        </View>
                                    </Pressable>

                                    {pickerUsers.map((u) => (
                                        <Pressable
                                            key={u.id}
                                            onPress={() => onPickUser(u)}
                                            style={({ pressed }) => [styles.userRow, pressed && styles.userRowPressed]}
                                        >
                                            <View style={styles.userAvatar}>
                                                <Ionicons name="person-outline" size={18} color={COLORS.text} />
                                            </View>

                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.userName} numberOfLines={1}>
                                                    {u.name}
                                                </Text>
                                                <Text style={styles.userEmail} numberOfLines={1}>
                                                    {u.email}
                                                </Text>
                                            </View>
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
        backgroundColor: "rgba(248,113,113,0.12)",
        borderColor: "rgba(248,113,113,0.28)",
    },
    rangePillText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    rangePillTextActive: {
        color: "#FCA5A5",
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
        backgroundColor: "rgba(248,113,113,0.10)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.20)",
    },
    bannerDot: {
        width: 8,
        height: 8,
        borderRadius: 999,
        backgroundColor: COLORS.rejected,
    },
    bannerText: {
        color: "#FCA5A5",
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
    pillRejected: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)" },
    pillTextRejected: { color: "#FCA5A5" },

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
    datePillRejected: {
        backgroundColor: "rgba(248,113,113,0.08)",
        borderColor: "rgba(248,113,113,0.22)",
    },
    datePillTextRejected: {
        color: "#FCA5A5",
    },

    rejectTag: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        minHeight: 30,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: "rgba(248,113,113,0.10)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.30)",
    },
    rejectTagText: { color: "#FCA5A5", fontSize: 12, fontWeight: "900" },

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
    emptySmall: { paddingVertical: 10, alignItems: "center" },
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