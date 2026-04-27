import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { upsertUserDoc } from "../../data/repositories/usersRepo";
import type { UserBillingMode, UserDoc, UserGeoCoverage } from "../../types/models";

type AdminCreateUserModalProps = {
    open: boolean;
    onClose: () => void;
    onCreated?: () => Promise<void> | void;
};

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

export default function AdminCreateUserModal({
    open,
    onClose,
    onCreated,
}: AdminCreateUserModalProps) {
    const [uid, setUid] = useState("");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [whatsappPhoneNew, setWhatsappPhoneNew] = useState("");
    const [ratePerVisitNew, setRatePerVisitNew] = useState("50");
    const [billingMode, setBillingMode] = useState<UserBillingMode>("per_visit");
    const [weeklySubscriptionAmount, setWeeklySubscriptionAmount] = useState("0");
    const [weeklySubscriptionCost, setWeeklySubscriptionCost] = useState("0");
    const [weeklySubscriptionActive, setWeeklySubscriptionActive] = useState(true);
    const [newCoverageState, setNewCoverageState] = useState("");
    const [newCoverageCity, setNewCoverageCity] = useState("");
    const [newCoverageList, setNewCoverageList] = useState<UserGeoCoverage[]>([]);

    const [autoAssignEnabled, setAutoAssignEnabled] = useState(false);
    const [autoAssignDailyLimit, setAutoAssignDailyLimit] = useState("");

    const [err, setErr] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const normalizedCoverage = useMemo(
        () => normalizeCoverageList(newCoverageList),
        [newCoverageList]
    );

    const resetForm = () => {
        setUid("");
        setName("");
        setEmail("");
        setWhatsappPhoneNew("");
        setRatePerVisitNew("50");
        setBillingMode("per_visit");
        setWeeklySubscriptionAmount("0");
        setWeeklySubscriptionCost("0");
        setWeeklySubscriptionActive(true);
        setNewCoverageState("");
        setNewCoverageCity("");
        setNewCoverageList([]);
        setAutoAssignEnabled(false);
        setAutoAssignDailyLimit("");
        setErr(null);
        setSaving(false);
    };

    const handleClose = () => {
        if (saving) return;
        resetForm();
        onClose();
    };

    const addCoverage = () => {
        const item = makeCoverageItem(newCoverageState, newCoverageCity);
        if (!item) {
            setErr("Debes indicar estado y ciudad.");
            return;
        }

        setErr(null);
        setNewCoverageList((prev) => normalizeCoverageList([...prev, item]));
        setNewCoverageCity("");
    };

    const addPanamaCoverage = () => {
        setErr(null);
        setNewCoverageList((prev) =>
            normalizeCoverageList([
                ...prev,
                makeCountryCoverageItem("Panama", "panama"),
            ])
        );
    };

    const removeCoverage = (id: string) => {
        setNewCoverageList((prev) => prev.filter((x) => x.id !== id));
    };

    const registerProfile = async () => {
        setErr(null);

        const cleanUid = uid.trim();
        const cleanName = name.trim();
        const cleanEmail = email.trim();
        const cleanWhatsapp = normalizePhone(whatsappPhoneNew);
        const rate = Number(onlyNumberLike(ratePerVisitNew)) || 0;
        const weeklyAmount = Number(onlyNumberLike(weeklySubscriptionAmount)) || 0;
        const weeklyCost = Number(onlyNumberLike(weeklySubscriptionCost)) || 0;
        const dailyLimitRaw = onlyNumberLike(autoAssignDailyLimit);
        const dailyLimit = dailyLimitRaw ? Number(dailyLimitRaw) : null;

        if (!cleanUid) {
            setErr("UID es obligatorio. Copia el UID desde Firebase Auth.");
            return;
        }

        if (autoAssignEnabled && !normalizedCoverage.length) {
            setErr("Para activar asignación automática, agrega al menos una cobertura.");
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
                billingMode,
                weeklySubscriptionAmount: weeklyAmount,
                weeklySubscriptionCost: weeklyCost,
                weeklySubscriptionActive,
                whatsappPhone: cleanWhatsapp,
                geoCoverage: normalizedCoverage,
                primaryGeoCoverageLabel: normalizedCoverage[0]?.displayLabel ?? null,

                autoAssignEnabled,
                autoAssignDailyLimit: autoAssignEnabled ? dailyLimit : null,
                autoAssignPriority: 1,
                assignmentMode: "round_robin",
            };

            await upsertUserDoc(docData);

            resetForm();
            onClose();
            await onCreated?.();
        } catch (e: any) {
            setErr(e?.message ?? "Error registrando perfil");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal visible={open} transparent animationType="fade" onRequestClose={handleClose}>
            <View style={styles.modalOverlay}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    style={styles.modalWrap}
                >
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Registrar perfil</Text>
                            <Pressable onPress={handleClose} style={styles.modalClose}>
                                <Ionicons name="close" size={18} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <Text style={styles.modalHint}>
                            Crea el usuario en Firebase Auth, copia el UID y regístralo aquí.
                        </Text>

                        <ScrollView
                            contentContainerStyle={{ gap: 12, paddingBottom: 6 }}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >
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
                                <Text style={styles.hintSmall}>
                                    Se guarda como solo dígitos, con código país.
                                </Text>
                            </View>

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

                            <View style={styles.billingEditor}>
                                <Text style={styles.coverageEditorTitle}>Modelo contable</Text>

                                <View style={styles.billingModeRow}>
                                    <Pressable
                                        onPress={() => setBillingMode("per_visit")}
                                        style={({ pressed }) => [
                                            styles.billingModeBtn,
                                            billingMode === "per_visit" && styles.billingModeBtnActive,
                                            pressed && styles.btnPressed,
                                        ]}
                                    >
                                        <Ionicons
                                            name="person-outline"
                                            size={15}
                                            color={billingMode === "per_visit" ? "#93C5FD" : COLORS.muted}
                                        />
                                        <Text
                                            style={[
                                                styles.billingModeText,
                                                billingMode === "per_visit" && styles.billingModeTextActive,
                                            ]}
                                        >
                                            Por visita
                                        </Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={() => setBillingMode("weekly_subscription")}
                                        style={({ pressed }) => [
                                            styles.billingModeBtn,
                                            billingMode === "weekly_subscription" && styles.billingModeBtnActive,
                                            pressed && styles.btnPressed,
                                        ]}
                                    >
                                        <Ionicons
                                            name="calendar-outline"
                                            size={15}
                                            color={
                                                billingMode === "weekly_subscription" ? "#93C5FD" : COLORS.muted
                                            }
                                        />
                                        <Text
                                            style={[
                                                styles.billingModeText,
                                                billingMode === "weekly_subscription" && styles.billingModeTextActive,
                                            ]}
                                        >
                                            Semanal
                                        </Text>
                                    </Pressable>
                                </View>

                                {billingMode === "weekly_subscription" ? (
                                    <>
                                        <View style={styles.grid2}>
                                            <View style={[styles.field, { flex: 1 }]}>
                                                <Text style={styles.label}>Cuota semanal (R$)</Text>
                                                <TextInput
                                                    placeholder="Ej: 400"
                                                    placeholderTextColor={COLORS.muted}
                                                    value={weeklySubscriptionAmount}
                                                    onChangeText={(t) =>
                                                        setWeeklySubscriptionAmount(onlyNumberLike(t))
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
                                                    value={weeklySubscriptionCost}
                                                    onChangeText={(t) =>
                                                        setWeeklySubscriptionCost(onlyNumberLike(t))
                                                    }
                                                    keyboardType="numeric"
                                                    style={styles.input}
                                                />
                                            </View>
                                        </View>

                                        <View style={styles.autoAssignHeader}>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.label}>Suscripción activa por defecto</Text>
                                                <Text style={styles.hintSmall}>
                                                    Si una semana no paga, luego la marcamos como no pagada.
                                                </Text>
                                            </View>
                                            <Switch
                                                value={weeklySubscriptionActive}
                                                onValueChange={setWeeklySubscriptionActive}
                                                trackColor={{
                                                    false: "rgba(255,255,255,0.12)",
                                                    true: "rgba(37,99,235,0.45)",
                                                }}
                                                thumbColor={weeklySubscriptionActive ? "#2563EB" : "#9CA3AF"}
                                            />
                                        </View>
                                    </>
                                ) : null}
                            </View>

                            <View style={styles.coverageEditor}>
                                <Text style={styles.coverageEditorTitle}>Cobertura geográfica</Text>

                                <Pressable
                                    onPress={addPanamaCoverage}
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
                                            const active = newCoverageState === state;
                                            return (
                                                <Pressable
                                                    key={state}
                                                    onPress={() => setNewCoverageState(state)}
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
                                            placeholder="Ej: Goiânia"
                                            placeholderTextColor={COLORS.muted}
                                            value={newCoverageCity}
                                            onChangeText={setNewCoverageCity}
                                            style={[styles.input, { flex: 1 }]}
                                        />
                                        <Pressable
                                            onPress={addCoverage}
                                            style={({ pressed }) => [
                                                styles.addCoverageBtn,
                                                pressed && styles.btnPressed,
                                            ]}
                                        >
                                            <Ionicons name="add" size={18} color="#fff" />
                                        </Pressable>
                                    </View>
                                </View>

                                {normalizedCoverage.length ? (
                                    <View style={styles.coverageWrap}>
                                        {normalizedCoverage.map((coverage) => (
                                            <View key={coverage.id} style={styles.coveragePillEditable}>
                                                <Text style={styles.coveragePillText} numberOfLines={1}>
                                                    {coverage.displayLabel}
                                                </Text>
                                                <Pressable
                                                    onPress={() => removeCoverage(coverage.id)}
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

                            <View style={styles.autoAssignCard}>
                                <View style={styles.autoAssignHeader}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.autoAssignTitle}>Asignación automática</Text>
                                        <Text style={styles.autoAssignHint}>
                                            Si está activa, este usuario podrá recibir leads automáticamente según su cobertura.
                                        </Text>
                                    </View>

                                    <Switch
                                        value={autoAssignEnabled}
                                        onValueChange={setAutoAssignEnabled}
                                        trackColor={{
                                            false: "rgba(255,255,255,0.12)",
                                            true: "rgba(37,99,235,0.45)",
                                        }}
                                        thumbColor={autoAssignEnabled ? "#2563EB" : "#9CA3AF"}
                                    />
                                </View>

                                <View style={styles.autoAssignStatusRow}>
                                    <View
                                        style={[
                                            styles.autoAssignPill,
                                            autoAssignEnabled
                                                ? styles.autoAssignPillActive
                                                : styles.autoAssignPillInactive,
                                        ]}
                                    >
                                        <Ionicons
                                            name={autoAssignEnabled ? "flash-outline" : "pause-outline"}
                                            size={13}
                                            color={autoAssignEnabled ? "#93C5FD" : COLORS.muted}
                                        />
                                        <Text
                                            style={[
                                                styles.autoAssignPillText,
                                                autoAssignEnabled
                                                    ? styles.autoAssignPillTextActive
                                                    : styles.autoAssignPillTextInactive,
                                            ]}
                                        >
                                            {autoAssignEnabled ? "ACTIVA" : "INACTIVA"}
                                        </Text>
                                    </View>
                                </View>

                                {autoAssignEnabled ? (
                                    <View style={styles.field}>
                                        <Text style={styles.label}>Límite diario (opcional)</Text>
                                        <TextInput
                                            placeholder="Ej: 20"
                                            placeholderTextColor={COLORS.muted}
                                            value={autoAssignDailyLimit}
                                            onChangeText={(t) => setAutoAssignDailyLimit(onlyNumberLike(t))}
                                            keyboardType="numeric"
                                            style={styles.input}
                                        />
                                        <Text style={styles.hintSmall}>
                                            Déjalo vacío si no quieres límite por día.
                                        </Text>
                                    </View>
                                ) : null}
                            </View>

                            {err ? (
                                <View style={styles.errorBox}>
                                    <Ionicons
                                        name="alert-circle-outline"
                                        size={16}
                                        color={COLORS.rejected}
                                    />
                                    <Text style={styles.errorText}>{err}</Text>
                                </View>
                            ) : null}

                            <View style={{ flexDirection: "row", gap: 10 }}>
                                <Pressable
                                    onPress={handleClose}
                                    style={({ pressed }) => [styles.ghostBtn, pressed && styles.btnPressed]}
                                    disabled={saving}
                                >
                                    <Ionicons name="close-outline" size={18} color={COLORS.text} />
                                    <Text style={styles.ghostBtnText}>Cancelar</Text>
                                </Pressable>

                                <Pressable
                                    onPress={registerProfile}
                                    style={({ pressed }) => [
                                        styles.primaryBtn,
                                        pressed && styles.btnPressed,
                                        saving && styles.btnDisabled,
                                    ]}
                                    disabled={saving}
                                >
                                    <Ionicons name="save-outline" size={18} color="#fff" />
                                    <Text style={styles.primaryBtnText}>
                                        {saving ? "Guardando..." : "Registrar"}
                                    </Text>
                                </Pressable>
                            </View>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
}

const COLORS = {
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    primary: "#2563EB",
    rejected: "#F87171",
};

const styles = StyleSheet.create({
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
    modalHint: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        marginBottom: 10,
        lineHeight: 16,
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
    hintSmall: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
        opacity: 0.85,
        marginTop: 6,
    },

    grid2: { flexDirection: "row", gap: 10 },

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
    coverageWrap: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
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

    autoAssignCard: {
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    autoAssignHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    autoAssignTitle: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
    autoAssignHint: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
        lineHeight: 16,
        marginTop: 2,
    },
    autoAssignStatusRow: {
        flexDirection: "row",
        alignItems: "center",
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
    },
    primaryBtnText: { color: "#fff", fontWeight: "900", fontSize: 14 },
    btnPressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
    btnDisabled: { opacity: 0.55 },
});
