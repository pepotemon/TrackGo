// src/screens/admin/AdminUserClientsScreen.tsx
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
import type { ClientDoc, ClientStatus, DailyEventDoc, UserDoc } from "../../types/models";

function normalizePhone(raw: string) {
    return (raw ?? "").replace(/\D+/g, "");
}
function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

type FilterKey = "all" | "pending" | "visited" | "rejected";
type RejectReason = "clavo" | "localizacion" | "otro";

function isUnassignedClient(c: ClientDoc) {
    const assigned = ((c.assignedTo ?? "") as any).toString().trim();
    return assigned.length === 0;
}

function looksLikeMapsUrl(url: string) {
    const u = (url ?? "").trim().toLowerCase();
    return u.includes("maps") || u.includes("goo.gl") || u.includes("google.com");
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

/** ✅ dayKey local desde Date */
function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** ✅ último evento por clientId (por createdAt) */
function latestEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();
    for (const e of events) {
        const cid = (e as any)?.clientId as string | undefined;
        if (!cid) continue;

        const type = (e as any)?.type;
        if (type !== "visited" && type !== "rejected" && type !== "pending") continue;

        const prev = map.get(cid);
        const eMs = typeof (e as any)?.createdAt === "number" ? ((e as any).createdAt as number) : 0;
        const pMs = prev && typeof (prev as any)?.createdAt === "number" ? ((prev as any).createdAt as number) : 0;

        if (!prev || eMs >= pMs) map.set(cid, e);
    }
    return map;
}

/** ✅ motivo desde el evento (robusto) */
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
    if (r === "otro" || r === "outro") return "otro";
    return undefined;
}

/** ✅ motivo desde el CLIENT DOC (por si ya lo guardas ahí) */
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
    if (r === "otro" || r === "outro") return "otro";
    return undefined;
}

function reasonLabel(r?: RejectReason) {
    if (r === "clavo") return "Clavo";
    if (r === "localizacion") return "Localización";
    if (r === "otro") return "Otro";
    return "—";
}
function reasonIcon(r?: RejectReason) {
    if (r === "clavo") return "alert-circle-outline";
    if (r === "localizacion") return "navigate-outline";
    if (r === "otro") return "help-circle-outline";
    return "information-circle-outline";
}

