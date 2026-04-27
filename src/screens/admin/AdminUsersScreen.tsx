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
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AdminBackground from "../../components/admin/AdminBackground";
import AdminCreateUserModal from "../../components/admin/AdminCreateUserModal";

import { db } from "../../config/firebase";
import { listUsers, updateUserRatePerVisit } from "../../data/repositories/usersRepo";
import type { UserBillingMode, UserDoc, UserGeoCoverage } from "../../types/models";

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

function safeString(x?: string | null) {
    return (x ?? "").trim();
}

function normalizeLooseText(value?: string | null) {
    return safeString(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\s\-\/]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function onlyNumberLike(text: string) {
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
    return safeNumber(anyU.ratePerVisit ?? anyU.visitFee, 0);
}

function getBillingMode(u: UserDoc): UserBillingMode {
    return (u as any).billingMode === "weekly_subscription" ? "weekly_subscription" : "per_visit";
}

function getWeeklySubscriptionAmount(u: UserDoc) {
    return safeNumber((u as any).weeklySubscriptionAmount, 0);
}

function getWeeklySubscriptionCost(u: UserDoc) {
    return safeNumber((u as any).weeklySubscriptionCost, 0);
}

function getWhatsappPhone(u: UserDoc) {
    const anyU: any = u as any;
    return (anyU.whatsappPhone ?? anyU.phone ?? "").toString();
}

function buildWhatsAppUrl(phoneDigits: string) {
    const p = normalizePhone(phoneDigits);
    if (!p) return null;
    return `https://wa.me/${p}`;
}

function getGeoCoverageList(u: UserDoc): UserGeoCoverage[] {
    return Array.isArray((u as any)?.geoCoverage)
        ? ((u as any).geoCoverage as UserGeoCoverage[])
        : [];
}

function getAutoAssignEnabled(u: UserDoc) {
    return !!u.autoAssignEnabled;
}

function getAutoAssignDailyLimit(u: UserDoc) {
    return typeof u.autoAssignDailyLimit === "number" && isFinite(u.autoAssignDailyLimit)
        ? u.autoAssignDailyLimit
        : null;
}

function makeCoverageId(stateLabel: string, cityLabel: string) {
    return `city__${normalizeLooseText(stateLabel)}__${normalizeLooseText(cityLabel)}`;
}

function makeCountryCoverageItem(countryLabel: string, countryNormalized: string): UserGeoCoverage {
    const now = Date.now();

    return {
        id: `country__${countryNormalized}`,
        type: "country",
        countryLabel,
        countryNormalized,
        stateLabel: "",
        stateNormalized: "",
        cityLabel: "",
        cityNormalized: "",
        displayLabel: countryLabel,
        source: "manual",
        active: true,
        createdAt: now,
        updatedAt: now,
    };
}

function makeCoverageItem(stateLabel: string, cityLabel: string): UserGeoCoverage | null {
    const cleanState = safeString(stateLabel);
    const cleanCity = safeString(cityLabel);

    if (!cleanState || !cleanCity) return null;

    const stateNormalized = normalizeLooseText(cleanState);
    const cityNormalized = normalizeLooseText(cleanCity);

    const now = Date.now();

    return {
        id: makeCoverageId(cleanState, cleanCity),
        type: "city",
        countryLabel: "Brasil",
        countryNormalized: "brasil",
        stateLabel: cleanState,
        stateNormalized,
        cityLabel: cleanCity,
        cityNormalized,
        displayLabel: `${cleanState} · ${cleanCity}`,
        source: "manual",
        active: true,
        createdAt: now,
        updatedAt: now,
    };
}

function normalizeCoverageList(items: UserGeoCoverage[]) {
    const seen = new Set<string>();
    const out: UserGeoCoverage[] = [];

    for (const item of items) {
        if (item?.type === "country") {
            if (!item.countryLabel || !item.countryNormalized) continue;
        } else if (!item?.stateLabel || !item?.cityLabel) {
            continue;
        }
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
    }

    return out;
}

const BRAZIL_STATES = [
    "Acre",
    "Alagoas",
    "Amapá",
    "Amazonas",
    "Bahia",
    "Ceará",
    "Distrito Federal",
    "Espírito Santo",
    "Goiás",
    "Maranhão",
    "Mato Grosso",
    "Mato Grosso do Sul",
    "Minas Gerais",
    "Pará",
    "Paraíba",
    "Paraná",
    "Pernambuco",
    "Piauí",
    "Rio de Janeiro",
    "Rio Grande do Norte",
    "Rio Grande do Sul",
    "Rondônia",
    "Roraima",
    "Santa Catarina",
    "São Paulo",
    "Sergipe",
    "Tocantins",
];

export default function AdminUsersScreen() {
    const insets = useSafeAreaInsets();

    const [users, setUsers] = useState<UserDoc[]>([]);
    const [loading, setLoading] = useState(false);

    const [q, setQ] = useState("");

    const [openCreate, setOpenCreate] = useState(false);

    const [feeDraftById, setFeeDraftById] = useState<Record<string, string>>({});
    const [feeSavingById, setFeeSavingById] = useState<Record<string, boolean>>({});

    const [openEdit, setOpenEdit] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editWhatsapp, setEditWhatsapp] = useState("");
    const [editRate, setEditRate] = useState("0");
    const [editBillingMode, setEditBillingMode] = useState<UserBillingMode>("per_visit");
    const [editWeeklySubscriptionAmount, setEditWeeklySubscriptionAmount] = useState("0");
    const [editWeeklySubscriptionCost, setEditWeeklySubscriptionCost] = useState("0");
    const [editWeeklySubscriptionActive, setEditWeeklySubscriptionActive] = useState(true);
    const [editCoverageState, setEditCoverageState] = useState("");
    const [editCoverageCity, setEditCoverageCity] = useState("");
    const [editCoverageList, setEditCoverageList] = useState<UserGeoCoverage[]>([]);
    const [editAutoAssignEnabled, setEditAutoAssignEnabled] = useState(false);
    const [editAutoAssignDailyLimit, setEditAutoAssignDailyLimit] = useState("");
    const [editSaving, setEditSaving] = useState(false);

    const [blockSavingById, setBlockSavingById] = useState<Record<string, boolean>>({});

    const fabBottom = Math.max(18, insets.bottom + 18) + 10;

    const reload = async () => {
        setLoading(true);
        try {
            const u = await listUsers();
            setUsers(u);

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
        const autoAssign = users.filter((u) => u.role === "user" && !!u.autoAssignEnabled).length;
        return { total: users.length, admins, actives, blocked, autoAssign };
    }, [users]);

    const filteredUsers = useMemo(() => {
        const qt = q.trim().toLowerCase();
        if (!qt) return users;

        return users.filter((u) => {
            const wa = safeText(getWhatsappPhone(u));
            const geoBlob = getGeoCoverageList(u)
                .map((x) => `${safeText(x.stateLabel)} ${safeText(x.cityLabel)} ${safeText(x.displayLabel)}`)
                .join(" ");

            const autoBlob = `${u.autoAssignEnabled ? "auto on" : "auto off"} ${safeText(
                String(u.autoAssignDailyLimit ?? "")
            )}`;

            const hay = `${safeText(u.name)} ${safeText(u.email)} ${safeText(u.role)} ${wa} ${safeText(
                u.id
            )} ${geoBlob} ${autoBlob}`;

            return hay.includes(qt);
        });
    }, [users, q]);

    const addCoverageToEdit = () => {
        const item = makeCoverageItem(editCoverageState, editCoverageCity);
        if (!item) {
            Alert.alert("Datos faltantes", "Debes indicar estado y ciudad.");
            return;
        }

        setEditCoverageList((prev) => normalizeCoverageList([...prev, item]));
        setEditCoverageCity("");
    };

    const addPanamaCoverageToEdit = () => {
        setEditCoverageList((prev) =>
            normalizeCoverageList([
                ...prev,
                makeCountryCoverageItem("Panama", "panama"),
            ])
        );
    };

    const removeCoverageFromEdit = (id: string) => {
        setEditCoverageList((prev) => prev.filter((x) => x.id !== id));
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
                <Ionicons
                    name={icon}
                    size={18}
                    color={tint ?? (danger ? COLORS.rejected : COLORS.text)}
                />
            </Pressable>
        );
    };

    const Pill = ({ role, active }: { role: string; active: boolean }) => {
        const roleStyle = role === "admin" ? styles.pillAdmin : styles.pillUser;
        const txtStyle = role === "admin" ? styles.pillTextAdmin : styles.pillTextUser;

        const st = active ? styles.pillActive : styles.pillBlocked;
        const stTxt = active ? styles.pillTextActive : styles.pillTextBlocked;

        return (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
        setEditBillingMode(getBillingMode(u));
        setEditWeeklySubscriptionAmount(String(getWeeklySubscriptionAmount(u)));
        setEditWeeklySubscriptionCost(String(getWeeklySubscriptionCost(u)));
        setEditWeeklySubscriptionActive((u as any).weeklySubscriptionActive !== false);
        setEditCoverageState("");
        setEditCoverageCity("");
        setEditCoverageList(getGeoCoverageList(u));
        setEditAutoAssignEnabled(getAutoAssignEnabled(u));
        setEditAutoAssignDailyLimit(
            getAutoAssignDailyLimit(u) != null ? String(getAutoAssignDailyLimit(u)) : ""
        );
        setOpenEdit(true);
    };

    const cancelEditUser = () => {
        setOpenEdit(false);
        setEditId(null);
        setEditName("");
        setEditWhatsapp("");
        setEditRate("0");
        setEditBillingMode("per_visit");
        setEditWeeklySubscriptionAmount("0");
        setEditWeeklySubscriptionCost("0");
        setEditWeeklySubscriptionActive(true);
        setEditCoverageState("");
        setEditCoverageCity("");
        setEditCoverageList([]);
        setEditAutoAssignEnabled(false);
        setEditAutoAssignDailyLimit("");
        setEditSaving(false);
    };

    const submitEditUser = async () => {
        if (!editId) return;

        const cleanName = editName.trim() || "Usuario";
        const cleanWhatsapp = normalizePhone(editWhatsapp);
        const rate = Number(onlyNumberLike(editRate)) || 0;
        const weeklySubscriptionAmount = Number(onlyNumberLike(editWeeklySubscriptionAmount)) || 0;
        const weeklySubscriptionCost = Number(onlyNumberLike(editWeeklySubscriptionCost)) || 0;
        const normalizedCoverage = normalizeCoverageList(editCoverageList);
        const dailyLimitRaw = onlyNumberLike(editAutoAssignDailyLimit);
        const dailyLimit = dailyLimitRaw ? Number(dailyLimitRaw) : null;

        if (editAutoAssignEnabled && !normalizedCoverage.length) {
            Alert.alert(
                "Cobertura requerida",
                "Para activar asignación automática, agrega al menos una cobertura."
            );
            return;
        }

        setEditSaving(true);
        try {
            await updateDoc(doc(db, "users", editId), {
                name: cleanName,
                whatsappPhone: cleanWhatsapp,
                ratePerVisit: rate,
                billingMode: editBillingMode,
                weeklySubscriptionAmount,
                weeklySubscriptionCost,
                weeklySubscriptionActive: editWeeklySubscriptionActive,
                geoCoverage: normalizedCoverage,
                primaryGeoCoverageLabel: normalizedCoverage[0]?.displayLabel ?? null,

                autoAssignEnabled: editAutoAssignEnabled,
                autoAssignDailyLimit: editAutoAssignEnabled ? dailyLimit : null,
                autoAssignPriority: 1,
                assignmentMode: "round_robin",

                updatedAt: Date.now(),
            } as any);

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
            <AdminBackground>
                <View style={[styles.header, { paddingTop: 10 }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.hTitle}>Usuarios</Text>
                        <Text style={styles.hSub} numberOfLines={1}>
                            Total <Text style={styles.hStrong}>{counts.total}</Text> · Activos{" "}
                            <Text style={styles.hStrong}>{counts.actives}</Text> · Bloq{" "}
                            <Text style={styles.hStrong}>{counts.blocked}</Text> · Admin{" "}
                            <Text style={styles.hStrong}>{counts.admins}</Text> · Auto{" "}
                            <Text style={styles.hStrong}>{counts.autoAssign}</Text>
                        </Text>
                    </View>

                    <IconBtn
                        icon={loading ? "sync-outline" : "refresh-outline"}
                        label="Refrescar"
                        onPress={reload}
                        disabled={loading}
                    />
                </View>

                <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                    <TextInput
                        value={q}
                        onChangeText={setQ}
                        placeholder="Buscar por nombre, email, rol, WhatsApp, cobertura o auto…"
                        placeholderTextColor={COLORS.muted}
                        style={styles.searchInput}
                    />
                    {!!q ? (
                        <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                            <Ionicons name="close" size={18} color={COLORS.text} />
                        </Pressable>
                    ) : null}
                </View>

                <FlatList
                    data={filteredUsers}
                    keyExtractor={(u) => u.id}
                    contentContainerStyle={[styles.listContent, { paddingBottom: fabBottom + 90 }]}
                    renderItem={({ item }) => {
                        const displayEmail = (item.email ?? "").trim();
                        const displayName = (item.name ?? "").trim() || "Usuario";
                        const wa = normalizePhone(getWhatsappPhone(item));
                        const geoCoverage = getGeoCoverageList(item);

                        const feeSaving = !!feeSavingById[item.id];
                        const blockSaving = !!blockSavingById[item.id];
                        const autoEnabled = getAutoAssignEnabled(item);
                        const autoLimit = getAutoAssignDailyLimit(item);

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

                                <View style={styles.coverageSection}>
                                    <Text style={styles.coverageTitle}>Cobertura</Text>

                                    {geoCoverage.length ? (
                                        <View style={styles.coverageWrap}>
                                            {geoCoverage.map((coverage) => (
                                                <View key={coverage.id} style={styles.coveragePill}>
                                                    <Ionicons
                                                        name="location-outline"
                                                        size={13}
                                                        color="#93C5FD"
                                                    />
                                                    <Text style={styles.coveragePillText} numberOfLines={1}>
                                                        {coverage.displayLabel}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>
                                    ) : (
                                        <Text style={styles.coverageEmpty}>
                                            Sin coberturas configuradas
                                        </Text>
                                    )}
                                </View>

                                {item.role === "user" ? (
                                    <View style={styles.autoAssignSection}>
                                        <Text style={styles.coverageTitle}>Asignación automática</Text>

                                        <View style={styles.autoAssignRow}>
                                            <View
                                                style={[
                                                    styles.autoAssignPill,
                                                    autoEnabled
                                                        ? styles.autoAssignPillActive
                                                        : styles.autoAssignPillInactive,
                                                ]}
                                            >
                                                <Ionicons
                                                    name={autoEnabled ? "flash-outline" : "pause-outline"}
                                                    size={13}
                                                    color={autoEnabled ? "#93C5FD" : COLORS.muted}
                                                />
                                                <Text
                                                    style={[
                                                        styles.autoAssignPillText,
                                                        autoEnabled
                                                            ? styles.autoAssignPillTextActive
                                                            : styles.autoAssignPillTextInactive,
                                                    ]}
                                                >
                                                    {autoEnabled ? "ACTIVA" : "INACTIVA"}
                                                </Text>
                                            </View>

                                            {autoEnabled && autoLimit != null ? (
                                                <View style={styles.autoAssignLimitPill}>
                                                    <Ionicons
                                                        name="speedometer-outline"
                                                        size={13}
                                                        color="#C4B5FD"
                                                    />
                                                    <Text style={styles.autoAssignLimitText}>
                                                        Límite {autoLimit}/día
                                                    </Text>
                                                </View>
                                            ) : null}
                                        </View>
                                    </View>
                                ) : null}

                                <View style={styles.actionsRow}>
                                    <View style={{ flexDirection: "row", gap: 10 }}>
                                        <IconBtn
                                            icon="logo-whatsapp"
                                            label="WhatsApp"
                                            onPress={() => openWhatsApp(item)}
                                            disabled={!wa}
                                            tint={wa ? COLORS.pending : COLORS.muted}
                                        />

                                        <IconBtn
                                            icon="create-outline"
                                            label="Editar usuario"
                                            onPress={() => startEditUser(item)}
                                        />

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

                <Pressable
                    onPress={() => setOpenCreate(true)}
                    style={({ pressed }) => [styles.fab, { bottom: fabBottom }, pressed && styles.fabPressed]}
                    accessibilityLabel="Registrar perfil"
                >
                    <Ionicons name="person-add" size={20} color="#fff" />
                </Pressable>

                <AdminCreateUserModal
                    open={openCreate}
                    onClose={() => setOpenCreate(false)}
                    onCreated={reload}
                />

                <Modal visible={openEdit} transparent animationType="fade" onRequestClose={cancelEditUser}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === "ios" ? "padding" : undefined}
                            style={styles.modalWrap}
                        >
                            <View style={styles.modalCard}>
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>Editar usuario</Text>
                                    <Pressable onPress={cancelEditUser} style={styles.modalClose}>
                                        <Ionicons name="close" size={18} color={COLORS.text} />
                                    </Pressable>
                                </View>

                                <ScrollView
                                    contentContainerStyle={{ gap: 12, paddingBottom: 6 }}
                                    showsVerticalScrollIndicator={false}
                                >
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
                                        <Text style={styles.hintSmall}>
                                            Se guarda como solo dígitos (con código país).
                                        </Text>
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

                                    <View style={styles.billingEditor}>
                                        <Text style={styles.coverageEditorTitle}>Modelo contable</Text>

                                        <View style={styles.billingModeRow}>
                                            <Pressable
                                                onPress={() => setEditBillingMode("per_visit")}
                                                style={({ pressed }) => [
                                                    styles.billingModeBtn,
                                                    editBillingMode === "per_visit" && styles.billingModeBtnActive,
                                                    pressed && styles.btnPressed,
                                                ]}
                                            >
                                                <Ionicons
                                                    name="person-outline"
                                                    size={15}
                                                    color={editBillingMode === "per_visit" ? "#93C5FD" : COLORS.muted}
                                                />
                                                <Text
                                                    style={[
                                                        styles.billingModeText,
                                                        editBillingMode === "per_visit" && styles.billingModeTextActive,
                                                    ]}
                                                >
                                                    Por visita
                                                </Text>
                                            </Pressable>

                                            <Pressable
                                                onPress={() => setEditBillingMode("weekly_subscription")}
                                                style={({ pressed }) => [
                                                    styles.billingModeBtn,
                                                    editBillingMode === "weekly_subscription" && styles.billingModeBtnActive,
                                                    pressed && styles.btnPressed,
                                                ]}
                                            >
                                                <Ionicons
                                                    name="calendar-outline"
                                                    size={15}
                                                    color={
                                                        editBillingMode === "weekly_subscription"
                                                            ? "#93C5FD"
                                                            : COLORS.muted
                                                    }
                                                />
                                                <Text
                                                    style={[
                                                        styles.billingModeText,
                                                        editBillingMode === "weekly_subscription" &&
                                                        styles.billingModeTextActive,
                                                    ]}
                                                >
                                                    Semanal
                                                </Text>
                                            </Pressable>
                                        </View>

                                        {editBillingMode === "weekly_subscription" ? (
                                            <>
                                                <View style={styles.grid2}>
                                                    <View style={[styles.field, { flex: 1 }]}>
                                                        <Text style={styles.label}>Cuota semanal (R$)</Text>
                                                        <TextInput
                                                            placeholder="Ej: 400"
                                                            placeholderTextColor={COLORS.muted}
                                                            value={editWeeklySubscriptionAmount}
                                                            onChangeText={(t) =>
                                                                setEditWeeklySubscriptionAmount(onlyNumberLike(t))
                                                            }
                                                            keyboardType="numeric"
                                                            style={styles.input}
                                                        />
                                                    </View>

                                                    <View style={[styles.field, { flex: 1 }]}>
                                                        <Text style={styles.label}>Inversión semanal (R$)</Text>
                                                        <TextInput
                                                            placeholder="Ej: 200"
                                                            placeholderTextColor={COLORS.muted}
                                                            value={editWeeklySubscriptionCost}
                                                            onChangeText={(t) =>
                                                                setEditWeeklySubscriptionCost(onlyNumberLike(t))
                                                            }
                                                            keyboardType="numeric"
                                                            style={styles.input}
                                                        />
                                                    </View>
                                                </View>

                                                <View style={styles.autoAssignEditHeader}>
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={styles.label}>Suscripción activa por defecto</Text>
                                                        <Text style={styles.hintSmall}>
                                                            Si una semana no paga, luego la marcamos como no pagada.
                                                        </Text>
                                                    </View>
                                                    <Switch
                                                        value={editWeeklySubscriptionActive}
                                                        onValueChange={setEditWeeklySubscriptionActive}
                                                        trackColor={{
                                                            false: "rgba(255,255,255,0.12)",
                                                            true: "rgba(37,99,235,0.45)",
                                                        }}
                                                        thumbColor={editWeeklySubscriptionActive ? "#2563EB" : "#9CA3AF"}
                                                    />
                                                </View>
                                            </>
                                        ) : null}
                                    </View>

                                    <View style={styles.coverageEditor}>
                                        <Text style={styles.coverageEditorTitle}>Cobertura geográfica</Text>

                                        <Pressable
                                            onPress={addPanamaCoverageToEdit}
                                            style={({ pressed }) => [
                                                styles.countryCoverageBtn,
                                                pressed && styles.btnPressed,
                                            ]}
                                        >
                                            <Ionicons name="flag-outline" size={16} color="#93C5FD" />
                                            <Text style={styles.countryCoverageBtnText}>
                                                Agregar Panama completo
                                            </Text>
                                        </Pressable>

                                        <View style={styles.field}>
                                            <Text style={styles.label}>Estado</Text>
                                            <ScrollView
                                                horizontal
                                                showsHorizontalScrollIndicator={false}
                                                contentContainerStyle={styles.stateRow}
                                            >
                                                {BRAZIL_STATES.map((state) => {
                                                    const active = editCoverageState === state;
                                                    return (
                                                        <Pressable
                                                            key={state}
                                                            onPress={() => setEditCoverageState(state)}
                                                            style={({ pressed }) => [
                                                                styles.statePill,
                                                                active && styles.statePillActive,
                                                                pressed && styles.btnPressed,
                                                            ]}
                                                        >
                                                            <Text
                                                                style={[
                                                                    styles.statePillText,
                                                                    active && styles.statePillTextActive,
                                                                ]}
                                                            >
                                                                {state}
                                                            </Text>
                                                        </Pressable>
                                                    );
                                                })}
                                            </ScrollView>
                                        </View>

                                        <View style={styles.field}>
                                            <Text style={styles.label}>Ciudad / municipio</Text>
                                            <View style={styles.addCoverageRow}>
                                                <TextInput
                                                    placeholder="Ej: Abadiânia"
                                                    placeholderTextColor={COLORS.muted}
                                                    value={editCoverageCity}
                                                    onChangeText={setEditCoverageCity}
                                                    style={[styles.input, { flex: 1 }]}
                                                />
                                                <Pressable
                                                    onPress={addCoverageToEdit}
                                                    style={({ pressed }) => [
                                                        styles.addCoverageBtn,
                                                        pressed && styles.btnPressed,
                                                    ]}
                                                >
                                                    <Ionicons name="add" size={18} color="#fff" />
                                                </Pressable>
                                            </View>
                                        </View>

                                        {editCoverageList.length ? (
                                            <View style={styles.coverageWrap}>
                                                {editCoverageList.map((coverage) => (
                                                    <View key={coverage.id} style={styles.coveragePillEditable}>
                                                        <Text style={styles.coveragePillText} numberOfLines={1}>
                                                            {coverage.displayLabel}
                                                        </Text>
                                                        <Pressable
                                                            onPress={() => removeCoverageFromEdit(coverage.id)}
                                                            style={styles.coverageRemoveBtn}
                                                        >
                                                            <Ionicons name="close" size={12} color={COLORS.text} />
                                                        </Pressable>
                                                    </View>
                                                ))}
                                            </View>
                                        ) : (
                                            <Text style={styles.coverageEmpty}>Sin coberturas aún</Text>
                                        )}
                                    </View>

                                    {editId && users.find((u) => u.id === editId)?.role === "user" ? (
                                        <View style={styles.autoAssignEditCard}>
                                            <View style={styles.autoAssignEditHeader}>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={styles.coverageEditorTitle}>
                                                        Asignación automática
                                                    </Text>
                                                    <Text style={styles.hintSmall}>
                                                        Si está activa, este usuario recibirá leads automáticamente según su cobertura.
                                                    </Text>
                                                </View>

                                                <Switch
                                                    value={editAutoAssignEnabled}
                                                    onValueChange={setEditAutoAssignEnabled}
                                                    trackColor={{
                                                        false: "rgba(255,255,255,0.12)",
                                                        true: "rgba(37,99,235,0.45)",
                                                    }}
                                                    thumbColor={editAutoAssignEnabled ? "#2563EB" : "#9CA3AF"}
                                                />
                                            </View>

                                            <View style={styles.autoAssignRow}>
                                                <View
                                                    style={[
                                                        styles.autoAssignPill,
                                                        editAutoAssignEnabled
                                                            ? styles.autoAssignPillActive
                                                            : styles.autoAssignPillInactive,
                                                    ]}
                                                >
                                                    <Ionicons
                                                        name={editAutoAssignEnabled ? "flash-outline" : "pause-outline"}
                                                        size={13}
                                                        color={editAutoAssignEnabled ? "#93C5FD" : COLORS.muted}
                                                    />
                                                    <Text
                                                        style={[
                                                            styles.autoAssignPillText,
                                                            editAutoAssignEnabled
                                                                ? styles.autoAssignPillTextActive
                                                                : styles.autoAssignPillTextInactive,
                                                        ]}
                                                    >
                                                        {editAutoAssignEnabled ? "ACTIVA" : "INACTIVA"}
                                                    </Text>
                                                </View>
                                            </View>

                                            {editAutoAssignEnabled ? (
                                                <View style={styles.field}>
                                                    <Text style={styles.label}>Límite diario (opcional)</Text>
                                                    <TextInput
                                                        placeholder="Ej: 20"
                                                        placeholderTextColor={COLORS.muted}
                                                        value={editAutoAssignDailyLimit}
                                                        onChangeText={(t) =>
                                                            setEditAutoAssignDailyLimit(onlyNumberLike(t))
                                                        }
                                                        keyboardType="numeric"
                                                        style={styles.input}
                                                    />
                                                    <Text style={styles.hintSmall}>
                                                        Déjalo vacío si no quieres límite por día.
                                                    </Text>
                                                </View>
                                            ) : null}
                                        </View>
                                    ) : null}

                                    <View style={{ flexDirection: "row", gap: 10 }}>
                                        <Pressable
                                            onPress={cancelEditUser}
                                            style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed]}
                                            disabled={editSaving}
                                        >
                                            <Ionicons name="close-outline" size={18} color={COLORS.text} />
                                            <Text style={styles.ghostBtnText}>Cancelar</Text>
                                        </Pressable>

                                        <Pressable
                                            onPress={submitEditUser}
                                            style={({ pressed }) => [
                                                styles.primaryBtn,
                                                pressed && styles.btnPressed,
                                                editSaving && styles.btnDisabled,
                                            ]}
                                            disabled={editSaving}
                                        >
                                            <Ionicons name="save-outline" size={18} color="#fff" />
                                            <Text style={styles.primaryBtnText}>
                                                {editSaving ? "Guardando..." : "Guardar"}
                                            </Text>
                                        </Pressable>
                                    </View>
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
    cardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
    },

    userName: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
    userEmail: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },
    userEmailMuted: { color: COLORS.muted, fontSize: 12, fontWeight: "800", opacity: 0.7 },

    phoneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    userPhone: { color: COLORS.text, opacity: 0.9, fontSize: 12, fontWeight: "900" },

    coverageSection: {
        gap: 8,
        paddingTop: 2,
    },
    coverageTitle: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    coverageWrap: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    coveragePill: {
        minHeight: 30,
        maxWidth: "100%",
        borderRadius: 999,
        paddingHorizontal: 10,
        backgroundColor: "rgba(37,99,235,0.12)",
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.30)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    coveragePillEditable: {
        minHeight: 32,
        maxWidth: "100%",
        borderRadius: 999,
        paddingLeft: 10,
        paddingRight: 6,
        backgroundColor: "rgba(37,99,235,0.12)",
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.30)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    coveragePillText: {
        color: "#93C5FD",
        fontSize: 11,
        fontWeight: "900",
        flexShrink: 1,
    },
    coverageRemoveBtn: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.08)",
    },
    coverageEmpty: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        opacity: 0.8,
    },

    autoAssignSection: {
        gap: 8,
        paddingTop: 2,
    },
    autoAssignRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
    },
    autoAssignPill: {
        minHeight: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    autoAssignPillActive: {
        backgroundColor: "rgba(37,99,235,0.14)",
        borderColor: "rgba(37,99,235,0.32)",
    },
    autoAssignPillInactive: {
        backgroundColor: "rgba(255,255,255,0.04)",
        borderColor: "rgba(255,255,255,0.10)",
    },
    autoAssignPillText: {
        fontSize: 11,
        fontWeight: "900",
    },
    autoAssignPillTextActive: {
        color: "#93C5FD",
    },
    autoAssignPillTextInactive: {
        color: COLORS.muted,
    },
    autoAssignLimitPill: {
        minHeight: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "rgba(124,58,237,0.35)",
        backgroundColor: "rgba(124,58,237,0.14)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    autoAssignLimitText: {
        color: "#C4B5FD",
        fontSize: 11,
        fontWeight: "900",
    },

    actionsRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 2,
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
    pillAdmin: {
        backgroundColor: "rgba(124,58,237,0.16)",
        borderColor: "rgba(124,58,237,0.35)",
    },
    pillTextAdmin: { color: "#C4B5FD" },
    pillUser: {
        backgroundColor: "rgba(37,99,235,0.14)",
        borderColor: "rgba(37,99,235,0.35)",
    },
    pillTextUser: { color: "#93C5FD" },

    pillActive: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.35)",
    },
    pillTextActive: { color: "#86EFAC" },
    pillBlocked: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.35)",
    },
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

    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.55)",
        padding: 16,
        justifyContent: "center",
    },
    modalWrap: { width: "100%" },
    modalCard: {
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        maxHeight: "88%",
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
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
    hintSmall: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
        opacity: 0.85,
        marginTop: 6,
    },

    field: { gap: 6 },
    grid2: {
        flexDirection: "row",
        gap: 10,
        flexWrap: "wrap",
    },
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

    coverageEditor: {
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    coverageEditorTitle: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    billingEditor: {
        gap: 12,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    billingModeRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
    billingModeBtn: {
        minHeight: 38,
        flex: 1,
        minWidth: 120,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "#0F172A",
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    billingModeBtnActive: {
        borderColor: "rgba(37,99,235,0.35)",
        backgroundColor: "rgba(37,99,235,0.14)",
    },
    billingModeText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    billingModeTextActive: {
        color: "#93C5FD",
    },
    countryCoverageBtn: {
        minHeight: 42,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.30)",
        backgroundColor: "rgba(37,99,235,0.12)",
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    countryCoverageBtnText: {
        color: "#93C5FD",
        fontSize: 12,
        fontWeight: "900",
    },
    stateRow: {
        gap: 8,
        paddingRight: 8,
    },
    statePill: {
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "#0F172A",
        alignItems: "center",
        justifyContent: "center",
    },
    statePillActive: {
        backgroundColor: "rgba(124,58,237,0.16)",
        borderColor: "rgba(124,58,237,0.35)",
    },
    statePillText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },
    statePillTextActive: {
        color: "#C4B5FD",
    },
    addCoverageRow: {
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
    },
    addCoverageBtn: {
        width: 48,
        height: 48,
        borderRadius: 14,
        backgroundColor: COLORS.primary,
        alignItems: "center",
        justifyContent: "center",
    },

    autoAssignEditCard: {
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    autoAssignEditHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
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
