import { Ionicons } from "@expo/vector-icons";
import { doc, updateDoc } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    FlatList,
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

import { db } from "../../config/firebase";
import { listUsers, updateUserRatePerVisit, upsertUserDoc } from "../../data/repositories/usersRepo";
import type { UserDoc } from "../../types/models";

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

function onlyNumberLike(text: string) {
    // permite "" y números tipo "50" "50.5"
    const t = text.replace(",", ".").trim();
    if (!t) return "";
    const cleaned = t.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length <= 2) return cleaned;
    return `${parts[0]}.${parts.slice(1).join("")}`;
}

function normalizePhone(raw: string) {
    return (raw ?? "").replace(/\D+/g, "");
}

function safeNumber(n: any, fallback = 0) {
    return typeof n === "number" && isFinite(n) ? n : fallback;
}

function getRatePerVisit(u: UserDoc) {
    const anyU: any = u as any;
    // compat: ratePerVisit (nuevo) o visitFee (viejo)
    return safeNumber(anyU.ratePerVisit ?? anyU.visitFee, 0);
}

function getWhatsappPhone(u: UserDoc) {
    const anyU: any = u as any;
    return (anyU.whatsappPhone ?? anyU.phone ?? "").toString();
}

function buildWhatsAppUrl(phoneDigits: string) {
    const p = normalizePhone(phoneDigits);
    if (!p) return null;
    // wa.me solo acepta dígitos (con código país)
    return `https://wa.me/${p}`;
}