export default function AdminUserClientsScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ userId?: string }>();
    const userId = (params?.userId ?? "").toString();
    const isUnassignedView = userId === "UNASSIGNED";

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    const [q, setQ] = useState("");
    const [filter, setFilter] = useState<FilterKey>("pending");
    const [busyId, setBusyId] = useState<string | null>(null);

    // ✅ eventos para motivos (últimos 180 días, no solo hoy)
    const [events, setEvents] = useState<DailyEventDoc[]>([]);

    // ✅ Edit modal
    const [editOpen, setEditOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [eName, setEName] = useState("");
    const [eBusiness, setEBusiness] = useState("");
    const [ePhone, setEPhone] = useState("");
    const [eMapsUrl, setEMapsUrl] = useState("");
    const [eAddress, setEAddress] = useState("");
    const [eAssigneeId, setEAssigneeId] = useState<string | null>(null);
    const [eSaving, setESaving] = useState(false);

    // ✅ Reassign modal (user picker)
    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [pickerTargetClientId, setPickerTargetClientId] = useState<string | null>(null);

    useEffect(() => {
        const unsub = subscribeAdminClients((list) => setClients(list ?? []));
        return () => unsub();
    }, []);

    // ✅ Cargar eventos de un rango grande para capturar rechazos viejos
    useEffect(() => {
        const end = new Date();
        end.setHours(0, 0, 0, 0);

        const start = new Date(end);
        start.setDate(start.getDate() - 180);

        const startKey = dayKeyFromDate(start);
        const endKey = dayKeyFromDate(end);

        const unsub = subscribeDailyEventsByRange(
            startKey,
            endKey,
            (list) => setEvents(list ?? []),
            (err) => console.log("[AdminUserClients] events err:", err?.code, err?.message)
        );

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
        if (isUnassignedView) return isUnassignedClient(c);
        return ((c.assignedTo ?? "") as any).toString() === userId;
    };

    // ✅ último evento por clientId (dentro del rango)
    const lastEventByClient = useMemo(() => latestEventByClient(events), [events]);

    // ✅ motivo final por clientId: primero clientDoc, luego evento
    const rejectReasonByClientId = useMemo(() => {
        const m = new Map<string, RejectReason>();

        // 1) eventos (fallback)
        for (const [cid, ev] of lastEventByClient.entries()) {
            if ((ev as any)?.type !== "rejected") continue;
            const r = extractRejectReasonFromEvent(ev);
            if (r) m.set(cid, r);
        }

        return m;
    }, [lastEventByClient]);

    const totals = useMemo(() => {
        let pending = 0,
            visited = 0,
            rejected = 0;

        for (const c of clients) {
            if (!belongsToThisView(c)) continue;
            if (c.status === "visited") visited++;
            else if (c.status === "rejected") rejected++;
            else pending++;
        }
        return { total: pending + visited + rejected, pending, visited, rejected };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clients, userId, isUnassignedView]);

    const userClients = useMemo(() => {
        const base = clients.filter(belongsToThisView);

        const qtText = q.trim().toLowerCase();
        const qtDigits = normalizePhone(q);

        return base
            .filter((c) => {
                if (filter !== "all" && c.status !== filter) return false;

                if (!qtText && !qtDigits) return true;

                if (qtDigits) {
                    const ph = normalizePhone(c.phone ?? "");
                    if (ph.includes(qtDigits)) return true;
                }

                if (qtText) {
                    const hay = `${safeText((c as any).name)} ${safeText((c as any).business)} ${safeText(
                        c.address
                    )} ${safeText(c.mapsUrl)} ${safeText(c.phone)}`;
                    return hay.includes(qtText);
                }

                return true;
            })
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clients, userId, q, filter, isUnassignedView]);

    const pill = (status?: ClientStatus) => {
        if (status === "visited") return [styles.pill, styles.pillVisited];
        if (status === "rejected") return [styles.pill, styles.pillRejected];
        return [styles.pill, styles.pillPending];
    };
    const pillText = (status?: ClientStatus) => {
        if (status === "visited") return [styles.pillText, styles.pillTextVisited];
        if (status === "rejected") return [styles.pillText, styles.pillTextRejected];
        return [styles.pillText, styles.pillTextPending];
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
        const msg = "Hola! Te escribo por la visita 🙌";
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

    const startEdit = async (c: ClientDoc) => {
        if (!users.length && !usersLoading) await reloadUsers();

        setEditingId(c.id);
        setEName(((c as any).name ?? "").toString());
        setEBusiness(((c as any).business ?? "").toString());
        setEPhone((c.phone ?? "").toString());
        setEMapsUrl((c.mapsUrl ?? "").toString());
        setEAddress((c.address ?? "").toString());

        const a = ((c.assignedTo ?? "") as any).toString().trim();
        setEAssigneeId(a ? a : null);

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

        setESaving(true);
        try {
            const now = Date.now();

            const patch: any = {
                phone: cleanPhone,
                mapsUrl: cleanMaps,
                updatedAt: now,
                name: cleanName ? cleanName : "",
                business: cleanBusiness ? cleanBusiness : "",
                address: cleanAddress ? cleanAddress : "",
            };

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

    const FilterPill = ({ k, label, value }: { k: FilterKey; label: string; value: number }) => {
        const active = filter === k;
        return (
            <Pressable
                onPress={() => setFilter(k)}
                style={({ pressed }) => [styles.filterPill, active && styles.filterPillActive, pressed && styles.pressed]}
            >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
                <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
                    <Text style={[styles.filterBadgeText, active && styles.filterBadgeTextActive]}>{value}</Text>
                </View>
            </Pressable>
        );
    };

    const RejectTag = ({ reason }: { reason?: RejectReason }) => {
        if (!reason) return null;
        return (
            <View style={styles.rejectTag}>
                <Ionicons name={reasonIcon(reason) as any} size={14} color={COLORS.rejected} />
                <Text style={styles.rejectTagText}>{reasonLabel(reason)}</Text>
            </View>
        );
    };

    const title = isUnassignedView ? "Sin asignar" : user?.name?.trim() || "Usuario";
    const subtitle = isUnassignedView ? "Clientes sin asignación" : user?.email?.trim() || "—";

    const pickerUsers = useMemo(() => {
        const qt = pickerQuery.trim().toLowerCase();
        if (!qt) return users;

        return users.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, pickerQuery]);

    const modalBottomPad = Math.max(10, insets.bottom + 10);

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

            {/* Header */}
            <View style={styles.header}>
                <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
                    <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                </Pressable>

                <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.hTitle} numberOfLines={1}>
                        {title}
                    </Text>
                    <Text style={styles.hSub} numberOfLines={1}>
                        {subtitle} · T <Text style={styles.hStrong}>{totals.total}</Text>
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

            {/* Search */}
            <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar cliente"
                    placeholderTextColor={COLORS.muted}
                    style={styles.searchInput}
                />
                {!!q ? (
                    <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                        <Ionicons name="close" size={18} color={COLORS.text} />
                    </Pressable>
                ) : null}
            </View>

            {/* Filters */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
                <FilterPill k="pending" label="Pendientes" value={totals.pending} />
                <FilterPill k="visited" label="Visitados" value={totals.visited} />
                <FilterPill k="rejected" label="Rechazados" value={totals.rejected} />
                <FilterPill k="all" label="Todos" value={totals.total} />
            </ScrollView>

            {/* List */}
            <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                {userClients.map((c) => {
                    const name = ((c as any).name ?? "").trim();
                    const biz = ((c as any).business ?? "").trim();
                    const isBusy = busyId === c.id;

                    const assignedLabel = (() => {
                        const a = ((c.assignedTo ?? "") as any).toString().trim();
                        if (!a) return "Sin asignar";
                        const u = userById.get(a);
                        if (!u) return "Asignado (cargando…)";
                        return (u.name ?? "").trim() || (u.email ?? "").trim() || "Usuario";
                    })();

                    // ✅ motivo: primero desde el cliente (si existe), si no desde events
                    const fromClient = c.status === "rejected" ? extractRejectReasonFromClient(c) : undefined;
                    const fromEvents = c.status === "rejected" ? rejectReasonByClientId.get(c.id) : undefined;
                    const rejectReason = fromClient ?? fromEvents;

                    return (
                        <View key={c.id} style={styles.card}>
                            <View style={styles.cardTop}>
                                <View style={{ flex: 1, gap: 6 }}>
                                    <Text style={styles.phone} numberOfLines={1}>
                                        {c.phone}
                                    </Text>

                                    {!!name ? <Text style={styles.meta} numberOfLines={1}>{name}</Text> : null}
                                    {!!biz ? <Text style={styles.meta} numberOfLines={1}>{biz}</Text> : null}

                                    {c.status === "rejected" ? (
                                        rejectReason ? (
                                            <RejectTag reason={rejectReason} />
                                        ) : (
                                            <View style={styles.rejectTagMuted}>
                                                <Ionicons name="information-circle-outline" size={14} color={COLORS.muted} />
                                                <Text style={styles.rejectTagTextMuted}>Rechazo: sin motivo guardado</Text>
                                            </View>
                                        )
                                    ) : null}
                                </View>

                                <View style={pill(c.status)}>
                                    <Text style={pillText(c.status)} numberOfLines={1}>
                                        {c.status}
                                    </Text>
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
                                <Ionicons name="person-outline" size={16} color={COLORS.muted} />
                                <Text style={styles.assignedText} numberOfLines={1}>
                                    {assignedLabel}
                                </Text>
                            </View>

                            <View style={styles.actionsRow}>
                                <Pressable onPress={() => openMaps(c.mapsUrl)} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
                                    <Ionicons name="map-outline" size={18} color={COLORS.text} />
                                </Pressable>

                                <Pressable onPress={() => openWsp(c.phone)} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
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
                                    onPress={() => clearAssign(c.id)}
                                    disabled={isBusy}
                                    style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed, isBusy && styles.iconBtnDisabled]}
                                >
                                    <Ionicons name="remove-circle-outline" size={18} color={COLORS.text} />
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

                {!userClients.length ? (
                    <View style={styles.empty}>
                        <Ionicons name="briefcase-outline" size={24} color={COLORS.muted} />
                        <Text style={styles.emptyText}>
                            {q.trim()
                                ? "No hay resultados."
                                : isUnassignedView
                                    ? "No hay clientes sin asignar."
                                    : "Este usuario no tiene clientes."}
                        </Text>
                    </View>
                ) : null}
            </ScrollView>

            {/* =========================
          EDIT MODAL
         ========================= */}
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
                                        <TextInput value={eName} onChangeText={setEName} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>

                                    <View style={[styles.field, { flex: 1 }]}>
                                        <Text style={styles.label}>Negocio</Text>
                                        <TextInput value={eBusiness} onChangeText={setEBusiness} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>
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

            {/* =========================
          USER PICKER MODAL (Reasignar)
         ========================= */}
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
                                <TextInput value={pickerQuery} onChangeText={setPickerQuery} placeholder="Buscar…" placeholderTextColor={COLORS.muted} style={styles.searchInput} />
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
                                    <Pressable key={u.id} onPress={() => onPickUser(u)} style={({ pressed }) => [styles.userRow, pressed && styles.userRowPressed]}>
                                        <View style={styles.userAvatar}>
                                            <Ionicons name="person-outline" size={18} color={COLORS.text} />
                                        </View>

                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.userName} numberOfLines={1}>{u.name}</Text>
                                            <Text style={styles.userEmail} numberOfLines={1}>{u.email}</Text>
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
    meta: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

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
    pillPending: { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.35)" },
    pillTextPending: { color: "#FDE68A" },
    pillVisited: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)" },
    pillTextVisited: { color: "#86EFAC" },
    pillRejected: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)" },
    pillTextRejected: { color: "#FCA5A5" },

    // ✅ tag de motivo
    rejectTag: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        backgroundColor: "rgba(248,113,113,0.10)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.30)",
    },
    rejectTagText: { color: "#FCA5A5", fontSize: 12, fontWeight: "900" },

    rejectTagMuted: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    rejectTagTextMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },

    infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    infoText: { flex: 1, color: COLORS.text, opacity: 0.9, fontSize: 12, fontWeight: "700" },

    assignedRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
    assignedText: { flex: 1, color: COLORS.muted, fontSize: 12, fontWeight: "800" },

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
    iconBtnDanger: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.30)" },
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
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 },
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