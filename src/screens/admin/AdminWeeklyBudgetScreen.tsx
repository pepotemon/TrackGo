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
import AdminBackground from "../../components/admin/AdminBackground";

import {
    subscribeWeeklyInvestment,
    upsertWeeklyInvestment,
    type WeeklyInvestmentAllocations,
    type WeeklyInvestmentGroup,
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

type GroupDraft = {
    id: string;
    name: string;
    amount: string;
    userIds: string[];
};

function makeGroupId() {
    return `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function draftFromRemoteGroups(
    groups: WeeklyInvestmentGroup[] | undefined,
    users: UserDoc[],
    legacyAllocations?: WeeklyInvestmentAllocations
): GroupDraft[] {
    const cleanGroups = Array.isArray(groups) ? groups : [];

    // 1) si ya existen groups, los usamos
    if (cleanGroups.length > 0) {
        return cleanGroups.map((g, idx) => ({
            id: String(g.id || `group_${idx + 1}`),
            name: String(g.name || `Grupo ${idx + 1}`),
            amount: g.amount > 0 ? String(clamp2(g.amount)) : "",
            userIds: Array.isArray(g.userIds) ? g.userIds.filter(Boolean) : [],
        }));
    }

    // 2) fallback: convertir allocations legadas en grupos individuales
    const alloc = legacyAllocations ?? {};
    const out: GroupDraft[] = [];

    for (const u of users) {
        const amt = safeNumber((alloc as any)?.[u.id] ?? 0);
        if (amt <= 0) continue;

        out.push({
            id: makeGroupId(),
            name: u?.name?.trim() || u?.email?.trim() || "Usuario",
            amount: String(clamp2(amt)),
            userIds: [u.id],
        });
    }

    return out;
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
    const [budgetDraft, setBudgetDraft] = useState<string>("0");
    const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([]);
    const [saving, setSaving] = useState(false);

    // remote cache
    const lastRemoteAmountRef = useRef<number>(0);
    const lastRemoteGroupsRef = useRef<WeeklyInvestmentGroup[]>([]);
    const lastRemoteAllocRef = useRef<WeeklyInvestmentAllocations>({});
    const draftDirtyRef = useRef<boolean>(false);
    const groupsDirtyRef = useRef<boolean>(false);

    useEffect(() => {
        (async () => {
            const u = await listUsers("user");
            setUsers(u ?? []);
        })();
    }, []);

    const usersById = useMemo(() => {
        const m = new Map<string, UserDoc>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);

    const hydrateGroupsFromRemote = (
        groups: WeeklyInvestmentGroup[] | undefined,
        legacyAllocations?: WeeklyInvestmentAllocations
    ) => {
        setGroupDrafts(draftFromRemoteGroups(groups, users, legacyAllocations));
    };

    useEffect(() => {
        if (!weekStartKey) return;

        const unsub = subscribeWeeklyInvestment(
            weekStartKey,
            (doc) => {
                const amt = clamp2(safeNumber((doc as any)?.amount ?? 0));
                const remoteGroups = Array.isArray((doc as any)?.groups)
                    ? ((doc as any).groups as WeeklyInvestmentGroup[])
                    : [];
                const remoteAlloc =
                    ((doc as any)?.allocations ?? {}) as WeeklyInvestmentAllocations;

                lastRemoteAmountRef.current = amt;
                lastRemoteGroupsRef.current = remoteGroups;
                lastRemoteAllocRef.current = remoteAlloc && typeof remoteAlloc === "object" ? remoteAlloc : {};

                if (!draftDirtyRef.current) setBudgetDraft(String(amt));
                if (!groupsDirtyRef.current) {
                    hydrateGroupsFromRemote(lastRemoteGroupsRef.current, lastRemoteAllocRef.current);
                }
            },
            () => {
                lastRemoteAmountRef.current = 0;
                lastRemoteGroupsRef.current = [];
                lastRemoteAllocRef.current = {};

                if (!draftDirtyRef.current) setBudgetDraft("0");
                if (!groupsDirtyRef.current) setGroupDrafts([]);
            }
        );

        return () => unsub();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [weekStartKey]);

    useEffect(() => {
        if (!users.length) return;
        if (groupsDirtyRef.current) return;
        hydrateGroupsFromRemote(lastRemoteGroupsRef.current, lastRemoteAllocRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [users.length]);

    const totalDraft = useMemo(() => parseMoney(budgetDraft), [budgetDraft]);

    const totalGroupsDraft = useMemo(() => {
        return clamp2(
            groupDrafts.reduce((sum, g) => sum + parseMoney(g.amount), 0)
        );
    }, [groupDrafts]);

    const remainingDraft = useMemo(
        () => clamp2(totalDraft - totalGroupsDraft),
        [totalDraft, totalGroupsDraft]
    );

    const onChangeBudgetDraft = (txt: string) => {
        draftDirtyRef.current = true;
        setBudgetDraft(txt);
    };

    const updateGroup = (groupId: string, patch: Partial<GroupDraft>) => {
        groupsDirtyRef.current = true;
        setGroupDrafts((prev) =>
            prev.map((g) => (g.id === groupId ? { ...g, ...patch } : g))
        );
    };

    const removeGroup = (groupId: string) => {
        groupsDirtyRef.current = true;
        setGroupDrafts((prev) => prev.filter((g) => g.id !== groupId));
    };

    const addGroup = () => {
        groupsDirtyRef.current = true;
        setGroupDrafts((prev) => [
            ...prev,
            {
                id: makeGroupId(),
                name: `Grupo ${prev.length + 1}`,
                amount: "",
                userIds: [],
            },
        ]);
    };

    const toggleUserInGroup = (groupId: string, userId: string) => {
        groupsDirtyRef.current = true;
        setGroupDrafts((prev) =>
            prev.map((g) => {
                if (g.id !== groupId) return g;
                const has = g.userIds.includes(userId);
                return {
                    ...g,
                    userIds: has
                        ? g.userIds.filter((id) => id !== userId)
                        : [...g.userIds, userId],
                };
            })
        );
    };

    const resetAll = () => {
        draftDirtyRef.current = false;
        groupsDirtyRef.current = false;
        setBudgetDraft(String(lastRemoteAmountRef.current || 0));
        hydrateGroupsFromRemote(lastRemoteGroupsRef.current, lastRemoteAllocRef.current);
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
        const baseSum = clamp2(per * n);
        const diff = clamp2(total - baseSum);

        groupsDirtyRef.current = true;

        const next: GroupDraft[] = users.map((u, idx) => ({
            id: makeGroupId(),
            name: u?.name?.trim() || u?.email?.trim() || `Grupo ${idx + 1}`,
            amount: String(idx === users.length - 1 ? clamp2(per + diff) : per),
            userIds: [u.id],
        }));

        setGroupDrafts(next);
    };

    const normalizedGroups = useMemo(() => {
        return groupDrafts
            .map((g, idx) => {
                const cleanUserIds = Array.from(
                    new Set((g.userIds ?? []).map((x) => String(x).trim()).filter(Boolean))
                );
                const amount = parseMoney(g.amount);

                return {
                    id: String(g.id || makeGroupId()),
                    name: String(g.name ?? "").trim() || `Grupo ${idx + 1}`,
                    amount,
                    userIds: cleanUserIds,
                };
            })
            .filter((g) => g.amount > 0 && g.userIds.length > 0);
    }, [groupDrafts]);

    // allocations derivadas desde groups, solo para compatibilidad / análisis individual
    const derivedAllocations = useMemo(() => {
        const out: WeeklyInvestmentAllocations = {};
        for (const g of normalizedGroups) {
            const share = g.userIds.length > 0 ? clamp2(g.amount / g.userIds.length) : 0;
            const sumBase = clamp2(share * g.userIds.length);
            const diff = clamp2(g.amount - sumBase);

            g.userIds.forEach((uid, idx) => {
                const portion = idx === g.userIds.length - 1 ? clamp2(share + diff) : share;
                out[uid] = clamp2((out[uid] ?? 0) + portion);
            });
        }
        return out;
    }, [normalizedGroups]);

    const save = async () => {
        if (!weekStartKey) {
            Alert.alert("Error", "Falta weekStartKey.");
            return;
        }

        const amt = totalDraft;
        const sumGroups = normalizedGroups.reduce((a, b) => a + b.amount, 0);
        const rem = clamp2(amt - sumGroups);

        if (amt > 0 && Math.abs(rem) > 0.01) {
            const ok = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    "Distribución no cuadra",
                    `Total: R$ ${money(amt)}\nGrupos: R$ ${money(sumGroups)}\nRestante: R$ ${money(rem)}\n\n¿Guardar igual?`,
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
            await upsertWeeklyInvestment(
                weekStartKey,
                weekEndKey,
                amt,
                derivedAllocations,
                normalizedGroups
            );

            draftDirtyRef.current = false;
            groupsDirtyRef.current = false;

            router.back();
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo guardar.");
        } finally {
            setSaving(false);
        }
    };

    const canSave = useMemo(
        () => !saving && weekStartKey.length > 0,
        [saving, weekStartKey]
    );

    return (
        <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
            <AdminBackground>
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


                        </View>

                        <View style={styles.card}>
                            <View style={styles.allocHeaderRow}>
                                <Text style={styles.cardTitle}>Grupos de inversión</Text>

                                <View style={styles.headerActions}>
                                    <Pressable
                                        onPress={splitEqual}
                                        style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
                                    >
                                        <Ionicons name="git-branch-outline" size={16} color={COLORS.text} />
                                        <Text style={styles.miniBtnText}>Individual</Text>
                                    </Pressable>

                                    <Pressable
                                        onPress={addGroup}
                                        style={({ pressed }) => [styles.miniBtn, pressed && styles.pressed]}
                                    >
                                        <Ionicons name="add-outline" size={16} color={COLORS.text} />
                                        <Text style={styles.miniBtnText}>Grupo</Text>
                                    </Pressable>
                                </View>
                            </View>

                            <View style={styles.allocSummaryRow}>
                                <View style={styles.allocPill}>
                                    <Text style={styles.allocPillLabel}>Asignado</Text>
                                    <Text style={styles.allocPillValue}>R$ {money(totalGroupsDraft)}</Text>
                                </View>

                                <View
                                    style={[
                                        styles.allocPill,
                                        remainingDraft < 0 ? styles.allocPillNeg : styles.allocPillNeu,
                                    ]}
                                >
                                    <Text style={styles.allocPillLabel}>Restante</Text>
                                    <Text style={styles.allocPillValue}>R$ {money(remainingDraft)}</Text>
                                </View>
                            </View>

                            {groupDrafts.length === 0 ? (
                                <View style={styles.emptyBox}>
                                    <Ionicons name="layers-outline" size={20} color={COLORS.muted} />
                                    <Text style={styles.emptyText}>
                                        Aún no hay grupos. Crea uno o usa “Individual”.
                                    </Text>
                                </View>
                            ) : null}

                            <View style={{ gap: 12, marginTop: 8 }}>
                                {groupDrafts.map((g, idx) => {
                                    const amountNum = parseMoney(g.amount);
                                    return (
                                        <View key={g.id} style={styles.groupCard}>
                                            <View style={styles.groupTopRow}>
                                                <View style={{ flex: 1, gap: 8 }}>
                                                    <TextInput
                                                        value={g.name}
                                                        onChangeText={(t) => updateGroup(g.id, { name: t })}
                                                        placeholder={`Grupo ${idx + 1}`}
                                                        placeholderTextColor="rgba(255,255,255,0.35)"
                                                        style={styles.groupNameInput}
                                                    />

                                                    <View style={styles.allocInputRow}>
                                                        <Text style={styles.allocPrefix}>R$</Text>
                                                        <TextInput
                                                            value={g.amount}
                                                            onChangeText={(t) => updateGroup(g.id, { amount: t })}
                                                            keyboardType="numeric"
                                                            placeholder="0"
                                                            placeholderTextColor="rgba(255,255,255,0.35)"
                                                            style={styles.allocInput}
                                                        />
                                                    </View>
                                                </View>

                                                <Pressable
                                                    onPress={() => removeGroup(g.id)}
                                                    style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                                                >
                                                    <Ionicons name="trash-outline" size={16} color="#FCA5A5" />
                                                </Pressable>
                                            </View>

                                            <Text style={styles.groupHint}>
                                                Miembros: {g.userIds.length} · Inversión: R$ {money(amountNum)}
                                            </Text>

                                            <View style={styles.userChipsWrap}>
                                                {users.map((u) => {
                                                    const selected = g.userIds.includes(u.id);
                                                    const label =
                                                        u?.name?.trim() || u?.email?.trim() || "Usuario";

                                                    return (
                                                        <Pressable
                                                            key={u.id}
                                                            onPress={() => toggleUserInGroup(g.id, u.id)}
                                                            style={({ pressed }) => [
                                                                styles.userChip,
                                                                selected && styles.userChipSelected,
                                                                pressed && styles.pressed,
                                                            ]}
                                                        >
                                                            <Ionicons
                                                                name={selected ? "checkmark-circle" : "ellipse-outline"}
                                                                size={14}
                                                                color={selected ? COLORS.text : COLORS.muted}
                                                            />
                                                            <Text
                                                                style={[
                                                                    styles.userChipText,
                                                                    selected && styles.userChipTextSelected,
                                                                ]}
                                                                numberOfLines={1}
                                                            >
                                                                {label}
                                                            </Text>
                                                        </Pressable>
                                                    );
                                                })}
                                            </View>
                                        </View>
                                    );
                                })}
                            </View>
                        </View>


                        {normalizedGroups.length > 0 ? (
                            <View style={styles.card}>
                                <Text style={styles.cardTitle}>Resumen de guardado</Text>
                                <View style={{ gap: 8 }}>
                                    {normalizedGroups.map((g) => {
                                        const names = g.userIds
                                            .map((uid) => usersById.get(uid)?.name?.trim() || usersById.get(uid)?.email?.trim() || uid)
                                            .join(", ");

                                        return (
                                            <View key={g.id} style={styles.summaryRow}>
                                                <View style={{ flex: 1, gap: 2 }}>
                                                    <Text style={styles.summaryTitle}>{g.name}</Text>
                                                    <Text style={styles.summarySub} numberOfLines={2}>
                                                        {names || "Sin usuarios"}
                                                    </Text>
                                                </View>
                                                <Text style={styles.summaryAmount}>R$ {money(g.amount)}</Text>
                                            </View>
                                        );
                                    })}
                                </View>
                            </View>
                        ) : null}
                    </ScrollView>

                    <View
                        style={[
                            styles.bottomBar,
                            { paddingBottom: Math.max(12, insets.bottom + 10) },
                        ]}
                    >
                        <Pressable
                            onPress={() => router.back()}
                            style={({ pressed }) => [styles.bottomBtn, pressed && styles.pressed]}
                        >
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
                            <Text style={styles.bottomBtnText}>
                                {saving ? "Guardando..." : "Guardar"}
                            </Text>
                        </Pressable>
                    </View>
                </KeyboardAvoidingView>
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
    headerSub: {
        color: COLORS.muted,
        fontWeight: "800",
        fontSize: 12,
        marginTop: 2,
    },

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

    hint: {
        color: "rgba(255,255,255,0.65)",
        fontWeight: "700",
        fontSize: 12,
        lineHeight: 18,
    },

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
    input: {
        flex: 1,
        height: 48,
        paddingHorizontal: 12,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },

    allocHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    headerActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },

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
    allocPillNeg: {
        borderColor: "rgba(248,113,113,0.35)",
        backgroundColor: "rgba(248,113,113,0.08)",
    },
    allocPillNeu: { borderColor: "rgba(255,255,255,0.10)" },

    emptyBox: {
        marginTop: 8,
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
    },
    emptyText: {
        flex: 1,
        color: "rgba(255,255,255,0.65)",
        fontWeight: "700",
        fontSize: 12,
        lineHeight: 18,
    },

    groupCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
        padding: 12,
        gap: 10,
    },
    groupTopRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    groupNameInput: {
        height: 42,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        backgroundColor: "#0B1220",
        paddingHorizontal: 12,
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    groupHint: {
        color: "rgba(255,255,255,0.60)",
        fontWeight: "800",
        fontSize: 11,
    },
    removeBtn: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(248,113,113,0.08)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.18)",
    },

    userChipsWrap: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    userChip: {
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        height: 32,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        backgroundColor: "rgba(255,255,255,0.04)",
    },
    userChipSelected: {
        backgroundColor: "rgba(255,255,255,0.10)",
        borderColor: "rgba(255,255,255,0.18)",
    },
    userChipText: {
        maxWidth: 160,
        color: COLORS.muted,
        fontWeight: "800",
        fontSize: 11,
    },
    userChipTextSelected: {
        color: COLORS.text,
        fontWeight: "900",
    },

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
    allocPrefix: {
        color: "rgba(255,255,255,0.55)",
        fontWeight: "900",
    },
    allocInput: {
        width: 72,
        color: COLORS.text,
        fontWeight: "900",
        textAlign: "right",
        padding: 0,
    },

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
    noteText: {
        flex: 1,
        color: "rgba(255,255,255,0.65)",
        fontWeight: "700",
        fontSize: 12,
        lineHeight: 18,
    },

    summaryRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    summaryTitle: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 12,
    },
    summarySub: {
        color: "rgba(255,255,255,0.55)",
        fontWeight: "800",
        fontSize: 11,
    },
    summaryAmount: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 12,
    },

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
    bottomBtnPrimary: {
        backgroundColor: "rgba(255,255,255,0.07)",
        borderColor: "rgba(255,255,255,0.12)",
    },
    bottomBtnText: { color: COLORS.text, fontWeight: "900", fontSize: 13 },
    bottomBtnTextMuted: { color: COLORS.muted, fontWeight: "900", fontSize: 13 },

    disabled: { opacity: 0.55 },
    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
});