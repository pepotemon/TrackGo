import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    SectionList,
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
    createClient,
    deleteClient,
    subscribeAdminClients,
    subscribeUserClients,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import { dayKeyFromMs } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, UserDoc } from "../../types/models";

import { useShareText } from "../../share/receiveShareText";

function normalizePhone(raw: string) {
    return (raw ?? "").replace(/\D+/g, "");
}

function looksLikeMapsUrl(url: string) {
    const u = (url ?? "").trim().toLowerCase();
    return u.includes("maps") || u.includes("goo.gl") || u.includes("google.com");
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

function safeStatus(value?: string | null): "pending" | "visited" | "rejected" {
    if (value === "visited") return "visited";
    if (value === "rejected") return "rejected";
    return "pending";
}

function getAssignedKey(c: ClientDoc) {
    const raw = String((c as any)?.assignedTo ?? "").trim();
    return raw || "UNASSIGNED";
}

function countStatuses(list: ClientDoc[]) {
    let pending = 0;
    let visited = 0;
    let rejected = 0;

    for (const c of list) {
        const status = safeStatus((c as any)?.status);
        if (status === "visited") visited += 1;
        else if (status === "rejected") rejected += 1;
        else pending += 1;
    }

    return {
        total: list.length,
        pending,
        visited,
        rejected,
    };
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

function cleanUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
    const out: any = {};
    for (const k of Object.keys(obj)) {
        const v = (obj as any)[k];
        if (v !== undefined) out[k] = v;
    }
    return out;
}

type PickerMode = "create" | "assignExisting" | "edit";

type Section = {
    key: string;
    title: string;
    subtitle?: string;
    totals: { total: number; pending: number; visited: number; rejected: number };
    autoCount: number;
    manualCount: number;
    data: ClientDoc[];
};

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

export default function AdminUploadClientsScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const params = useLocalSearchParams<{ mapsUrl?: string; maps?: string }>();

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    // fuente correcta por usuario (igual que userhistory)
    const [clientsByUser, setClientsByUser] = useState<Record<string, ClientDoc[]>>({});
    // fuente correcta para sin asignar
    const [unassignedClients, setUnassignedClients] = useState<ClientDoc[]>([]);

    const [q, setQ] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);

    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);

    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [pickerMode, setPickerMode] = useState<PickerMode>("create");
    const [pickerTargetClientId, setPickerTargetClientId] = useState<string | null>(null);

    const [cName, setCName] = useState("");
    const [cBusiness, setCBusiness] = useState("");
    const [cPhone, setCPhone] = useState("");
    const [cMapsUrl, setCMapsUrl] = useState("");
    const [cAddress, setCAddress] = useState("");
    const [cAssigneeId, setCAssigneeId] = useState<string | null>(null);
    const [cSaving, setCSaving] = useState(false);
    const [cErr, setCErr] = useState<string | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [eName, setEName] = useState("");
    const [eBusiness, setEBusiness] = useState("");
    const [ePhone, setEPhone] = useState("");
    const [eMapsUrl, setEMapsUrl] = useState("");
    const [eAddress, setEAddress] = useState("");
    const [eAssigneeId, setEAssigneeId] = useState<string | null>(null);
    const [eSaving, setESaving] = useState(false);

    const { sharedMapsUrl, sharedText, clear } = useShareText();
    const lastShareRef = useRef<string>("");

    useEffect(() => {
        const incoming = (sharedMapsUrl || sharedText || "").trim();
        if (!incoming) return;
        if (lastShareRef.current === incoming) return;
        lastShareRef.current = incoming;

        Clipboard.setStringAsync(incoming).catch(() => { });

        if (looksLikeMapsUrl(incoming)) {
            Alert.alert(
                "Link copiado ✅",
                "Ya copié el link de Google Maps. ¿Quieres crear el cliente ahora?",
                [
                    { text: "No", style: "cancel", onPress: () => clear() },
                    {
                        text: "Ir a crear",
                        onPress: async () => {
                            try {
                                router.replace("/admin/upload-clients" as any);
                            } catch { }

                            await ensureUsers();
                            setCMapsUrl(incoming);
                            setCreateOpen(true);
                            clear();
                        },
                    },
                ]
            );
        } else {
            Alert.alert("Copiado ✅", "Pégalo en el campo de Google Maps.", [
                { text: "OK", onPress: () => clear() },
            ]);
        }
    }, [sharedMapsUrl, sharedText, clear, router]);

    const reloadUsers = async () => {
        if (usersLoading) return;
        setUsersLoading(true);
        try {
            const u = await listUsers("user");
            const list = u ?? [];
            setUsers(list);
            if (!cAssigneeId && list[0]) setCAssigneeId(list[0].id);
            if (!eAssigneeId && list[0]) setEAssigneeId(list[0].id);
        } finally {
            setUsersLoading(false);
        }
    };

    useEffect(() => {
        reloadUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const ensureUsers = async () => {
        if (users.length || usersLoading) return;
        await reloadUsers();
    };

    /**
     * IMPORTANTE:
     * esta es la corrección real.
     * Para que coincida con UserHistory / RejectedHistory / VisitedHistory:
     * - por cada usuario: subscribeUserClients(userId)
     * - sin asignar: subscribeAdminClients filtrando assignedTo vacío
     */
    useEffect(() => {
        const cleanUsers = users.filter((u) => String(u.id ?? "").trim().length > 0);

        const unsubscribers: Array<() => void> = [];

        // reset inicial al cambiar listado de usuarios
        setClientsByUser({});

        for (const u of cleanUsers) {
            const uid = String(u.id).trim();
            const unsub = subscribeUserClients(uid, (list) => {
                setClientsByUser((prev) => ({
                    ...prev,
                    [uid]: Array.isArray(list) ? list : [],
                }));
            });
            unsubscribers.push(unsub);
        }

        const unsubAdmin = subscribeAdminClients((list) => {
            const all = Array.isArray(list) ? list : [];
            setUnassignedClients(
                all.filter((c) => String((c.assignedTo ?? "") as any).trim().length === 0)
            );
        });
        unsubscribers.push(unsubAdmin);

        return () => {
            unsubscribers.forEach((fn) => {
                try {
                    fn();
                } catch { }
            });
        };
    }, [users]);

    /**
     * unión de todas las fuentes correctas.
     * dedupe por id para evitar dobles conteos durante transiciones de asignación.
     */
    const clients = useMemo(() => {
        const byId = new Map<string, ClientDoc>();

        for (const list of Object.values(clientsByUser)) {
            for (const c of list ?? []) {
                if (!c?.id) continue;
                byId.set(c.id, c);
            }
        }

        for (const c of unassignedClients) {
            if (!c?.id) continue;
            byId.set(c.id, c);
        }

        return Array.from(byId.values());
    }, [clientsByUser, unassignedClients]);

    const userById = useMemo(() => {
        const m = new Map<string, UserDoc>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);

    const userLabelById = useMemo(() => {
        const m = new Map<string, string>();
        for (const u of users) {
            const name = (u.name ?? "").trim();
            const email = (u.email ?? "").trim();
            const label = name && email ? `${name} · ${email}` : name ? name : email ? email : "Usuario";
            m.set(u.id, label);
        }
        return m;
    }, [users]);

    const lastHandledMapsUrlRef = useRef<string>("");

    useEffect(() => {
        const raw = (params?.mapsUrl ?? params?.maps ?? "") as any;
        const incoming =
            (typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "").trim();

        if (!incoming) return;
        if (lastHandledMapsUrlRef.current === incoming) return;
        lastHandledMapsUrlRef.current = incoming;

        (async () => {
            await ensureUsers();
            setCMapsUrl(incoming);
            setCreateOpen(true);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params?.mapsUrl, params?.maps]);

    const pendingByUser = useMemo(() => {
        const m = new Map<string, number>();

        // usuarios: contar desde subscribeUserClients
        for (const u of users) {
            const uid = String(u.id ?? "").trim();
            if (!uid) continue;
            const totals = countStatuses(clientsByUser[uid] ?? []);
            m.set(uid, totals.pending);
        }

        // unassigned: contar desde admin filtrado vacío
        m.set("UNASSIGNED", countStatuses(unassignedClients).pending);

        return m;
    }, [users, clientsByUser, unassignedClients]);

    const countsWithSource = useMemo(() => {
        const base = countStatuses(clients);

        let auto = 0;
        for (const c of clients) {
            if (String((c as any)?.source ?? "").toLowerCase() === "whatsapp_meta") auto += 1;
        }

        return {
            ...base,
            auto,
            manual: clients.length - auto,
        };
    }, [clients]);

    const filteredClients = useMemo(() => {
        const qtText = q.trim().toLowerCase();
        const qtDigits = normalizePhone(q);

        if (!qtText && !qtDigits) return clients;

        const matchedUserIds = new Set<string>();
        if (qtText) {
            for (const u of users) {
                const hayU = `${safeText(u.name)} ${safeText(u.email)}`;
                if (hayU.includes(qtText)) matchedUserIds.add(u.id);
            }
        }

        return clients.filter((c) => {
            const assignedKey = getAssignedKey(c);
            if (assignedKey !== "UNASSIGNED" && matchedUserIds.has(assignedKey)) return true;

            if (qtDigits) {
                const phoneDigits = normalizePhone(c.phone ?? "");
                if (phoneDigits.includes(qtDigits)) return true;
            }

            if (qtText) {
                const name = safeText((c as any).name);
                const business = safeText((c as any).business);
                const assigneeLabel =
                    assignedKey !== "UNASSIGNED"
                        ? safeText(userLabelById.get(assignedKey) ?? "")
                        : "sin asignar";
                const sourceLabel = safeText(getClientSourceLabel(c));
                const parseLabel = safeText(getClientParseStatusLabel(c));

                const hay = `${safeText(c.address)} ${safeText(c.mapsUrl)} ${name} ${business} ${assigneeLabel} ${sourceLabel} ${parseLabel}`;
                return hay.includes(qtText);
            }

            return false;
        });
    }, [clients, q, users, userLabelById]);

    const sections: Section[] = useMemo(() => {
        const keys = [
            "UNASSIGNED",
            ...users
                .map((u) => String(u.id ?? "").trim())
                .filter(Boolean),
        ];

        const makeTitle = (key: string) => {
            if (key === "UNASSIGNED") return "Sin asignar";
            const u = userById.get(key);
            if (!u) return "Asignado (cargando…)";
            const name = (u.name ?? "").trim();
            const email = (u.email ?? "").trim();
            return name && email ? name : name ? name : email ? email : "Usuario";
        };

        const makeSubtitle = (key: string) => {
            if (key === "UNASSIGNED") return "Clientes aún no asignados";
            const u = userById.get(key);
            if (!u) return undefined;
            const email = (u.email ?? "").trim();
            return email || undefined;
        };

        const out: Section[] = [];

        for (const key of keys) {
            const group = filteredClients.filter((c) => getAssignedKey(c) === key);
            if (!group.length) continue;

            const totals = countStatuses(group);

            let autoCount = 0;
            for (const c of group) {
                if (String((c as any)?.source ?? "").toLowerCase() === "whatsapp_meta") {
                    autoCount += 1;
                }
            }

            out.push({
                key,
                title: makeTitle(key),
                subtitle: makeSubtitle(key),
                totals,
                autoCount,
                manualCount: group.length - autoCount,
                data: [],
            });
        }

        return out;
    }, [filteredClients, users, userById]);

    const resetCreate = () => {
        setCName("");
        setCBusiness("");
        setCPhone("");
        setCMapsUrl("");
        setCAddress("");
        setCErr(null);
    };

    const phoneExists = (phoneDigits: string, excludeId?: string | null) => {
        if (!phoneDigits) return false;
        return clients.some((c) => {
            if (excludeId && c.id === excludeId) return false;
            return normalizePhone(c.phone ?? "") === phoneDigits;
        });
    };

    const submitCreate = async () => {
        setCErr(null);

        const cleanName = cName.trim();
        const cleanBusiness = cBusiness.trim();
        const cleanPhone = normalizePhone(cPhone);
        const cleanMaps = cMapsUrl.trim();
        const cleanAddress = cAddress.trim();

        if (!cleanPhone) {
            setCErr("Teléfono es obligatorio.");
            return;
        }

        if (phoneExists(cleanPhone)) {
            setCErr("Ese teléfono ya existe en la base de datos. No se puede crear duplicado.");
            return;
        }

        if (!cleanMaps) {
            setCErr("Link de Google Maps es obligatorio.");
            return;
        }

        if (!looksLikeMapsUrl(cleanMaps)) {
            setCErr("El link no parece ser de Google Maps.");
            return;
        }

        const { lat, lng } = extractLatLngFromMapsUrl(cleanMaps);

        setCSaving(true);
        try {
            const now = Date.now();

            const payload: any = {
                phone: cleanPhone,
                mapsUrl: cleanMaps,
                address: cleanAddress || undefined,
                lat,
                lng,
                status: "pending",
                createdAt: now,
                updatedAt: now,

                source: "manual",
                sourceRef: null,
                autoCapturedAt: null,
                lastInboundMessageAt: null,
                lastInboundText: null,
                lastMessageId: null,
                waId: cleanPhone,
                parseStatus: cleanAddress || cleanName || cleanBusiness ? "ready" : "partial",
            };

            if (cleanName) payload.name = cleanName;
            if (cleanBusiness) payload.business = cleanBusiness;

            if (cAssigneeId) {
                payload.assignedTo = cAssigneeId;
                payload.assignedAt = now;
                payload.assignedDayKey = dayKeyFromMs(now);
                payload.status = "pending";
                payload.statusBy = null;
                payload.statusAt = null;
                payload.note = null;
                payload.rejectedReason = null;
            }

            await createClient(cleanUndefined(payload) as any);

            resetCreate();
            setCreateOpen(false);
        } catch (e: any) {
            setCErr(e?.message ?? "Error creando cliente");
        } finally {
            setCSaving(false);
        }
    };

    const startEdit = async (c: ClientDoc) => {
        await ensureUsers();

        setEditingId(c.id);
        setEName((c as any).name ?? "");
        setEBusiness((c as any).business ?? "");
        setEPhone(c.phone ?? "");
        setEMapsUrl(c.mapsUrl ?? "");
        setEAddress(c.address ?? "");
        setEAssigneeId(String((c as any)?.assignedTo ?? "").trim() || null);

        setEditOpen(true);
    };

    const cancelEdit = () => {
        setEditOpen(false);
        setEditingId(null);
        setEName("");
        setEBusiness("");
        setEPhone("");
        setEMapsUrl("");
        setEAddress("");
        setEAssigneeId(null);
    };

    const submitEdit = async () => {
        if (!editingId) return;

        const cleanName = eName.trim();
        const cleanBusiness = eBusiness.trim();
        const cleanPhone = normalizePhone(ePhone);
        const cleanMaps = eMapsUrl.trim();
        const cleanAddress = eAddress.trim();

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

        const { lat, lng } = extractLatLngFromMapsUrl(cleanMaps);

        setESaving(true);
        try {
            const now = Date.now();

            const patch: any = {
                phone: cleanPhone,
                mapsUrl: cleanMaps,
                address: cleanAddress ? cleanAddress : "",
                updatedAt: now,
                name: cleanName ? cleanName : "",
                business: cleanBusiness ? cleanBusiness : "",
                waId: cleanPhone,
                lat,
                lng,
            };

            if (eAssigneeId) {
                patch.assignedTo = eAssigneeId;
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

    const confirmDelete = (id: string) => {
        Alert.alert("Eliminar cliente", "¿Seguro que quieres eliminar este cliente?", [
            { text: "Cancelar", style: "cancel" },
            {
                text: "Eliminar",
                style: "destructive",
                onPress: async () => {
                    try {
                        await deleteClient(id);
                        if (editingId === id) cancelEdit();
                    } catch (e: any) {
                        Alert.alert("Error", e?.message ?? "No se pudo eliminar");
                    }
                },
            },
        ]);
    };

    const pickerUsers = useMemo(() => {
        const qt = pickerQuery.trim().toLowerCase();
        if (!qt) return users;

        return users.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, pickerQuery]);

    const fabBottom = Math.max(18, insets.bottom + 18) + 14;

    const AssigneeRowValue = (userId: string | null) => {
        if (!userId) return "Sin asignar";
        const u = userById.get(userId);
        if (!u) return "Asignado (cargando…)";

        const name = (u.name ?? "").trim();
        const email = (u.email ?? "").trim();
        const label = name && email ? `${name} · ${email}` : name ? name : email ? email : "Usuario";
        const p = pendingByUser.get(userId) ?? 0;

        return (
            <View style={styles.assigneeInline}>
                <Text style={styles.selectValue} numberOfLines={1}>
                    {label}
                </Text>
                <View style={styles.pendingBadge}>
                    <Text style={styles.pendingBadgeText}>{p}</Text>
                </View>
            </View>
        );
    };

    const openUserPickerForCreate = async () => {
        await ensureUsers();
        setPickerMode("create");
        setPickerTargetClientId(null);
        setPickerQuery("");
        setUserPickerOpen(true);
    };

    const openUserPickerForEdit = async () => {
        await ensureUsers();
        setPickerMode("edit");
        setPickerTargetClientId(null);
        setPickerQuery("");
        setUserPickerOpen(true);
    };

    const openUserPickerForAssignExisting = async (clientId: string) => {
        await ensureUsers();
        setPickerMode("assignExisting");
        setPickerTargetClientId(clientId);
        setPickerQuery("");
        setUserPickerOpen(true);
    };

    const onPickUser = async (u: UserDoc) => {
        if (pickerMode === "create") {
            setCAssigneeId(u.id);
            setUserPickerOpen(false);
            return;
        }

        if (pickerMode === "edit") {
            setEAssigneeId(u.id);
            setUserPickerOpen(false);
            return;
        }

        if (pickerMode === "assignExisting" && pickerTargetClientId) {
            const clientId = pickerTargetClientId;
            setUserPickerOpen(false);

            try {
                setBusyId(clientId);
                await assignClient(clientId, u.id);
            } catch (e: any) {
                Alert.alert("Error", e?.message ?? "No se pudo asignar");
            } finally {
                setBusyId(null);
            }
        }
    };

    const goUserClients = (key: string) => {
        router.push({ pathname: "/admin/user-clients" as any, params: { userId: key } });
    };

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />
            <AdminBackground>
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.hTitle}>Clientes</Text>

                        <Text style={styles.hSub} numberOfLines={1}>
                            T <Text style={styles.hStrong}>{countsWithSource.total}</Text> · P{" "}
                            <Text style={styles.hStrong}>{countsWithSource.pending}</Text> · V{" "}
                            <Text style={styles.hStrong}>{countsWithSource.visited}</Text> · R{" "}
                            <Text style={styles.hStrong}>{countsWithSource.rejected}</Text>
                        </Text>

                        <Text style={styles.hSubAlt} numberOfLines={1}>
                            Manual <Text style={styles.hStrong}>{countsWithSource.manual}</Text> · Auto{" "}
                            <Text style={styles.hStrong}>{countsWithSource.auto}</Text>
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
                            size={18}
                            color={COLORS.text}
                        />
                    </Pressable>
                </View>

                <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                    <TextInput
                        value={q}
                        onChangeText={setQ}
                        placeholder="Buscar usuario, cliente, fuente o teléfono"
                        placeholderTextColor={COLORS.muted}
                        style={styles.searchInput}
                    />
                    {!!q ? (
                        <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    ) : null}
                </View>

                <SectionList
                    sections={sections}
                    keyExtractor={(c, i) => `${c.id}_${i}`}
                    contentContainerStyle={styles.listContent}
                    stickySectionHeadersEnabled={false}
                    renderSectionHeader={({ section }) => {
                        return (
                            <Pressable
                                onPress={() => goUserClients(section.key)}
                                style={({ pressed }) => [
                                    styles.sectionCard,
                                    pressed && styles.sectionHeaderPressed,
                                ]}
                                accessibilityLabel={`Abrir ${section.title}`}
                            >
                                <View style={styles.sectionHeaderRow}>
                                    <View style={{ flex: 1, gap: 4 }}>
                                        <View style={styles.sectionTitleRow}>
                                            <Ionicons name="person-outline" size={16} color={COLORS.muted} />
                                            <Text style={styles.sectionTitle} numberOfLines={1}>
                                                {section.title}
                                            </Text>
                                        </View>

                                        {section.subtitle ? (
                                            <Text style={styles.sectionSub} numberOfLines={1}>
                                                {section.subtitle}
                                            </Text>
                                        ) : null}

                                        <View style={styles.sectionSourceRow}>
                                            <View style={styles.sourceBadgeManual}>
                                                <Ionicons name="create-outline" size={11} color={COLORS.text} />
                                                <Text style={styles.sourceBadgeText}>Manual {section.manualCount}</Text>
                                            </View>

                                            <View style={styles.sourceBadgeAuto}>
                                                <Ionicons name="logo-whatsapp" size={11} color={COLORS.text} />
                                                <Text style={styles.sourceBadgeText}>Auto {section.autoCount}</Text>
                                            </View>
                                        </View>
                                    </View>

                                    <View style={styles.sectionPills}>
                                        <View style={[styles.miniPill, styles.miniPillPending]}>
                                            <Text style={[styles.miniPillText, styles.miniTextPending]}>
                                                {section.totals.pending}
                                            </Text>
                                        </View>
                                        <View style={[styles.miniPill, styles.miniPillVisited]}>
                                            <Text style={[styles.miniPillText, styles.miniTextVisited]}>
                                                {section.totals.visited}
                                            </Text>
                                        </View>
                                        <View style={[styles.miniPill, styles.miniPillRejected]}>
                                            <Text style={[styles.miniPillText, styles.miniTextRejected]}>
                                                {section.totals.rejected}
                                            </Text>
                                        </View>

                                        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                                    </View>
                                </View>
                            </Pressable>
                        );
                    }}
                    renderItem={() => null}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <Ionicons name="people-outline" size={24} color={COLORS.muted} />
                            <Text style={styles.emptyText}>
                                {q.trim() ? "No hay resultados." : "Aún no hay clientes."}
                            </Text>
                        </View>
                    }
                />

                <Pressable
                    onPress={async () => {
                        await ensureUsers();
                        setCreateOpen(true);
                    }}
                    style={({ pressed }) => [styles.fab, { bottom: fabBottom }, pressed && styles.fabPressed]}
                    accessibilityLabel="Crear cliente"
                >
                    <Ionicons name="add" size={22} color="#fff" />
                </Pressable>

                <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                            <View style={styles.modalCardBig}>
                                <View style={styles.modalHeader}>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text style={styles.modalTitle}>Crear cliente</Text>
                                        <Text style={styles.modalSub}>Carga manual coherente con el nuevo flujo automático</Text>
                                    </View>

                                    <Pressable onPress={() => setCreateOpen(false)} style={styles.modalClose}>
                                        <Ionicons name="close" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                    <View style={styles.infoBanner}>
                                        <Ionicons name="information-circle-outline" size={16} color={COLORS.info} />
                                        <Text style={styles.infoBannerText}>
                                            Este cliente se guardará como <Text style={styles.infoBannerStrong}>Manual</Text>.
                                        </Text>
                                    </View>

                                    <Pressable onPress={openUserPickerForCreate} style={({ pressed }) => [styles.selectRow, pressed && styles.selectRowPressed]}>
                                        <View style={{ flex: 1, gap: 2 }}>
                                            <Text style={styles.selectLabel}>Asignar a</Text>
                                            {typeof cAssigneeId === "string" ? (
                                                AssigneeRowValue(cAssigneeId)
                                            ) : (
                                                <Text style={styles.selectValue} numberOfLines={1}>
                                                    Sin asignar
                                                </Text>
                                            )}
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                                    </Pressable>

                                    <View style={styles.grid2}>
                                        <View style={[styles.field, { flex: 1 }]}>
                                            <Text style={styles.label}>Nombre</Text>
                                            <TextInput
                                                value={cName}
                                                onChangeText={setCName}
                                                placeholder="Opcional"
                                                placeholderTextColor={COLORS.muted}
                                                style={styles.input}
                                            />
                                        </View>

                                        <View style={[styles.field, { flex: 1 }]}>
                                            <Text style={styles.label}>Negocio</Text>
                                            <TextInput
                                                value={cBusiness}
                                                onChangeText={setCBusiness}
                                                placeholder="Opcional"
                                                placeholderTextColor={COLORS.muted}
                                                style={styles.input}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.grid2}>
                                        <View style={[styles.field, { flex: 1 }]}>
                                            <Text style={styles.label}>Teléfono *</Text>
                                            <TextInput
                                                value={cPhone}
                                                onChangeText={setCPhone}
                                                keyboardType="phone-pad"
                                                placeholder="+55 91 954 23 232"
                                                placeholderTextColor={COLORS.muted}
                                                style={styles.input}
                                            />
                                        </View>

                                        <View style={[styles.field, { flex: 1 }]}>
                                            <Text style={styles.label}>Dirección</Text>
                                            <TextInput
                                                value={cAddress}
                                                onChangeText={setCAddress}
                                                placeholder="Opcional"
                                                placeholderTextColor={COLORS.muted}
                                                style={styles.input}
                                            />
                                        </View>
                                    </View>

                                    <View style={styles.field}>
                                        <Text style={styles.label}>Google Maps *</Text>
                                        <TextInput
                                            value={cMapsUrl}
                                            onChangeText={setCMapsUrl}
                                            autoCapitalize="none"
                                            placeholder="https://maps.google.com/..."
                                            placeholderTextColor={COLORS.muted}
                                            style={styles.input}
                                        />
                                    </View>

                                    {cErr ? (
                                        <View style={styles.errorBox}>
                                            <Ionicons name="alert-circle-outline" size={16} color={COLORS.rejected} />
                                            <Text style={styles.errorText}>{cErr}</Text>
                                        </View>
                                    ) : null}

                                    <View style={{ flexDirection: "row", gap: 10 }}>
                                        <Pressable
                                            onPress={() => {
                                                resetCreate();
                                                setCreateOpen(false);
                                            }}
                                            style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed]}
                                            disabled={cSaving}
                                        >
                                            <Ionicons name="close-outline" size={18} color={COLORS.text} />
                                            <Text style={styles.ghostBtnText}>Cancelar</Text>
                                        </Pressable>

                                        <Pressable
                                            onPress={submitCreate}
                                            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, cSaving && styles.btnDisabled]}
                                            disabled={cSaving}
                                        >
                                            <Ionicons name="add-outline" size={18} color="#fff" />
                                            <Text style={styles.primaryBtnText}>{cSaving ? "Creando..." : "Crear"}</Text>
                                        </Pressable>
                                    </View>
                                </ScrollView>
                            </View>
                        </KeyboardAvoidingView>
                    </View>
                </Modal>

                <Modal visible={editOpen} transparent animationType="fade" onRequestClose={cancelEdit}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                            <View style={styles.modalCardBig}>
                                <View style={styles.modalHeader}>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text style={styles.modalTitle}>Editar cliente</Text>
                                        <Text style={styles.modalSub}>Ajusta datos sin perder coherencia del flujo</Text>
                                    </View>

                                    <Pressable onPress={cancelEdit} style={styles.modalClose}>
                                        <Ionicons name="close" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                    <Pressable onPress={openUserPickerForEdit} style={({ pressed }) => [styles.selectRow, pressed && styles.selectRowPressed]}>
                                        <View style={{ flex: 1, gap: 2 }}>
                                            <Text style={styles.selectLabel}>Asignado a</Text>
                                            {typeof eAssigneeId === "string" ? (
                                                AssigneeRowValue(eAssigneeId)
                                            ) : (
                                                <Text style={styles.selectValue} numberOfLines={1}>
                                                    Sin asignar
                                                </Text>
                                            )}
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                                    </Pressable>

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

                                    {editingId ? (
                                        <Pressable
                                            onPress={() => confirmDelete(editingId)}
                                            style={({ pressed }) => [styles.deleteWideBtn, pressed && styles.btnPressed]}
                                            disabled={eSaving}
                                        >
                                            <Ionicons name="trash-outline" size={18} color={COLORS.rejected} />
                                            <Text style={styles.deleteWideBtnText}>Eliminar cliente</Text>
                                        </Pressable>
                                    ) : null}
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
                                    <Text style={styles.modalTitle}>Seleccionar usuario</Text>
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
                                    {pickerMode !== "assignExisting" ? (
                                        <Pressable
                                            onPress={() => {
                                                if (pickerMode === "create") setCAssigneeId(null);
                                                if (pickerMode === "edit") setEAssigneeId(null);
                                                setUserPickerOpen(false);
                                            }}
                                            style={({ pressed }) => [styles.userRow, pressed && styles.userRowPressed]}
                                        >
                                            <View style={styles.userAvatar}>
                                                <Ionicons name="remove-outline" size={18} color={COLORS.text} />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.userName}>Sin asignar</Text>
                                                <Text style={styles.userEmail}>Crear / editar sin asignación</Text>
                                            </View>

                                            <View style={styles.pendingBadgeMini}>
                                                <Text style={styles.pendingBadgeMiniText}>
                                                    {pendingByUser.get("UNASSIGNED") ?? 0}
                                                </Text>
                                            </View>
                                        </Pressable>
                                    ) : null}

                                    {pickerUsers.map((u) => {
                                        const p = pendingByUser.get(u.id) ?? 0;

                                        return (
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

                                                <View style={styles.pendingBadgeMini}>
                                                    <Text style={styles.pendingBadgeMiniText}>{p}</Text>
                                                </View>
                                            </Pressable>
                                        );
                                    })}

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
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",

    visited: "#22C55E",
    rejected: "#F87171",
    pending: "#FBBF24",
    primary: "#2563EB",
    info: "#60A5FA",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    hTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.5 },
    hSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800", marginTop: 4 },
    hSubAlt: { color: COLORS.muted, fontSize: 11, fontWeight: "800", marginTop: 2, opacity: 0.9 },
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

    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },

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

    listContent: { paddingHorizontal: 16, paddingBottom: 140 },

    sectionCard: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        marginTop: 10,
        marginBottom: 10,
    },
    sectionHeaderPressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },

    sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    sectionTitle: { color: COLORS.text, fontSize: 14, fontWeight: "900", maxWidth: "75%" },
    sectionSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    sectionSourceRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 4,
        flexWrap: "wrap",
    },
    sourceBadgeManual: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 24,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    sourceBadgeAuto: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 24,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: "rgba(37,99,235,0.12)",
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.26)",
    },
    sourceBadgeText: {
        color: COLORS.text,
        fontSize: 10,
        fontWeight: "900",
    },

    sectionPills: { flexDirection: "row", gap: 6, alignItems: "center" },
    miniPill: {
        minWidth: 28,
        height: 26,
        borderRadius: 999,
        paddingHorizontal: 8,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    miniPillText: { fontSize: 12, fontWeight: "900" },
    miniPillPending: { backgroundColor: "rgba(251,191,36,0.10)", borderColor: "rgba(251,191,36,0.28)" },
    miniTextPending: { color: "#FDE68A" },
    miniPillVisited: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.28)" },
    miniTextVisited: { color: "#86EFAC" },
    miniPillRejected: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.28)" },
    miniTextRejected: { color: "#FCA5A5" },

    empty: { marginTop: 40, alignItems: "center", gap: 10, paddingHorizontal: 16 },
    emptySmall: { paddingVertical: 10, alignItems: "center" },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900", textAlign: "center" },

    fab: {
        position: "absolute",
        right: 16,
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: COLORS.primary,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#14B8A6",
        shadowOpacity: 0.35,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
    },
    fabPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },

    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.55)",
        padding: 12,
        justifyContent: "center",
    },
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

    selectRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: 16,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    selectRowPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    selectLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    selectValue: { color: COLORS.text, fontSize: 13, fontWeight: "900", marginTop: 2 },

    infoBanner: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(96,165,250,0.28)",
        backgroundColor: "rgba(96,165,250,0.10)",
    },
    infoBannerText: {
        flex: 1,
        color: COLORS.text,
        fontSize: 12,
        fontWeight: "800",
    },
    infoBannerStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },

    errorBox: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.4)",
        backgroundColor: "rgba(248,113,113,0.10)",
    },
    errorText: { color: COLORS.rejected, fontSize: 12, fontWeight: "900", flex: 1 },

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

    deleteWideBtn: {
        height: 50,
        borderRadius: 16,
        backgroundColor: "rgba(248,113,113,0.10)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.28)",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
    },
    deleteWideBtnText: {
        color: COLORS.rejected,
        fontWeight: "900",
        fontSize: 14,
    },

    pendingBadge: {
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        backgroundColor: "rgba(251,191,36,0.10)",
        borderWidth: 1,
        borderColor: "rgba(251,191,36,0.28)",
        marginTop: 6,
        alignSelf: "flex-start",
        alignItems: "center",
        justifyContent: "center",
    },
    pendingBadgeText: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

    pendingBadgeMini: {
        paddingHorizontal: 10,
        height: 26,
        borderRadius: 999,
        backgroundColor: "rgba(251,191,36,0.10)",
        borderWidth: 1,
        borderColor: "rgba(251,191,36,0.28)",
        alignItems: "center",
        justifyContent: "center",
    },
    pendingBadgeMiniText: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

    assigneeInline: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
});