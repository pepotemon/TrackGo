import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    FlatList,
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
import {
    assignClient,
    createClient,
    deleteClient,
    subscribeAdminClients,
    updateClientFields,
} from "../../data/repositories/clientsRepo";
import { dayKeyFromMs } from "../../data/repositories/dailyEventsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { ClientDoc, UserDoc } from "../../types/models";

function normalizePhone(raw: string) {
    return raw.replace(/\D+/g, "");
}

function looksLikeMapsUrl(url: string) {
    const u = url.trim().toLowerCase();
    return u.includes("maps") || u.includes("goo.gl") || u.includes("google.com");
}

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

/** ✅ elimina keys con undefined (Firestore no las acepta) */
function cleanUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
    const out: any = {};
    for (const k of Object.keys(obj)) {
        const v = (obj as any)[k];
        if (v !== undefined) out[k] = v;
    }
    return out;
}

type PickerMode = "create" | "assignExisting" | "edit";

export default function AdminUploadClientsScreen() {
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    // UI
    const [q, setQ] = useState("");

    // Busy
    const [busyId, setBusyId] = useState<string | null>(null);

    // Modals
    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);

    // User picker modal (reusable)
    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");
    const [pickerMode, setPickerMode] = useState<PickerMode>("create");
    const [pickerTargetClientId, setPickerTargetClientId] = useState<string | null>(null);

    // -------------------------
    // Create form state
    // -------------------------
    const [cName, setCName] = useState("");
    const [cBusiness, setCBusiness] = useState("");
    const [cPhone, setCPhone] = useState("");
    const [cMapsUrl, setCMapsUrl] = useState("");
    const [cAddress, setCAddress] = useState("");
    const [cAssigneeId, setCAssigneeId] = useState<string | null>(null);
    const [cSaving, setCSaving] = useState(false);
    const [cErr, setCErr] = useState<string | null>(null);

    // -------------------------
    // Edit form state
    // -------------------------
    const [editingId, setEditingId] = useState<string | null>(null);
    const [eName, setEName] = useState("");
    const [eBusiness, setEBusiness] = useState("");
    const [ePhone, setEPhone] = useState("");
    const [eMapsUrl, setEMapsUrl] = useState("");
    const [eAddress, setEAddress] = useState("");
    const [eAssigneeId, setEAssigneeId] = useState<string | null>(null);
    const [eSaving, setESaving] = useState(false);

    // -------------------------
    // realtime clients
    // -------------------------
    useEffect(() => {
        const unsub = subscribeAdminClients(setClients);
        return () => unsub();
    }, []);

    // -------------------------
    // users list (lazy)
    // -------------------------
    const ensureUsers = async () => {
        if (users.length || usersLoading) return;
        setUsersLoading(true);
        try {
            const u = await listUsers("user");
            setUsers(u);
            if (!cAssigneeId && u[0]) setCAssigneeId(u[0].id);
            if (!eAssigneeId && u[0]) setEAssigneeId(u[0].id);
        } finally {
            setUsersLoading(false);
        }
    };

    const counts = useMemo(() => {
        const pending = clients.filter((c) => c.status === "pending").length;
        const visited = clients.filter((c) => c.status === "visited").length;
        const rejected = clients.filter((c) => c.status === "rejected").length;
        return { pending, visited, rejected, total: clients.length };
    }, [clients]);

    const filteredClients = useMemo(() => {
        const qt = q.trim().toLowerCase();
        if (!qt) return clients;

        return clients.filter((c) => {
            const name = safeText((c as any).name);
            const business = safeText((c as any).business);
            const hay = `${safeText(c.phone)} ${safeText(c.address)} ${safeText(c.mapsUrl)} ${name} ${business} ${safeText(
                c.assignedTo
            )}`;
            return hay.includes(qt);
        });
    }, [clients, q]);

    const userById = useMemo(() => {
        const m = new Map<string, UserDoc>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);

    const selectedCreateUser = cAssigneeId ? userById.get(cAssigneeId) : undefined;
    const selectedEditUser = eAssigneeId ? userById.get(eAssigneeId) : undefined;

    // -------------------------
    // Helpers (UI)
    // -------------------------
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

                // ✅ reasigna + resetea status a pending (por repo)
                await assignClient(clientId, u.id);
            } catch (e: any) {
                Alert.alert("Error", e?.message ?? "No se pudo asignar");
            } finally {
                setBusyId(null);
            }
        }
    };

    // -------------------------
    // Create flow
    // -------------------------
    const resetCreate = () => {
        setCName("");
        setCBusiness("");
        setCPhone("");
        setCMapsUrl("");
        setCAddress("");
        setCErr(null);
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
        if (!cleanMaps) {
            setCErr("Link de Google Maps es obligatorio.");
            return;
        }
        if (!looksLikeMapsUrl(cleanMaps)) {
            setCErr("El link no parece ser de Google Maps.");
            return;
        }

        setCSaving(true);
        try {
            const now = Date.now();

            const payload: any = {
                phone: cleanPhone,
                mapsUrl: cleanMaps,
                status: "pending",
                createdAt: now,
                updatedAt: now,
            };

            if (cleanName) payload.name = cleanName;
            if (cleanBusiness) payload.business = cleanBusiness;
            if (cleanAddress) payload.address = cleanAddress;

            if (cAssigneeId) {
                payload.assignedTo = cAssigneeId;
                payload.assignedAt = now;
                payload.assignedDayKey = dayKeyFromMs(now);

                // ✅ cuando se crea asignado, queda pendiente “nuevo”
                payload.status = "pending";
                payload.statusBy = "";
                payload.statusAt = 0;
                payload.note = "";
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

    // -------------------------
    // Edit flow
    // -------------------------
    const startEdit = async (c: ClientDoc) => {
        await ensureUsers();

        setEditingId(c.id);
        setEName((c as any).name ?? "");
        setEBusiness((c as any).business ?? "");
        setEPhone(c.phone ?? "");
        setEMapsUrl(c.mapsUrl ?? "");
        setEAddress(c.address ?? "");
        setEAssigneeId(c.assignedTo ?? null);

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

            // ⚠️ IMPORTANTE:
            // En EDIT no forzamos reset del status automáticamente,
            // porque podrías estar editando solo datos.
            // La reasignación que resetea se hace por el botón “asignar” (assignClient).

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

    // -------------------------
    // UI: pills
    // -------------------------
    const pill = (status?: string) => {
        if (status === "visited") return [styles.pill, styles.pillVisited];
        if (status === "rejected") return [styles.pill, styles.pillRejected];
        return [styles.pill, styles.pillPending];
    };
    const pillText = (status?: string) => {
        if (status === "visited") return [styles.pillText, styles.pillTextVisited];
        if (status === "rejected") return [styles.pillText, styles.pillTextRejected];
        return [styles.pillText, styles.pillTextPending];
    };

    // -------------------------
    // User picker data
    // -------------------------
    const pickerUsers = useMemo(() => {
        const qt = pickerQuery.trim().toLowerCase();
        if (!qt) return users;

        return users.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, pickerQuery]);

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 8) }]}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.hTitle}>Clientes</Text>
                    <Text style={styles.hSub}>
                        Total <Text style={styles.hStrong}>{counts.total}</Text> · Pend{" "}
                        <Text style={styles.hStrong}>{counts.pending}</Text> · Vis{" "}
                        <Text style={styles.hStrong}>{counts.visited}</Text> · Rech{" "}
                        <Text style={styles.hStrong}>{counts.rejected}</Text>
                    </Text>
                </View>

                <View style={styles.headerBadge}>
                    <Ionicons name="cloud-done-outline" size={18} color={COLORS.text} />
                </View>
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar…"
                    placeholderTextColor={COLORS.muted}
                    style={styles.searchInput}
                />
                {!!q ? (
                    <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                        <Ionicons name="close" size={18} color={COLORS.text} />
                    </Pressable>
                ) : null}
            </View>

            {/* List */}
            <FlatList
                data={filteredClients}
                keyExtractor={(c) => c.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => {
                    const displayName = ((item as any).name ?? "").trim();
                    const displayBiz = ((item as any).business ?? "").trim();
                    const assignee = item.assignedTo ? userById.get(item.assignedTo) : undefined;
                    const isBusy = busyId === item.id;

                    return (
                        <View style={styles.card}>
                            <View style={styles.cardTop}>
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={styles.phone} numberOfLines={1}>
                                        {item.phone}
                                    </Text>
                                    {!!displayName ? (
                                        <Text style={styles.meta} numberOfLines={1}>
                                            {displayName}
                                        </Text>
                                    ) : null}
                                    {!!displayBiz ? (
                                        <Text style={styles.meta} numberOfLines={1}>
                                            {displayBiz}
                                        </Text>
                                    ) : null}
                                </View>

                                <View style={pill(item.status)}>
                                    <Text style={pillText(item.status)}>{item.status ?? "pending"}</Text>
                                </View>
                            </View>

                            {!!item.address ? (
                                <View style={styles.infoRow}>
                                    <Ionicons name="location-outline" size={16} color={COLORS.muted} />
                                    <Text style={styles.infoText} numberOfLines={2}>
                                        {item.address}
                                    </Text>
                                </View>
                            ) : null}

                            <View style={styles.assignedRow}>
                                <Ionicons name="person-outline" size={16} color={COLORS.muted} />
                                <Text style={styles.assignedText} numberOfLines={1}>
                                    {item.assignedTo
                                        ? `Asignado: ${assignee ? `${assignee.name}` : item.assignedTo}`
                                        : "Sin asignar"}
                                </Text>
                            </View>

                            <View style={styles.actionsRow}>
                                <View style={styles.actionsLeft}>
                                    <Pressable
                                        onPress={() => openUserPickerForAssignExisting(item.id)}
                                        style={({ pressed }) => [
                                            styles.iconBtn,
                                            pressed && styles.iconBtnPressed,
                                            isBusy && styles.iconBtnDisabled,
                                        ]}
                                        disabled={isBusy}
                                        accessibilityLabel="Asignar"
                                    >
                                        <Ionicons name="person-add-outline" size={18} color={COLORS.text} />
                                    </Pressable>

                                    <Pressable
                                        onPress={() => startEdit(item)}
                                        style={({ pressed }) => [
                                            styles.iconBtn,
                                            pressed && styles.iconBtnPressed,
                                            isBusy && styles.iconBtnDisabled,
                                        ]}
                                        disabled={isBusy}
                                        accessibilityLabel="Editar"
                                    >
                                        <Ionicons name="create-outline" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <Pressable
                                    onPress={() => confirmDelete(item.id)}
                                    style={({ pressed }) => [
                                        styles.iconBtn,
                                        styles.iconBtnDanger,
                                        pressed && styles.iconBtnPressed,
                                        isBusy && styles.iconBtnDisabled,
                                    ]}
                                    disabled={isBusy}
                                    accessibilityLabel="Eliminar"
                                >
                                    <Ionicons name="trash-outline" size={18} color={COLORS.rejected} />
                                </Pressable>
                            </View>

                            {isBusy ? <Text style={styles.busyText}>Asignando… (estado reiniciado)</Text> : null}
                        </View>
                    );
                }}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="people-outline" size={24} color={COLORS.muted} />
                        <Text style={styles.emptyText}>Aún no hay clientes.</Text>
                    </View>
                }
            />

            {/* FAB Create */}
            <Pressable
                onPress={async () => {
                    await ensureUsers();
                    setCreateOpen(true);
                }}
                style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
                accessibilityLabel="Crear cliente"
            >
                <Ionicons name="add" size={22} color="#fff" />
            </Pressable>

            {/* =========================
          CREATE MODAL
         ========================= */}
            <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
                <View style={styles.modalOverlay}>
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                        <View style={styles.modalCard}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Crear cliente</Text>
                                <Pressable onPress={() => setCreateOpen(false)} style={styles.modalClose}>
                                    <Ionicons name="close" size={18} color={COLORS.text} />
                                </Pressable>
                            </View>

                            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                {/* Assignee */}
                                <Pressable onPress={openUserPickerForCreate} style={({ pressed }) => [styles.selectRow, pressed && styles.selectRowPressed]}>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text style={styles.selectLabel}>Asignar a</Text>
                                        <Text style={styles.selectValue} numberOfLines={1}>
                                            {cAssigneeId
                                                ? selectedCreateUser
                                                    ? `${selectedCreateUser.name} (${selectedCreateUser.email})`
                                                    : cAssigneeId
                                                : "Sin asignar"}
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                                </Pressable>

                                <View style={styles.grid2}>
                                    <View style={styles.field}>
                                        <Text style={styles.label}>Nombre</Text>
                                        <TextInput value={cName} onChangeText={setCName} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>

                                    <View style={styles.field}>
                                        <Text style={styles.label}>Negocio</Text>
                                        <TextInput value={cBusiness} onChangeText={setCBusiness} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>
                                </View>

                                <View style={styles.grid2}>
                                    <View style={styles.field}>
                                        <Text style={styles.label}>Teléfono *</Text>
                                        <TextInput value={cPhone} onChangeText={setCPhone} keyboardType="phone-pad" placeholder="5591..." placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>

                                    <View style={styles.field}>
                                        <Text style={styles.label}>Dirección</Text>
                                        <TextInput value={cAddress} onChangeText={setCAddress} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>
                                </View>

                                <View style={styles.field}>
                                    <Text style={styles.label}>Google Maps *</Text>
                                    <TextInput value={cMapsUrl} onChangeText={setCMapsUrl} autoCapitalize="none" placeholder="https://maps.google.com/..." placeholderTextColor={COLORS.muted} style={styles.input} />
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

            {/* =========================
          EDIT MODAL
         ========================= */}
            <Modal visible={editOpen} transparent animationType="fade" onRequestClose={cancelEdit}>
                <View style={styles.modalOverlay}>
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                        <View style={styles.modalCard}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Editar</Text>
                                <Pressable onPress={cancelEdit} style={styles.modalClose}>
                                    <Ionicons name="close" size={18} color={COLORS.text} />
                                </Pressable>
                            </View>

                            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                {/* Assignee */}
                                <Pressable onPress={openUserPickerForEdit} style={({ pressed }) => [styles.selectRow, pressed && styles.selectRowPressed]}>
                                    <View style={{ flex: 1, gap: 2 }}>
                                        <Text style={styles.selectLabel}>Asignado a</Text>
                                        <Text style={styles.selectValue} numberOfLines={1}>
                                            {eAssigneeId
                                                ? selectedEditUser
                                                    ? `${selectedEditUser.name} (${selectedEditUser.email})`
                                                    : eAssigneeId
                                                : "Sin asignar"}
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                                </Pressable>

                                <View style={styles.grid2}>
                                    <View style={styles.field}>
                                        <Text style={styles.label}>Nombre</Text>
                                        <TextInput value={eName} onChangeText={setEName} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>

                                    <View style={styles.field}>
                                        <Text style={styles.label}>Negocio</Text>
                                        <TextInput value={eBusiness} onChangeText={setEBusiness} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>
                                </View>

                                <View style={styles.grid2}>
                                    <View style={styles.field}>
                                        <Text style={styles.label}>Teléfono *</Text>
                                        <TextInput value={ePhone} onChangeText={setEPhone} keyboardType="phone-pad" placeholder="5591..." placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>

                                    <View style={styles.field}>
                                        <Text style={styles.label}>Dirección</Text>
                                        <TextInput value={eAddress} onChangeText={setEAddress} placeholder="Opcional" placeholderTextColor={COLORS.muted} style={styles.input} />
                                    </View>
                                </View>

                                <View style={styles.field}>
                                    <Text style={styles.label}>Google Maps *</Text>
                                    <TextInput value={eMapsUrl} onChangeText={setEMapsUrl} autoCapitalize="none" placeholder="https://maps.google.com/..." placeholderTextColor={COLORS.muted} style={styles.input} />
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
          USER PICKER MODAL
         ========================= */}
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
                                    placeholder="Buscar user…"
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
                                {/* Opción: sin asignar (solo para create/edit) */}
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
                                        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                                    </Pressable>
                                ) : null}

                                {pickerUsers.map((u) => (
                                    <Pressable key={u.id} onPress={() => onPickUser(u)} style={({ pressed }) => [styles.userRow, pressed && styles.userRowPressed]}>
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
                                        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
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

    header: {
        paddingHorizontal: 16,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    hTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.5 },
    hSub: { color: COLORS.muted, fontSize: 12, fontWeight: "800", marginTop: 4 },
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

    listContent: { paddingHorizontal: 16, paddingBottom: 120, gap: 12 },

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
    },
    pillText: { fontSize: 12, fontWeight: "900", textTransform: "lowercase" },
    pillPending: { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.35)" },
    pillTextPending: { color: "#FDE68A" },
    pillVisited: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)" },
    pillTextVisited: { color: "#86EFAC" },
    pillRejected: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)" },
    pillTextRejected: { color: "#FCA5A5" },

    infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    infoText: { flex: 1, color: COLORS.text, opacity: 0.9, fontSize: 12, fontWeight: "700" },

    assignedRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
    assignedText: { flex: 1, color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4 },
    actionsLeft: { flexDirection: "row", alignItems: "center", gap: 10 },

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

    empty: { marginTop: 40, alignItems: "center", gap: 10 },
    emptySmall: { paddingVertical: 10, alignItems: "center" },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "900" },

    fab: {
        position: "absolute",
        right: 16,
        bottom: 18,
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

    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" },
    modalWrap: { width: "100%" },
    modalCard: {
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        maxHeight: "85%",
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

    selectRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 16, backgroundColor: "#0F172A", borderWidth: 1, borderColor: COLORS.border },
    selectRowPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    selectLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    selectValue: { color: COLORS.text, fontSize: 13, fontWeight: "900", marginTop: 2 },

    errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(248,113,113,0.4)", backgroundColor: "rgba(248,113,113,0.10)" },
    errorText: { color: COLORS.rejected, fontSize: 12, fontWeight: "900", flex: 1 },

    ghostBtn: { flex: 1, height: 50, borderRadius: 16, paddingHorizontal: 14, backgroundColor: "#0F172A", borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10 },
    ghostBtnText: { color: COLORS.text, fontWeight: "900", fontSize: 14 },
    primaryBtn: { flex: 1, height: 50, borderRadius: 16, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, shadowColor: "#14B8A6", shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
    primaryBtnText: { color: "#fff", fontWeight: "900", fontSize: 14 },
    btnPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    btnDisabled: { opacity: 0.55 },
});