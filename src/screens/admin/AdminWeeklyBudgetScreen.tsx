// src/screens/admin/AdminWeeklyBudgetScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
    subscribeWeeklyInvestment,
    upsertWeeklyInvestment,
    type WeeklyInvestmentAllocations,
} from "../../data/repositories/investmentsRepo";
import { listUsers } from "../../data/repositories/usersRepo";
import type { UserDoc } from "../../types/models";

function clamp2(n: number) {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function safeNumber(n: any): number {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
}

function money(n: number) {
    const v = Number.isFinite(n) ? n : 0;
    return v.toFixed(2);
}

function parseMoney(s: string) {
    const t = (s ?? "").replace(",", ".").replace(/[^\d.]/g, "");
    const parts = t.split(".");
    const clean = parts.length <= 2 ? t : `${parts[0]}.${parts.slice(1).join("")}`;
    const n = Number(clean);
    return clamp2(Number.isFinite(n) ? n : 0);
}

export default function AdminWeeklyBudgetScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const params = useLocalSearchParams<{
        weekStartKey?: string;
        weekEndKey?: string;
    }>();

    const weekStartKey = useMemo(
        () => String(params.weekStartKey ?? "").trim(),
        [params.weekStartKey]
    );
    const weekEndKey = useMemo(
        () => String(params.weekEndKey ?? "").trim(),
        [params.weekEndKey]
    );

    const [users, setUsers] = useState<UserDoc[]>([]);

    // total semanal
    const [budgetDraft, setBudgetDraft] = useState<string>("0");
    const [saving, setSaving] = useState(false);

    // allocations (draft)
    const [allocDraft, setAllocDraft] = useState<Record<string, string>>({});

    // remote cache (para no pisar el draft mientras tipeas)
    const lastRemoteAmountRef = useRef<number>(0);
    const lastRemoteAllocRef = useRef<WeeklyInvestmentAllocations>({});
    const draftDirtyRef = useRef<boolean>(false);
    const allocDirtyRef = useRef<boolean>(false);

    // --- load users
    useEffect(() => {
        (async () => {
            const u = await listUsers("user");
            setUsers(u ?? []);
        })();
    }, []);

    // helpers (rehidratar alloc en draft) — usa users actuales
    const hydrateAllocDraftFromRemote = (remoteAlloc: WeeklyInvestmentAllocations) => {
        const next: Record<string, string> = {};
        for (const u of users) {
            const v = safeNumber((remoteAlloc as any)?.[u.id] ?? 0);
            next[u.id] = v > 0 ? String(clamp2(v)) : "";
        }
        setAllocDraft(next);
    };

    // --- subscribe weekly investment (semana)
    useEffect(() => {
        if (!weekStartKey) return;

        const unsub = subscribeWeeklyInvestment(
            weekStartKey,
            (doc) => {
                const amt = clamp2(safeNumber((doc as any)?.amount ?? 0));
                lastRemoteAmountRef.current = amt;

                const remoteAlloc = ((doc as any)?.allocations ?? {}) as WeeklyInvestmentAllocations;
                lastRemoteAllocRef.current =
                    remoteAlloc && typeof remoteAlloc === "object" ? remoteAlloc : {};

                if (!draftDirtyRef.current) setBudgetDraft(String(amt));

                // Si todavía no hay dirty en allocations, hidrata draft.
                if (!allocDirtyRef.current) {
                    hydrateAllocDraftFromRemote(lastRemoteAllocRef.current);
                }
            },
            () => {
                lastRemoteAmountRef.current = 0;
                lastRemoteAllocRef.current = {};

                if (!draftDirtyRef.current) setBudgetDraft("0");
                if (!allocDirtyRef.current) setAllocDraft({});
            }
        );

        return () => unsub();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [weekStartKey]);

    // ✅ Cuando users termina de cargar, si NO estás editando allocations,
    // rehidrata con lo último remoto (para no perder el mapeo por userId).
    useEffect(() => {
        if (!users.length) return;
        if (allocDirtyRef.current) return;

        hydrateAllocDraftFromRemote(lastRemoteAllocRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [users.length]);

    const totalDraft = useMemo(() => parseMoney(budgetDraft), [budgetDraft]);

    const totalAllocDraft = useMemo(() => {
        let sum = 0;
        for (const u of users) sum += parseMoney(allocDraft[u.id] ?? "0");
        return clamp2(sum);
    }, [allocDraft, users]);

    const remainingDraft = useMemo(
        () => clamp2(totalDraft - totalAllocDraft),
        [totalDraft, totalAllocDraft]
    );

    const onChangeBudgetDraft = (txt: string) => {
        draftDirtyRef.current = true;
        setBudgetDraft(txt);
    };

    const onChangeAllocDraft = (uid: string, txt: string) => {
        allocDirtyRef.current = true;
        setAllocDraft((prev) => ({ ...prev, [uid]: txt }));
    };

    const resetAll = () => {
        draftDirtyRef.current = false;
        allocDirtyRef.current = false;

        setBudgetDraft(String(lastRemoteAmountRef.current || 0));
        hydrateAllocDraftFromRemote(lastRemoteAllocRef.current);
    };

    const splitEqual = () => {
        const n = users.length;
        if (n <= 0) return;

        const total = totalDraft;
        if (total <= 0) {
            Alert.alert("Presupuesto", "Primero coloca un total mayor que 0.");
            return;
        }

        const per = clamp2(total / n);

        // Ajuste del último para cuadrar centavos
        const baseSum = clamp2(per * n);
        const diff = clamp2(total - baseSum);

        allocDirtyRef.current = true;

        const next: Record<string, string> = {};
        for (let i = 0; i < users.length; i++) {
            const u = users[i];
            if (i === users.length - 1) {
                next[u.id] = String(clamp2(per + diff));
            } else {
                next[u.id] = String(per);
            }
        }

        setAllocDraft(next);
    };

    const save = async () => {
        if (!weekStartKey) {
            Alert.alert("Error", "Falta weekStartKey.");
            return;
        }

        const amt = totalDraft;

        // normaliza allocations
        const allocationsOut: WeeklyInvestmentAllocations = {};
        for (const u of users) {
            const v = parseMoney(allocDraft[u.id] ?? "0");
            if (v > 0) allocationsOut[u.id] = v;
        }

        // warning si no cuadra
        const sumAlloc = Object.values(allocationsOut).reduce((a, b) => a + b, 0);
        const rem = clamp2(amt - sumAlloc);

        if (amt > 0 && users.length > 0 && Math.abs(rem) > 0.01) {
            const ok = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    "Distribución no cuadra",
                    `Total: R$ ${money(amt)}\nAsignado: R$ ${money(sumAlloc)}\nRestante: R$ ${money(rem)}\n\n¿Guardar igual?`,
                    [
                        { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
                        { text: "Guardar", style: "default", onPress: () => resolve(true) },
                    ]
                );
            });
            if (!ok) return;
        }

        setSaving(true);
        try {
            await upsertWeeklyInvestment(weekStartKey, weekEndKey, amt, allocationsOut);

            draftDirtyRef.current = false;
            allocDirtyRef.current = false;

            router.back();
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo guardar.");
        } finally {
            setSaving(false);
        }
    };

    const canSave = useMemo(() => !saving && weekStartKey.length > 0, [saving, weekStartKey]);

    return (
        <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                >
                    <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                </Pressable>

                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Presupuesto semanal</Text>
                    <Text style={styles.headerSub} numberOfLines={1}>
                        {weekStartKey || "—"} → {weekEndKey || "—"}
                    </Text>
                </View>

                <Pressable
                    onPress={resetAll}
                    style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                >
                    <Ionicons name="refresh-outline" size={18} color={COLORS.text} />
                </Pressable>
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
                <ScrollView
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={[
                        styles.content,
                        { paddingBottom: Math.max(16, insets.bottom + 16) + 84 },
                    ]}
                >
                    {/* Total */}
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Total invertido (Meta)</Text>

                        <View style={styles.inputRow}>
                            <View style={styles.moneyPrefix}>
                                <Text style={styles.moneyPrefixText}>R$</Text>
                            </View>

                            <TextInput
                                value={budgetDraft}
                                onChangeText={onChangeBudgetDraft}
                                keyboardType="numeric"
                                placeholder="0"
                                placeholderTextColor="rgba(255,255,255,0.35)"
                                style={styles.input}
                            />
                        </View>

                        <Text style={styles.hint}>
                            Este es el total semanal invertido. Abajo puedes dividirlo por usuario para analizar
                            rendimiento individual.
                        </Text>
                    </View>

                    {/* Allocations */}
                    <View style={styles.card}>
                        <View style={styles.allocHeaderRow}>
                            <Text style={styles.cardTitle}>Distribución por usuario</Text>

                            <Pressable onPress={splitEqual} style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}>
                                <Ionicons name="git-branch-outline" size={16} color={COLORS.text} />
                                <Text style={styles.miniBtnText}>Igual</Text>
                            </Pressable>
                        </View>

                        <View style={styles.allocSummaryRow}>
                            <View style={styles.allocPill}>
                                <Text style={styles.allocPillLabel}>Asignado</Text>
                                <Text style={styles.allocPillValue}>R$ {money(totalAllocDraft)}</Text>
                            </View>

                            <View style={[styles.allocPill, remainingDraft < 0 ? styles.allocPillNeg : styles.allocPillNeu]}>
                                <Text style={styles.allocPillLabel}>Restante</Text>
                                <Text style={styles.allocPillValue}>R$ {money(remainingDraft)}</Text>
                            </View>
                        </View>

                        <View style={{ gap: 10, marginTop: 8 }}>
                            {users.map((u) => {
                                const name = u?.name?.trim() || u?.email?.trim() || "Usuario";
                                return (
                                    <View key={u.id} style={styles.allocRow}>
                                        <View style={{ flex: 1, gap: 2 }}>
                                            <Text style={styles.allocName} numberOfLines={1}>
                                                {name}
                                            </Text>
                                            <Text style={styles.allocSub} numberOfLines={1}>
                                                {u?.email || u.id}
                                            </Text>
                                        </View>

                                        <View style={styles.allocInputRow}>
                                            <Text style={styles.allocPrefix}>R$</Text>
                                            <TextInput
                                                value={allocDraft[u.id] ?? ""}
                                                onChangeText={(t) => onChangeAllocDraft(u.id, t)}
                                                keyboardType="numeric"
                                                placeholder="0"
                                                placeholderTextColor="rgba(255,255,255,0.35)"
                                                style={styles.allocInput}
                                            />
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    </View>

                    {/* Nota */}
                    <View style={styles.noteCard}>
                        <Ionicons name="information-circle-outline" size={18} color={COLORS.muted} />
                        <Text style={styles.noteText}>
                            Consejo: intenta que{" "}
                            <Text style={{ color: COLORS.text, fontWeight: "900" }}>Restante</Text> quede en 0.
                            Si queda positivo, significa presupuesto no asignado. Si queda negativo, asignaste más
                            de lo que existe.
                        </Text>
                    </View>
                </ScrollView>

                {/* Bottom bar fija */}
                <View style={[styles.bottomBar, { paddingBottom: Math.max(12, insets.bottom + 10) }]}>
                    <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.bottomBtn, pressed && styles.pressed]}>
                        <Ionicons name="close-outline" size={18} color={COLORS.muted} />
                        <Text style={styles.bottomBtnTextMuted}>Cancelar</Text>
                    </Pressable>

                    <Pressable
                        onPress={save}
                        disabled={!canSave}
                        style={({ pressed }) => [
                            styles.bottomBtn,
                            styles.bottomBtnPrimary,
                            (!canSave || saving) && styles.disabled,
                            pressed && canSave && styles.pressed,
                        ]}
                    >
                        <Ionicons name="save-outline" size={18} color={COLORS.text} />
                        <Text style={styles.bottomBtnText}>{saving ? "Guardando..." : "Guardar"}</Text>
                    </Pressable>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    headerBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
    },
    headerTitle: { color: COLORS.text, fontWeight: "900", fontSize: 16 },
    headerSub: { color: COLORS.muted, fontWeight: "800", fontSize: 12, marginTop: 2 },

    content: { paddingHorizontal: 16, gap: 12, paddingTop: 4 },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        gap: 10,
    },
    cardTitle: { color: COLORS.text, fontWeight: "900", fontSize: 14 },

    hint: { color: "rgba(255,255,255,0.65)", fontWeight: "700", fontSize: 12, lineHeight: 18 },

    inputRow: {
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        backgroundColor: "#0F172A",
        borderRadius: 14,
        overflow: "hidden",
    },
    moneyPrefix: {
        paddingHorizontal: 12,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
        borderRightWidth: 1,
        borderRightColor: "rgba(255,255,255,0.08)",
    },
    moneyPrefixText: { color: COLORS.muted, fontWeight: "900" },
    input: { flex: 1, height: 48, paddingHorizontal: 12, color: COLORS.text, fontSize: 14, fontWeight: "900" },

    allocHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },

    miniBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    miniBtnText: { color: COLORS.text, fontWeight: "900", fontSize: 12 },

    allocSummaryRow: { flexDirection: "row", gap: 10 },
    allocPill: {
        flex: 1,
        borderRadius: 14,
        padding: 10,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        gap: 4,
    },
    allocPillLabel: { color: COLORS.muted, fontWeight: "900", fontSize: 11 },
    allocPillValue: { color: COLORS.text, fontWeight: "900", fontSize: 13 },
    allocPillNeg: { borderColor: "rgba(248,113,113,0.35)", backgroundColor: "rgba(248,113,113,0.08)" },
    allocPillNeu: { borderColor: "rgba(255,255,255,0.10)" },

    allocRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    allocName: { color: COLORS.text, fontWeight: "900", fontSize: 12 },
    allocSub: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 11 },

    allocInputRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 40,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        backgroundColor: "#0B1220",
    },
    allocPrefix: { color: "rgba(255,255,255,0.55)", fontWeight: "900" },
    allocInput: { width: 72, color: COLORS.text, fontWeight: "900", textAlign: "right", padding: 0 },

    noteCard: {
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        alignItems: "flex-start",
    },
    noteText: { flex: 1, color: "rgba(255,255,255,0.65)", fontWeight: "700", fontSize: 12, lineHeight: 18 },

    bottomBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
        paddingTop: 10,
        backgroundColor: "rgba(11,18,32,0.92)",
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.08)",
        flexDirection: "row",
        gap: 10,
    },
    bottomBtn: {
        flex: 1,
        height: 48,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
    },
    bottomBtnPrimary: { backgroundColor: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.12)" },
    bottomBtnText: { color: COLORS.text, fontWeight: "900", fontSize: 13 },
    bottomBtnTextMuted: { color: COLORS.muted, fontWeight: "900", fontSize: 13 },

    disabled: { opacity: 0.55 },
    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
});