export default function AdminUsersScreen() {
    const insets = useSafeAreaInsets();

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [loading, setLoading] = useState(false);

    // search
    const [q, setQ] = useState("");

    // modal register
    const [openCreate, setOpenCreate] = useState(false);

    const [uid, setUid] = useState("");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [whatsappPhoneNew, setWhatsappPhoneNew] = useState("");
    const [ratePerVisitNew, setRatePerVisitNew] = useState("50"); // default

    const [err, setErr] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // ✅ edición de tarifa por usuario (estado local por uid)
    const [feeDraftById, setFeeDraftById] = useState<Record<string, string>>({});
    const [feeSavingById, setFeeSavingById] = useState<Record<string, boolean>>({});

    // ✅ modal edit user
    const [openEdit, setOpenEdit] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editWhatsapp, setEditWhatsapp] = useState("");
    const [editRate, setEditRate] = useState("0");
    const [editSaving, setEditSaving] = useState(false);

    // ✅ bloqueo por usuario
    const [blockSavingById, setBlockSavingById] = useState<Record<string, boolean>>({});

    const fabBottom = Math.max(18, insets.bottom + 18) + 10;

    const reload = async () => {
        setLoading(true);
        try {
            const u = await listUsers();
            setUsers(u);

            // inicializa drafts si no existen
            setFeeDraftById((prev) => {
                const next = { ...prev };
                for (const user of u) {
                    if (user.role !== "user") continue;
                    if (next[user.id] == null) next[user.id] = String(getRatePerVisit(user));
                }
                return next;
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        reload();
    }, []);

    const counts = useMemo(() => {
        const admins = users.filter((u) => u.role === "admin").length;
        const actives = users.filter((u) => !!u.active).length;
        const blocked = users.filter((u) => !u.active).length;
        return { total: users.length, admins, actives, blocked };
    }, [users]);

    const filteredUsers = useMemo(() => {
        const qt = q.trim().toLowerCase();
        if (!qt) return users;

        return users.filter((u) => {
            const anyU: any = u as any;
            const wa = safeText((anyU.whatsappPhone ?? "").toString());
            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.role)} ${wa} ${safeText(u.id)}`;
            return hay.includes(qt);
        });
    }, [users, q]);

    const resetCreateForm = () => {
        setUid("");
        setName("");
        setEmail("");
        setWhatsappPhoneNew("");
        setRatePerVisitNew("50");
        setErr(null);
    };

    const registerProfile = async () => {
        setErr(null);

        const cleanUid = uid.trim();
        const cleanName = name.trim();
        const cleanEmail = email.trim();
        const cleanWhatsapp = normalizePhone(whatsappPhoneNew);
        const rate = Number(onlyNumberLike(ratePerVisitNew)) || 0;

        if (!cleanUid) {
            setErr("UID es obligatorio. Copia el UID desde Firebase Auth.");
            return;
        }

        setSaving(true);
        try {
            const docData: UserDoc = {
                id: cleanUid,
                name: cleanName || "Usuario",
                email: cleanEmail,
                role: "user",
                active: true,
                createdAt: Date.now(),
                ratePerVisit: rate,
            };

            // ✅ guardamos también whatsappPhone (campo nuevo)
            await upsertUserDoc({ ...(docData as any), whatsappPhone: cleanWhatsapp });

            resetCreateForm();
            setOpenCreate(false);
            await reload();
        } catch (e: any) {
            setErr(e?.message ?? "Error registrando perfil");
        } finally {
            setSaving(false);
        }
    };

    const IconBtn = ({
        icon,
        onPress,
        disabled,
        tint,
        label,
        danger,
    }: {
        icon: any;
        onPress: () => void;
        disabled?: boolean;
        tint?: string;
        label: string;
        danger?: boolean;
    }) => {
        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                style={({ pressed }) => [
                    styles.iconBtn,
                    danger && styles.iconBtnDanger,
                    pressed && !disabled && styles.iconBtnPressed,
                    disabled && styles.iconBtnDisabled,
                ]}
                accessibilityLabel={label}
            >
                <Ionicons name={icon} size={18} color={tint ?? (danger ? COLORS.rejected : COLORS.text)} />
            </Pressable>
        );
    };

    const Pill = ({ role, active }: { role: string; active: boolean }) => {
        const roleStyle = role === "admin" ? styles.pillAdmin : styles.pillUser;
        const txtStyle = role === "admin" ? styles.pillTextAdmin : styles.pillTextUser;

        const st = active ? styles.pillActive : styles.pillBlocked;
        const stTxt = active ? styles.pillTextActive : styles.pillTextBlocked;

        return (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <View style={[styles.pill, roleStyle]}>
                    <Text style={[styles.pillText, txtStyle]}>{role}</Text>
                </View>
                <View style={[styles.pill, st]}>
                    <Text style={[styles.pillText, stTxt]}>{active ? "activo" : "bloqueado"}</Text>
                </View>
            </View>
        );
    };

    const saveFee = async (userId: string) => {
        const draft = feeDraftById[userId] ?? "";
        const rate = Number(onlyNumberLike(draft)) || 0;

        setFeeSavingById((p) => ({ ...p, [userId]: true }));
        try {
            await updateUserRatePerVisit(userId, rate);
            await reload();
        } catch (e: any) {
            console.log("[saveFee] error:", e?.code, e?.message);
            Alert.alert("Error", e?.message ?? "No se pudo guardar la tarifa");
        } finally {
            setFeeSavingById((p) => ({ ...p, [userId]: false }));
        }
    };

    const openWhatsApp = async (u: UserDoc) => {
        const phone = getWhatsappPhone(u);
        const url = buildWhatsAppUrl(phone);
        if (!url) {
            Alert.alert("Sin teléfono", "Este usuario no tiene teléfono de WhatsApp guardado.");
            return;
        }
        const ok = await Linking.canOpenURL(url);
        if (!ok) {
            Alert.alert("No se pudo abrir", "No se pudo abrir WhatsApp con ese número.");
            return;
        }
        await Linking.openURL(url);
    };

    const startEditUser = (u: UserDoc) => {
        setEditId(u.id);
        setEditName((u.name ?? "").toString());
        setEditWhatsapp(getWhatsappPhone(u));
        setEditRate(String(getRatePerVisit(u)));
        setOpenEdit(true);
    };

    const cancelEditUser = () => {
        setOpenEdit(false);
        setEditId(null);
        setEditName("");
        setEditWhatsapp("");
        setEditRate("0");
        setEditSaving(false);
    };

    const submitEditUser = async () => {
        if (!editId) return;

        const cleanName = editName.trim() || "Usuario";
        const cleanWhatsapp = normalizePhone(editWhatsapp);
        const rate = Number(onlyNumberLike(editRate)) || 0;

        setEditSaving(true);
        try {
            // ✅ guardamos TODO junto para evitar inconsistencias
            await updateDoc(doc(db, "users", editId), {
                name: cleanName,
                whatsappPhone: cleanWhatsapp,
                ratePerVisit: rate,
                updatedAt: Date.now(),
            } as any);

            // refresca drafts de fee
            setFeeDraftById((p) => ({ ...p, [editId]: String(rate) }));

            cancelEditUser();
            await reload();
        } catch (e: any) {
            console.log("[editUser] error:", e?.code, e?.message);
            Alert.alert("Error", e?.message ?? "No se pudo guardar el usuario");
        } finally {
            setEditSaving(false);
        }
    };

    const toggleBlockUser = async (u: UserDoc) => {
        const userId = u.id;
        const willBlock = !!u.active;

        Alert.alert(
            willBlock ? "Bloquear usuario" : "Desbloquear usuario",
            willBlock
                ? "¿Seguro que quieres bloquearlo? No podrá usar la app."
                : "¿Seguro que quieres desbloquearlo?",
            [
                { text: "Cancelar", style: "cancel" },
                {
                    text: willBlock ? "Bloquear" : "Desbloquear",
                    style: willBlock ? "destructive" : "default",
                    onPress: async () => {
                        setBlockSavingById((p) => ({ ...p, [userId]: true }));
                        try {
                            await updateDoc(doc(db, "users", userId), {
                                active: !willBlock,
                                updatedAt: Date.now(),
                            } as any);
                            await reload();
                        } catch (e: any) {
                            console.log("[toggleBlockUser] error:", e?.code, e?.message);
                            Alert.alert("Error", e?.message ?? "No se pudo actualizar el usuario");
                        } finally {
                            setBlockSavingById((p) => ({ ...p, [userId]: false }));
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            {/* Header */}
            <View style={[styles.header, { paddingTop: 10 }]}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.hTitle}>Usuarios</Text>
                    <Text style={styles.hSub} numberOfLines={1}>
                        Total <Text style={styles.hStrong}>{counts.total}</Text> · Activos{" "}
                        <Text style={styles.hStrong}>{counts.actives}</Text> · Bloq{" "}
                        <Text style={styles.hStrong}>{counts.blocked}</Text> · Admin{" "}
                        <Text style={styles.hStrong}>{counts.admins}</Text>
                    </Text>
                </View>

                <IconBtn
                    icon={loading ? "sync-outline" : "refresh-outline"}
                    label="Refrescar"
                    onPress={reload}
                    disabled={loading}
                />
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar por nombre, email, rol o WhatsApp…"
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
                data={filteredUsers}
                keyExtractor={(u) => u.id}
                contentContainerStyle={[styles.listContent, { paddingBottom: fabBottom + 90 }]}
                renderItem={({ item }) => {
                    const displayEmail = (item.email ?? "").trim();
                    const displayName = (item.name ?? "").trim() || "Usuario";
                    const wa = normalizePhone(getWhatsappPhone(item));

                    const isUser = item.role === "user";
                    const feeDraft = feeDraftById[item.id] ?? String(getRatePerVisit(item));
                    const feeSaving = !!feeSavingById[item.id];
                    const blockSaving = !!blockSavingById[item.id];

                    return (
                        <View style={styles.card}>
                            <View style={styles.cardTop}>
                                <View style={{ flex: 1, gap: 4 }}>
                                    <Text style={styles.userName} numberOfLines={1}>
                                        {displayName}
                                    </Text>

                                    {displayEmail ? (
                                        <Text style={styles.userEmail} numberOfLines={1}>
                                            {displayEmail}
                                        </Text>
                                    ) : (
                                        <Text style={styles.userEmailMuted}>Sin email</Text>
                                    )}

                                    {/* ✅ WhatsApp phone */}
                                    {wa ? (
                                        <View style={styles.phoneRow}>
                                            <Ionicons name="logo-whatsapp" size={14} color={COLORS.pending} />
                                            <Text style={styles.userPhone} numberOfLines={1}>
                                                {wa}
                                            </Text>
                                        </View>
                                    ) : (
                                        <Text style={styles.userEmailMuted}>Sin WhatsApp</Text>
                                    )}
                                </View>

                                <Pill role={item.role} active={!!item.active} />
                            </View>

                            <View style={styles.actionsRow}>
                                <View style={{ flexDirection: "row", gap: 10 }}>
                                    {/* ✅ WhatsApp */}
                                    <IconBtn
                                        icon="logo-whatsapp"
                                        label="WhatsApp"
                                        onPress={() => openWhatsApp(item)}
                                        disabled={!wa}
                                        tint={wa ? COLORS.pending : COLORS.muted}
                                    />

                                    {/* ✅ Edit user */}
                                    <IconBtn
                                        icon="create-outline"
                                        label="Editar usuario"
                                        onPress={() => startEditUser(item)}
                                    />

                                    {/* ✅ Block/unblock */}
                                    <IconBtn
                                        icon={item.active ? "lock-closed-outline" : "lock-open-outline"}
                                        label={item.active ? "Bloquear" : "Desbloquear"}
                                        onPress={() => toggleBlockUser(item)}
                                        disabled={blockSaving}
                                        danger={item.active}
                                    />
                                </View>

                                <View style={styles.createdAtPill}>
                                    <Ionicons name="time-outline" size={14} color={COLORS.muted} />
                                    <Text style={styles.createdAtText}>
                                        {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    );
                }}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="people-outline" size={24} color={COLORS.muted} />
                        <Text style={styles.emptyText}>
                            {q.trim() ? "No hay resultados con ese filtro." : "Aún no hay usuarios."}
                        </Text>
                    </View>
                }
            />

            {/* FAB */}
            <Pressable
                onPress={() => {
                    setOpenCreate(true);
                    setErr(null);
                }}
                style={({ pressed }) => [styles.fab, { bottom: fabBottom }, pressed && styles.fabPressed]}
                accessibilityLabel="Registrar perfil"
            >
                <Ionicons name="person-add" size={20} color="#fff" />
            </Pressable>

            {/* Modal Create */}
            <Modal visible={openCreate} transparent animationType="fade" onRequestClose={() => setOpenCreate(false)}>
                <View style={styles.modalOverlay}>
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                        <View style={styles.modalCard}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Registrar perfil</Text>
                                <Pressable
                                    onPress={() => {
                                        resetCreateForm();
                                        setOpenCreate(false);
                                    }}
                                    style={styles.modalClose}
                                >
                                    <Ionicons name="close" size={18} color={COLORS.text} />
                                </Pressable>
                            </View>

                            <Text style={styles.modalHint}>
                                Crea el usuario en Firebase Auth (email/password) → copia su UID → regístralo aquí.
                            </Text>

                            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                <View style={styles.field}>
                                    <Text style={styles.label}>UID *</Text>
                                    <TextInput
                                        placeholder="UID de Firebase Auth"
                                        placeholderTextColor={COLORS.muted}
                                        value={uid}
                                        onChangeText={setUid}
                                        autoCapitalize="none"
                                        style={styles.input}
                                    />
                                </View>

                                <View style={styles.grid2}>
                                    <View style={[styles.field, { flex: 1 }]}>
                                        <Text style={styles.label}>Nombre</Text>
                                        <TextInput
                                            placeholder="Opcional"
                                            placeholderTextColor={COLORS.muted}
                                            value={name}
                                            onChangeText={setName}
                                            style={styles.input}
                                        />
                                    </View>

                                    <View style={[styles.field, { flex: 1 }]}>
                                        <Text style={styles.label}>Email</Text>
                                        <TextInput
                                            placeholder="Opcional"
                                            placeholderTextColor={COLORS.muted}
                                            value={email}
                                            onChangeText={setEmail}
                                            autoCapitalize="none"
                                            style={styles.input}
                                        />
                                    </View>
                                </View>

                                {/* ✅ WhatsApp */}
                                <View style={styles.field}>
                                    <Text style={styles.label}>Teléfono WhatsApp</Text>
                                    <TextInput
                                        placeholder="Ej: +55 91 99999-9999"
                                        placeholderTextColor={COLORS.muted}
                                        value={whatsappPhoneNew}
                                        onChangeText={setWhatsappPhoneNew}
                                        keyboardType="phone-pad"
                                        style={styles.input}
                                    />
                                    <Text style={styles.hintSmall}>Se guarda como solo dígitos (con código país).</Text>
                                </View>

                                {/* ✅ tarifa inicial */}
                                <View style={styles.field}>
                                    <Text style={styles.label}>Tarifa por visita (R$)</Text>
                                    <TextInput
                                        placeholder="Ej: 50"
                                        placeholderTextColor={COLORS.muted}
                                        value={ratePerVisitNew}
                                        onChangeText={(t) => setRatePerVisitNew(onlyNumberLike(t))}
                                        keyboardType="numeric"
                                        style={styles.input}
                                    />
                                </View>

                                {err ? (
                                    <View style={styles.errorBox}>
                                        <Ionicons name="alert-circle-outline" size={16} color={COLORS.rejected} />
                                        <Text style={styles.errorText}>{err}</Text>
                                    </View>
                                ) : null}

                                <View style={{ flexDirection: "row", gap: 10 }}>
                                    <Pressable
                                        onPress={() => {
                                            resetCreateForm();
                                            setOpenCreate(false);
                                        }}
                                        style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed]}
                                        disabled={saving}
                                    >
                                        <Ionicons name="close-outline" size={18} color={COLORS.text} />
                                        <Text style={styles.ghostBtnText}>Cancelar</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={registerProfile}
                                        style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, saving && styles.btnDisabled]}
                                        disabled={saving}
                                    >
                                        <Ionicons name="save-outline" size={18} color="#fff" />
                                        <Text style={styles.primaryBtnText}>{saving ? "Guardando..." : "Registrar"}</Text>
                                    </Pressable>
                                </View>
                            </ScrollView>
                        </View>
                    </KeyboardAvoidingView>
                </View>
            </Modal>

            {/* Modal Edit */}
            <Modal visible={openEdit} transparent animationType="fade" onRequestClose={cancelEditUser}>
                <View style={styles.modalOverlay}>
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
                        <View style={styles.modalCard}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Editar usuario</Text>
                                <Pressable onPress={cancelEditUser} style={styles.modalClose}>
                                    <Ionicons name="close" size={18} color={COLORS.text} />
                                </Pressable>
                            </View>

                            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                                <View style={styles.field}>
                                    <Text style={styles.label}>Nombre</Text>
                                    <TextInput
                                        placeholder="Nombre"
                                        placeholderTextColor={COLORS.muted}
                                        value={editName}
                                        onChangeText={setEditName}
                                        style={styles.input}
                                    />
                                </View>

                                <View style={styles.field}>
                                    <Text style={styles.label}>Teléfono WhatsApp</Text>
                                    <TextInput
                                        placeholder="Ej: +55 91 99999-9999"
                                        placeholderTextColor={COLORS.muted}
                                        value={editWhatsapp}
                                        onChangeText={setEditWhatsapp}
                                        keyboardType="phone-pad"
                                        style={styles.input}
                                    />
                                    <Text style={styles.hintSmall}>Se guarda como solo dígitos (con código país).</Text>
                                </View>

                                <View style={styles.field}>
                                    <Text style={styles.label}>Tarifa por visita (R$)</Text>
                                    <TextInput
                                        placeholder="Ej: 50"
                                        placeholderTextColor={COLORS.muted}
                                        value={editRate}
                                        onChangeText={(t) => setEditRate(onlyNumberLike(t))}
                                        keyboardType="numeric"
                                        style={styles.input}
                                    />
                                </View>

                                <View style={{ flexDirection: "row", gap: 10 }}>
                                    <Pressable onPress={cancelEditUser} style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed]} disabled={editSaving}>
                                        <Ionicons name="close-outline" size={18} color={COLORS.text} />
                                        <Text style={styles.ghostBtnText}>Cancelar</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={submitEditUser}
                                        style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, editSaving && styles.btnDisabled]}
                                        disabled={editSaving}
                                    >
                                        <Ionicons name="save-outline" size={18} color="#fff" />
                                        <Text style={styles.primaryBtnText}>{editSaving ? "Guardando..." : "Guardar"}</Text>
                                    </Pressable>
                                </View>
                            </ScrollView>
                        </View>
                    </KeyboardAvoidingView>
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

    primary: "#2563EB",
    rejected: "#F87171",
    pending: "#25D366",
    purple: "#7C3AED",
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
    searchInput: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "700" },
    clearBtn: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    listContent: { paddingHorizontal: 16, gap: 12 },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 10,
    },
    cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },

    userName: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    userEmail: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    userEmailMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.7 },

    phoneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    userPhone: { color: COLORS.text, opacity: 0.9, fontSize: 12, fontWeight: "900" },

    // Fee editor
    feeRow: { flexDirection: "row", gap: 10, alignItems: "flex-end", marginTop: 2 },
    inputCompact: {
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "800",
    },
    saveFeeBtn: {
        height: 44,
        borderRadius: 14,
        paddingHorizontal: 14,
        backgroundColor: COLORS.primary,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
    },
    saveFeeText: { color: "#fff", fontWeight: "900", fontSize: 13 },

    actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 2 },

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

    createdAtPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        height: 32,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },
    createdAtText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },

    pill: {
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    pillText: { fontSize: 12, fontWeight: "900", textTransform: "lowercase" },
    pillAdmin: { backgroundColor: "rgba(124,58,237,0.16)", borderColor: "rgba(124,58,237,0.35)" },
    pillTextAdmin: { color: "#C4B5FD" },
    pillUser: { backgroundColor: "rgba(37,99,235,0.14)", borderColor: "rgba(37,99,235,0.35)" },
    pillTextUser: { color: "#93C5FD" },

    pillActive: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)" },
    pillTextActive: { color: "#86EFAC" },
    pillBlocked: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)" },
    pillTextBlocked: { color: "#FCA5A5" },

    empty: { marginTop: 40, alignItems: "center", gap: 10, paddingHorizontal: 16 },
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

    // Modal
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
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 10 },
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
    modalHint: { color: COLORS.muted, fontSize: 12, fontWeight: "800", marginBottom: 10, lineHeight: 16 },
    hintSmall: { color: COLORS.muted, fontSize: 11, fontWeight: "800", opacity: 0.85, marginTop: 6 },

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
});