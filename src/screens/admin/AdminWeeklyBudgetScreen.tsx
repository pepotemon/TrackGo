// src/screens/admin/AdminWeeklyBudgetScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    BackHandler,
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
    deleteWeeklyInvestmentGroupTemplate,
    subscribeWeeklyInvestment,
    subscribeWeeklyInvestmentGroupTemplates,
    syncWeeklyGroupsToTemplates,
    upsertWeeklyInvestment,
    type WeeklyInvestmentAllocations,
    type WeeklyInvestmentGroup,
    type WeeklyInvestmentGroupTemplate,
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

type StepKey = "home" | "budget" | "groups" | "groupEditor";

function makeGroupId() {
    return `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeEmptyGroupDraft(index: number): GroupDraft {
    return {
        id: makeGroupId(),
        name: `Grupo ${index + 1}`,
        amount: "",
        userIds: [],
    };
}

function draftFromRemoteGroups(
    groups: WeeklyInvestmentGroup[] | undefined,
    users: UserDoc[],
    legacyAllocations?: WeeklyInvestmentAllocations
): GroupDraft[] {
    const cleanGroups = Array.isArray(groups) ? groups : [];

    if (cleanGroups.length > 0) {
        return cleanGroups.map((g, idx) => ({
            id: String(g.id || `group_${idx + 1}`),
            name: String(g.name || `Grupo ${idx + 1}`),
            amount: g.amount > 0 ? String(clamp2(g.amount)) : "",
            userIds: Array.isArray(g.userIds) ? g.userIds.filter(Boolean) : [],
        }));
    }

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

function templateToDraft(template: WeeklyInvestmentGroupTemplate): GroupDraft {
    return {
        id: makeGroupId(),
        name: String(template.name || "Grupo"),
        amount: template.defaultAmount > 0 ? String(clamp2(template.defaultAmount)) : "",
        userIds: Array.isArray(template.userIds) ? [...template.userIds] : [],
    };
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
    const [templates, setTemplates] = useState<WeeklyInvestmentGroupTemplate[]>([]);
    const [budgetDraft, setBudgetDraft] = useState<string>("0");
    const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>([]);
    const [saving, setSaving] = useState(false);

    const [step, setStep] = useState<StepKey>("home");
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

    const [editorDraft, setEditorDraft] = useState<GroupDraft | null>(null);
    const [isNewEditorDraft, setIsNewEditorDraft] = useState(false);

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

    useEffect(() => {
        const unsub = subscribeWeeklyInvestmentGroupTemplates((items) => {
            setTemplates(items ?? []);
        });

        return () => unsub();
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
                lastRemoteAllocRef.current =
                    remoteAlloc && typeof remoteAlloc === "object" ? remoteAlloc : {};

                if (!draftDirtyRef.current) setBudgetDraft(String(amt));
                if (!groupsDirtyRef.current) {
                    hydrateGroupsFromRemote(
                        lastRemoteGroupsRef.current,
                        lastRemoteAllocRef.current
                    );
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
        return clamp2(groupDrafts.reduce((sum, g) => sum + parseMoney(g.amount), 0));
    }, [groupDrafts]);

    const remainingDraft = useMemo(
        () => clamp2(totalDraft - totalGroupsDraft),
        [totalDraft, totalGroupsDraft]
    );

    const onChangeBudgetDraft = (txt: string) => {
        draftDirtyRef.current = true;
        setBudgetDraft(txt);
    };

    const removeGroup = (groupId: string) => {
        groupsDirtyRef.current = true;
        setGroupDrafts((prev) => prev.filter((g) => g.id !== groupId));
        if (editingGroupId === groupId) {
            setEditingGroupId(null);
            setEditorDraft(null);
            setIsNewEditorDraft(false);
            setStep("groups");
        }
    };

    const toggleUserInEditorDraft = (userId: string) => {
        setEditorDraft((prev) => {
            if (!prev) return prev;
            const has = prev.userIds.includes(userId);
            return {
                ...prev,
                userIds: has
                    ? prev.userIds.filter((id) => id !== userId)
                    : [...prev.userIds, userId],
            };
        });
    };

    const updateEditorDraft = (patch: Partial<GroupDraft>) => {
        setEditorDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    };

    const discardEditorAndGoGroups = () => {
        setEditingGroupId(null);
        setEditorDraft(null);
        setIsNewEditorDraft(false);
        setStep("groups");
    };

    const resetAll = () => {
        draftDirtyRef.current = false;
        groupsDirtyRef.current = false;
        setBudgetDraft(String(lastRemoteAmountRef.current || 0));
        hydrateGroupsFromRemote(lastRemoteGroupsRef.current, lastRemoteAllocRef.current);
        setStep("home");
        setEditingGroupId(null);
        setEditorDraft(null);
        setIsNewEditorDraft(false);
    };

    const confirmSplitEqual = () => {
        Alert.alert(
            "Reparto individual",
            "¿Deseas repartir el presupuesto de manera individual entre todos los usuarios?",
            [
                { text: "Cancelar", style: "cancel" },
                {
                    text: "Repartir",
                    style: "default",
                    onPress: () => {
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
                        setStep("groups");
                    },
                },
            ]
        );
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

    const derivedAllocations = useMemo(() => {
        const out: WeeklyInvestmentAllocations = {};
        for (const g of normalizedGroups) {
            const share =
                g.userIds.length > 0 ? clamp2(g.amount / g.userIds.length) : 0;
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

            await syncWeeklyGroupsToTemplates(normalizedGroups, weekStartKey);

            draftDirtyRef.current = false;
            groupsDirtyRef.current = false;
            setStep("home");
            setEditingGroupId(null);
            setEditorDraft(null);
            setIsNewEditorDraft(false);

            Alert.alert(
                "Guardado",
                "La inversión semanal fue guardada y los grupos quedaron disponibles para reutilizar."
            );
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo guardar.");
        } finally {
            setSaving(false);
        }
    };

    const openGroupEditor = (groupId: string) => {
        const existing = groupDrafts.find((g) => g.id === groupId);
        if (!existing) return;

        setEditingGroupId(groupId);
        setEditorDraft({
            id: existing.id,
            name: existing.name,
            amount: existing.amount,
            userIds: [...existing.userIds],
        });
        setIsNewEditorDraft(false);
        setStep("groupEditor");
    };

    const goToNewGroup = () => {
        const temp = makeEmptyGroupDraft(groupDrafts.length);
        setEditingGroupId(temp.id);
        setEditorDraft(temp);
        setIsNewEditorDraft(true);
        setStep("groupEditor");
    };

    const applyTemplate = (template: WeeklyInvestmentGroupTemplate) => {
        const nextDraft = templateToDraft(template);

        Alert.alert(
            "Usar grupo guardado",
            `¿Deseas agregar "${template.name}" a esta semana?`,
            [
                { text: "Cancelar", style: "cancel" },
                {
                    text: "Agregar",
                    style: "default",
                    onPress: () => {
                        groupsDirtyRef.current = true;
                        setGroupDrafts((prev) => [...prev, nextDraft]);
                    },
                },
            ]
        );
    };

    const confirmDeleteTemplate = (template: WeeklyInvestmentGroupTemplate) => {
        Alert.alert(
            "Eliminar grupo guardado",
            `¿Deseas eliminar "${template.name}" de la biblioteca? Esto no borra las semanas antiguas.`,
            [
                { text: "Cancelar", style: "cancel" },
                {
                    text: "Eliminar",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            await deleteWeeklyInvestmentGroupTemplate(template.id);
                        } catch (e: any) {
                            Alert.alert(
                                "Error",
                                e?.message ?? "No se pudo eliminar el grupo guardado."
                            );
                        }
                    },
                },
            ]
        );
    };

    const validGroupsCount = normalizedGroups.length;

    const saveEditorGroup = () => {
        if (!editorDraft) return;

        const amount = parseMoney(editorDraft.amount);
        if (amount <= 0) {
            Alert.alert("Grupo", "Indica un monto mayor que 0.");
            return;
        }
        if (!editorDraft.userIds.length) {
            Alert.alert("Grupo", "Selecciona al menos un usuario.");
            return;
        }

        groupsDirtyRef.current = true;

        setGroupDrafts((prev) => {
            const exists = prev.some((g) => g.id === editorDraft.id);

            if (exists) {
                return prev.map((g) => (g.id === editorDraft.id ? editorDraft : g));
            }

            return [...prev, editorDraft];
        });

        setEditingGroupId(null);
        setEditorDraft(null);
        setIsNewEditorDraft(false);
        setStep("groups");
    };

    const goBackStep = () => {
        if (step === "budget") {
            setStep("home");
            return true;
        }
        if (step === "groups") {
            setStep("budget");
            return true;
        }
        if (step === "groupEditor") {
            discardEditorAndGoGroups();
            return true;
        }

        router.back();
        return true;
    };

    useEffect(() => {
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            return goBackStep();
        });

        return () => sub.remove();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, editingGroupId, editorDraft]);

    const confirmFinishAndSave = () => {
        Alert.alert(
            "Guardar cambios",
            "¿Deseas guardar los cambios de la inversión semanal?",
            [
                { text: "Cancelar", style: "cancel" },
                {
                    text: "Guardar",
                    style: "default",
                    onPress: () => {
                        void save();
                    },
                },
            ]
        );
    };

    const goNextStep = () => {
        if (step === "budget") {
            setStep("groups");
            return;
        }

        if (step === "groups") {
            confirmFinishAndSave();
            return;
        }

        if (step === "groupEditor") {
            saveEditorGroup();
        }
    };

    const renderProgress = () => {
        if (step === "home") return null;

        const activeIndex =
            step === "budget" ? 1 : step === "groups" ? 2 : 3;

        const items = [
            { n: 1, label: "Presupuesto", icon: "wallet-outline" as const, tone: "cyan" },
            { n: 2, label: "Grupos", icon: "layers-outline" as const, tone: "purple" },
            { n: 3, label: "Editar grupo", icon: "create-outline" as const, tone: "green" },
        ];

        return (
            <View style={styles.progressWrap}>
                {items.map((item, idx) => {
                    const active = activeIndex === item.n;
                    const done = activeIndex > item.n;
                    const showLine = idx < items.length - 1;

                    const toneStyle =
                        item.tone === "cyan"
                            ? styles.progressCircleToneCyan
                            : item.tone === "purple"
                                ? styles.progressCircleTonePurple
                                : styles.progressCircleToneGreen;

                    const toneTextStyle =
                        item.tone === "cyan"
                            ? styles.progressTextToneCyan
                            : item.tone === "purple"
                                ? styles.progressTextTonePurple
                                : styles.progressTextToneGreen;

                    return (
                        <React.Fragment key={item.n}>
                            <View style={styles.progressItem}>
                                <View
                                    style={[
                                        styles.progressCircle,
                                        active && toneStyle,
                                        done && styles.progressCircleDone,
                                    ]}
                                >
                                    <Ionicons
                                        name={done ? "checkmark" : item.icon}
                                        size={15}
                                        color={active || done ? COLORS.text : COLORS.muted}
                                    />
                                </View>

                                <Text
                                    style={[
                                        styles.progressText,
                                        active && toneTextStyle,
                                        done && styles.progressTextDone,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {item.label}
                                </Text>
                            </View>

                            {showLine ? (
                                <View
                                    style={[
                                        styles.progressLine,
                                        activeIndex > item.n && styles.progressLineDone,
                                    ]}
                                />
                            ) : null}
                        </React.Fragment>
                    );
                })}
            </View>
        );
    };

    const renderHome = () => {
        return (
            <>
                <View style={styles.heroCard}>
                    <View style={styles.heroIconWrap}>
                        <Ionicons name="wallet-outline" size={28} color={COLORS.primaryBright} />
                    </View>

                    <Text style={styles.heroEyebrow}>Mi inversión de esta semana</Text>
                    <Text style={styles.heroAmount}>R$ {money(totalDraft)}</Text>
                    <Text style={styles.heroSub}>
                        {validGroupsCount} grupos usados · restante R$ {money(remainingDraft)}
                    </Text>

                    <Pressable
                        onPress={() => setStep("budget")}
                        style={({ pressed }) => [styles.primaryInlineBtn, pressed && styles.pressed]}
                    >
                        <Ionicons name="create-outline" size={16} color={COLORS.text} />
                        <Text style={styles.primaryInlineBtnText}>Editar</Text>
                    </Pressable>
                </View>

                <View style={styles.card}>
                    <View style={styles.titleRow}>
                        <View style={[styles.titleIconWrap, styles.titleIconWrapPurple]}>
                            <Ionicons
                                name="sparkles-outline"
                                size={16}
                                color={COLORS.purple}
                            />
                        </View>
                        <Text style={styles.sectionTitle}>Resumen de guardado</Text>
                    </View>

                    <View style={styles.kpisRow}>
                        <View style={[styles.kpiCard, styles.kpiCardBlue]}>
                            <Ionicons name="cash-outline" size={18} color={COLORS.primaryBright} />
                            <Text style={styles.kpiLabel}>Presupuesto</Text>
                            <Text style={styles.kpiValue}>R$ {money(totalDraft)}</Text>
                        </View>

                        <View style={[styles.kpiCard, styles.kpiCardPurple]}>
                            <Ionicons name="albums-outline" size={18} color={COLORS.purple} />
                            <Text style={styles.kpiLabel}>Asignado</Text>
                            <Text style={styles.kpiValue}>R$ {money(totalGroupsDraft)}</Text>
                        </View>

                        <View
                            style={[
                                styles.kpiCard,
                                remainingDraft < 0 ? styles.kpiCardDanger : styles.kpiCardWarn,
                            ]}
                        >
                            <Ionicons
                                name={remainingDraft < 0 ? "alert-circle-outline" : "time-outline"}
                                size={18}
                                color={remainingDraft < 0 ? COLORS.bad : COLORS.warn}
                            />
                            <Text style={styles.kpiLabel}>Restante</Text>
                            <Text
                                style={[
                                    styles.kpiValue,
                                    remainingDraft < 0 && styles.kpiValueDanger,
                                ]}
                            >
                                R$ {money(remainingDraft)}
                            </Text>
                        </View>
                    </View>

                    {normalizedGroups.length > 0 ? (
                        <View style={{ gap: 10 }}>
                            {normalizedGroups.map((g, idx) => {
                                const names = g.userIds
                                    .map(
                                        (uid) =>
                                            usersById.get(uid)?.name?.trim() ||
                                            usersById.get(uid)?.email?.trim() ||
                                            uid
                                    )
                                    .join(", ");

                                const iconColor =
                                    idx % 3 === 0
                                        ? COLORS.primaryBright
                                        : idx % 3 === 1
                                            ? COLORS.purple
                                            : COLORS.ok;

                                const iconWrapStyle =
                                    idx % 3 === 0
                                        ? styles.summaryIconWrapCyan
                                        : idx % 3 === 1
                                            ? styles.summaryIconWrapPurple
                                            : styles.summaryIconWrapGreen;

                                return (
                                    <View key={g.id} style={styles.summaryRow}>
                                        <View style={[styles.summaryIconWrap, iconWrapStyle]}>
                                            <Ionicons
                                                name="people-outline"
                                                size={16}
                                                color={iconColor}
                                            />
                                        </View>

                                        <View style={{ flex: 1, gap: 2 }}>
                                            <Text style={styles.summaryTitle}>{g.name}</Text>
                                            <Text style={styles.summarySub} numberOfLines={2}>
                                                {names || "Sin usuarios"}
                                            </Text>
                                        </View>

                                        <Text style={styles.summaryAmount}>
                                            R$ {money(g.amount)}
                                        </Text>
                                    </View>
                                );
                            })}
                        </View>
                    ) : (
                        <View style={styles.emptyBox}>
                            <Ionicons name="wallet-outline" size={20} color={COLORS.primarySoft} />
                            <Text style={styles.emptyText}>
                                Aún no has configurado grupos de inversión para esta semana.
                            </Text>
                        </View>
                    )}
                </View>

                <View style={styles.card}>
                    <View style={styles.titleRow}>
                        <View style={[styles.titleIconWrap, styles.titleIconWrapBlueSoft]}>
                            <Ionicons name="time-outline" size={16} color={COLORS.info} />
                        </View>
                        <Text style={styles.sectionTitle}>Biblioteca reutilizable</Text>
                    </View>

                    {templates.length === 0 ? (
                        <View style={styles.emptyBox}>
                            <Ionicons name="archive-outline" size={20} color={COLORS.primarySoft} />
                            <Text style={styles.emptyText}>
                                Cuando guardes grupos de una semana, quedarán aquí para reutilizarlos.
                            </Text>
                        </View>
                    ) : (
                        <Text style={styles.templatesCountText}>
                            {templates.length} grupos guardados para próximas semanas.
                        </Text>
                    )}
                </View>
            </>
        );
    };

    const renderGroupsStep = () => {
        return (
            <>
                <View style={[styles.card, styles.stepCard]}>
                    <View style={styles.stepHeader}>
                        <View style={[styles.stepBadge, styles.stepBadgePurple]}>
                            <Ionicons name="layers-outline" size={13} color={COLORS.purple} />
                            <Text style={styles.stepBadgeTextPurple}>Paso 2</Text>
                        </View>

                        <View style={styles.titleRow}>
                            <View style={[styles.titleIconWrap, styles.titleIconWrapPurple]}>
                                <Ionicons name="grid-outline" size={16} color={COLORS.purple} />
                            </View>
                            <Text style={styles.sectionTitle}>Grupos de inversión</Text>
                        </View>

                        <Text style={styles.stepHint}>
                            Crea grupos nuevos o reutiliza grupos guardados de semanas anteriores.
                        </Text>
                    </View>

                    <View style={styles.allocSummaryRow}>
                        <View style={[styles.allocPill, styles.allocPillBlue]}>
                            <Text style={styles.allocPillLabel}>Presupuesto</Text>
                            <Text style={styles.allocPillValue}>R$ {money(totalDraft)}</Text>
                        </View>

                        <View style={[styles.allocPill, styles.allocPillPurple]}>
                            <Text style={styles.allocPillLabel}>Asignado</Text>
                            <Text style={styles.allocPillValue}>R$ {money(totalGroupsDraft)}</Text>
                        </View>

                        <View
                            style={[
                                styles.allocPill,
                                remainingDraft < 0 ? styles.allocPillNeg : styles.allocPillWarn,
                            ]}
                        >
                            <Text style={styles.allocPillLabel}>Restante</Text>
                            <Text style={styles.allocPillValue}>R$ {money(remainingDraft)}</Text>
                        </View>
                    </View>

                    <View style={styles.groupsActionRow}>
                        <Pressable
                            onPress={goToNewGroup}
                            style={({ pressed }) => [
                                styles.secondaryBtn,
                                styles.secondaryBtnBlue,
                                pressed && styles.pressed,
                            ]}
                        >
                            <Ionicons name="add-outline" size={16} color={COLORS.text} />
                            <Text style={styles.secondaryBtnText}>Crear grupo</Text>
                        </Pressable>

                        <Pressable
                            onPress={confirmSplitEqual}
                            style={({ pressed }) => [
                                styles.secondaryBtn,
                                styles.secondaryBtnPurple,
                                pressed && styles.pressed,
                            ]}
                        >
                            <Ionicons name="git-branch-outline" size={16} color={COLORS.text} />
                            <Text style={styles.secondaryBtnText}>Individual</Text>
                        </Pressable>
                    </View>
                </View>

                <View style={styles.card}>
                    <View style={styles.titleRow}>
                        <View style={[styles.titleIconWrap, styles.titleIconWrapBlueSoft]}>
                            <Ionicons name="archive-outline" size={16} color={COLORS.info} />
                        </View>
                        <Text style={styles.sectionTitle}>Grupos reutilizables</Text>
                    </View>

                    {templates.length === 0 ? (
                        <View style={styles.emptyBox}>
                            <Ionicons name="time-outline" size={20} color={COLORS.primarySoft} />
                            <Text style={styles.emptyText}>
                                Todavía no hay grupos guardados. Cuando finalices una semana, sus grupos quedarán aquí.
                            </Text>
                        </View>
                    ) : (
                        <View style={{ gap: 10 }}>
                            {templates.map((tpl, idx) => {
                                const names = tpl.userIds
                                    .map(
                                        (uid) =>
                                            usersById.get(uid)?.name?.trim() ||
                                            usersById.get(uid)?.email?.trim() ||
                                            uid
                                    )
                                    .join(", ");

                                const cardStyle =
                                    idx % 3 === 0
                                        ? styles.groupListCardCyan
                                        : idx % 3 === 1
                                            ? styles.groupListCardPurple
                                            : styles.groupListCardGreen;

                                const iconStyle =
                                    idx % 3 === 0
                                        ? styles.groupListIconWrapCyan
                                        : idx % 3 === 1
                                            ? styles.groupListIconWrapPurple
                                            : styles.groupListIconWrapGreen;

                                const iconColor =
                                    idx % 3 === 0
                                        ? COLORS.primaryBright
                                        : idx % 3 === 1
                                            ? COLORS.purple
                                            : COLORS.ok;

                                return (
                                    <View
                                        key={tpl.id}
                                        style={[styles.groupListCard, cardStyle, styles.templateCard]}
                                    >
                                        <Pressable
                                            onPress={() => applyTemplate(tpl)}
                                            style={({ pressed }) => [
                                                styles.templateMainPressable,
                                                pressed && styles.pressed,
                                            ]}
                                        >
                                            <View style={[styles.groupListIconWrap, iconStyle]}>
                                                <Ionicons
                                                    name="archive-outline"
                                                    size={18}
                                                    color={iconColor}
                                                />
                                            </View>

                                            <View style={{ flex: 1, gap: 4 }}>
                                                <Text style={styles.groupListTitle}>
                                                    {tpl.name?.trim() || "Grupo"}
                                                </Text>
                                                <Text style={styles.groupListSub} numberOfLines={2}>
                                                    {tpl.userIds.length} usuarios · R$ {money(tpl.defaultAmount)}
                                                </Text>
                                                <Text style={styles.templateNames} numberOfLines={2}>
                                                    {names}
                                                </Text>
                                            </View>
                                        </Pressable>

                                        <View style={styles.templateActions}>
                                            <Pressable
                                                onPress={() => applyTemplate(tpl)}
                                                style={({ pressed }) => [
                                                    styles.templateActionBtn,
                                                    pressed && styles.pressed,
                                                ]}
                                            >
                                                <Ionicons
                                                    name="arrow-down-circle-outline"
                                                    size={16}
                                                    color={COLORS.primaryBright}
                                                />
                                            </Pressable>

                                            <Pressable
                                                onPress={() => confirmDeleteTemplate(tpl)}
                                                style={({ pressed }) => [
                                                    styles.templateActionBtn,
                                                    styles.templateActionBtnDanger,
                                                    pressed && styles.pressed,
                                                ]}
                                            >
                                                <Ionicons
                                                    name="trash-outline"
                                                    size={16}
                                                    color={COLORS.bad}
                                                />
                                            </Pressable>
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>

                <View style={styles.card}>
                    <View style={styles.titleRow}>
                        <View style={[styles.titleIconWrap, styles.titleIconWrapBlueSoft]}>
                            <Ionicons name="albums-outline" size={16} color={COLORS.info} />
                        </View>
                        <Text style={styles.sectionTitle}>Grupos de esta semana</Text>
                    </View>

                    {groupDrafts.length === 0 ? (
                        <View style={styles.emptyBox}>
                            <Ionicons name="layers-outline" size={20} color={COLORS.primarySoft} />
                            <Text style={styles.emptyText}>
                                No hay grupos aún. Puedes crear uno nuevo o reutilizar uno guardado.
                            </Text>
                        </View>
                    ) : (
                        <View style={{ gap: 10 }}>
                            {groupDrafts.map((g, idx) => {
                                const amountNum = parseMoney(g.amount);

                                const cardStyle =
                                    idx % 3 === 0
                                        ? styles.groupListCardCyan
                                        : idx % 3 === 1
                                            ? styles.groupListCardPurple
                                            : styles.groupListCardGreen;

                                const iconStyle =
                                    idx % 3 === 0
                                        ? styles.groupListIconWrapCyan
                                        : idx % 3 === 1
                                            ? styles.groupListIconWrapPurple
                                            : styles.groupListIconWrapGreen;

                                const iconColor =
                                    idx % 3 === 0
                                        ? COLORS.primaryBright
                                        : idx % 3 === 1
                                            ? COLORS.purple
                                            : COLORS.ok;

                                return (
                                    <Pressable
                                        key={g.id}
                                        onPress={() => openGroupEditor(g.id)}
                                        style={({ pressed }) => [
                                            styles.groupListCard,
                                            cardStyle,
                                            pressed && styles.pressed,
                                        ]}
                                    >
                                        <View style={[styles.groupListIconWrap, iconStyle]}>
                                            <Ionicons
                                                name="people-circle-outline"
                                                size={18}
                                                color={iconColor}
                                            />
                                        </View>

                                        <View style={{ flex: 1, gap: 4 }}>
                                            <Text style={styles.groupListTitle}>
                                                {g.name?.trim() || `Grupo ${idx + 1}`}
                                            </Text>
                                            <Text style={styles.groupListSub}>
                                                {g.userIds.length} usuarios · R$ {money(amountNum)}
                                            </Text>
                                        </View>

                                        <View style={styles.groupListRight}>
                                            <Ionicons
                                                name="chevron-forward"
                                                size={18}
                                                color={COLORS.primarySoft}
                                            />
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </View>
                    )}
                </View>
            </>
        );
    };

    const renderGroupEditor = () => {
        if (!editorDraft) {
            return (
                <View style={styles.card}>
                    <View style={styles.emptyBox}>
                        <Ionicons name="alert-circle-outline" size={20} color={COLORS.muted} />
                        <Text style={styles.emptyText}>No se encontró el grupo seleccionado.</Text>
                    </View>
                </View>
            );
        }

        const amountNum = parseMoney(editorDraft.amount);

        return (
            <>
                <View style={[styles.card, styles.stepCard]}>
                    <View style={styles.stepHeader}>
                        <View style={[styles.stepBadge, styles.stepBadgeGreen]}>
                            <Ionicons name="create-outline" size={13} color={COLORS.ok} />
                            <Text style={styles.stepBadgeTextGreen}>Paso 3</Text>
                        </View>

                        <View style={styles.titleRow}>
                            <View style={[styles.titleIconWrap, styles.titleIconWrapGreen]}>
                                <Ionicons name="construct-outline" size={16} color={COLORS.ok} />
                            </View>
                            <Text style={styles.sectionTitle}>
                                {isNewEditorDraft ? "Crear grupo" : "Editar grupo"}
                            </Text>
                        </View>

                        <Text style={styles.stepHint}>
                            Selecciona usuarios y define el presupuesto del grupo.
                        </Text>
                    </View>

                    <View style={styles.fieldBlock}>
                        <Text style={styles.fieldLabel}>Nombre del grupo</Text>
                        <TextInput
                            value={editorDraft.name}
                            onChangeText={(t) => updateEditorDraft({ name: t })}
                            placeholder="Ej: Grupo Norte"
                            placeholderTextColor="rgba(255,255,255,0.35)"
                            style={styles.fieldInput}
                        />
                    </View>

                    <View style={styles.fieldBlock}>
                        <Text style={styles.fieldLabel}>Presupuesto del grupo</Text>
                        <View style={styles.inputRow}>
                            <View style={styles.moneyPrefix}>
                                <Text style={styles.moneyPrefixText}>R$</Text>
                            </View>

                            <TextInput
                                value={editorDraft.amount}
                                onChangeText={(t) => updateEditorDraft({ amount: t })}
                                keyboardType="numeric"
                                placeholder="0"
                                placeholderTextColor="rgba(255,255,255,0.35)"
                                style={styles.input}
                            />
                        </View>
                    </View>

                    <View style={styles.miniResumeRow}>
                        <View style={[styles.miniResumePill, styles.miniResumePillGreen]}>
                            <Text style={styles.miniResumeLabel}>Miembros</Text>
                            <Text style={styles.miniResumeValue}>{editorDraft.userIds.length}</Text>
                        </View>
                        <View style={[styles.miniResumePill, styles.miniResumePillBlue]}>
                            <Text style={styles.miniResumeLabel}>Monto</Text>
                            <Text style={styles.miniResumeValue}>R$ {money(amountNum)}</Text>
                        </View>
                    </View>

                    <View style={styles.noteCard}>
                        <Ionicons
                            name="archive-outline"
                            size={18}
                            color={COLORS.info}
                        />
                        <Text style={styles.noteText}>
                            Cuando guardes la semana, este grupo quedará disponible para reutilizar en próximas semanas.
                        </Text>
                    </View>
                </View>

                <View style={styles.card}>
                    <View style={styles.titleRow}>
                        <View style={[styles.titleIconWrap, styles.titleIconWrapGreenSoft]}>
                            <Ionicons name="people-outline" size={16} color={COLORS.ok} />
                        </View>
                        <Text style={styles.sectionTitle}>Seleccionar usuarios</Text>
                    </View>

                    <View style={styles.userSelectorList}>
                        {users.map((u, idx) => {
                            const selected = editorDraft.userIds.includes(u.id);
                            const label =
                                u?.name?.trim() || u?.email?.trim() || "Usuario";

                            const rowTone =
                                idx % 3 === 0
                                    ? styles.userSelectRowToneCyan
                                    : idx % 3 === 1
                                        ? styles.userSelectRowTonePurple
                                        : styles.userSelectRowToneGreen;

                            return (
                                <Pressable
                                    key={u.id}
                                    onPress={() => toggleUserInEditorDraft(u.id)}
                                    style={({ pressed }) => [
                                        styles.userSelectRow,
                                        rowTone,
                                        selected && styles.userSelectRowActive,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <View style={styles.userSelectLeft}>
                                        <Ionicons
                                            name={selected ? "checkmark-circle" : "ellipse-outline"}
                                            size={18}
                                            color={selected ? COLORS.primaryBright : COLORS.muted}
                                        />
                                        <Text
                                            style={[
                                                styles.userSelectText,
                                                selected && styles.userSelectTextActive,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {label}
                                        </Text>
                                    </View>

                                    <Ionicons
                                        name="person-outline"
                                        size={16}
                                        color={selected ? COLORS.primaryBright : COLORS.muted}
                                    />
                                </Pressable>
                            );
                        })}
                    </View>

                    {!isNewEditorDraft ? (
                        <Pressable
                            onPress={() => removeGroup(editorDraft.id)}
                            style={({ pressed }) => [styles.deleteInlineBtn, pressed && styles.pressed]}
                        >
                            <Ionicons name="trash-outline" size={16} color={COLORS.bad} />
                            <Text style={styles.deleteInlineBtnText}>Eliminar grupo</Text>
                        </Pressable>
                    ) : null}
                </View>
            </>
        );
    };

    const renderStepContent = () => {
        if (step === "budget") return renderBudgetStep();
        if (step === "groups") return renderGroupsStep();
        if (step === "groupEditor") return renderGroupEditor();
        return renderHome();
    };

    const renderBudgetStep = () => {
        return (
            <View style={[styles.card, styles.stepCard]}>
                <View style={styles.stepHeader}>
                    <View style={[styles.stepBadge, styles.stepBadgePrimary]}>
                        <Ionicons name="wallet-outline" size={13} color={COLORS.primaryBright} />
                        <Text style={styles.stepBadgeText}>Paso 1</Text>
                    </View>

                    <View style={styles.titleRow}>
                        <View style={[styles.titleIconWrap, styles.titleIconWrapCyan]}>
                            <Ionicons name="cash-outline" size={16} color={COLORS.primaryBright} />
                        </View>
                        <Text style={styles.sectionTitle}>Añadir presupuesto</Text>
                    </View>

                    <Text style={styles.stepHint}>
                        Define cuánto vas a invertir esta semana.
                    </Text>
                </View>

                <View style={styles.bigInputWrap}>
                    <View style={styles.bigInputIconWrap}>
                        <Ionicons name="logo-usd" size={18} color={COLORS.primaryBright} />
                    </View>
                    <Text style={styles.bigMoneyPrefix}>R$</Text>
                    <TextInput
                        value={budgetDraft}
                        onChangeText={onChangeBudgetDraft}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor="rgba(255,255,255,0.35)"
                        style={styles.bigInput}
                    />
                </View>

                <View style={styles.noteCard}>
                    <Ionicons
                        name="information-circle-outline"
                        size={18}
                        color={COLORS.info}
                    />
                    <Text style={styles.noteText}>
                        Después podrás repartirlo entre grupos de inversión nuevos o reutilizados.
                    </Text>
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
            <AdminBackground>
                <View style={styles.header}>
                    <Pressable
                        onPress={resetAll}
                        style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                    >
                        <Ionicons name="refresh-outline" size={18} color={COLORS.primaryBright} />
                    </Pressable>

                    <View style={styles.headerCenter}>
                        <Text style={styles.headerTitle}>Presupuesto semanal</Text>
                        <Text style={styles.headerSub} numberOfLines={1}>
                            {weekStartKey || "—"} → {weekEndKey || "—"}
                        </Text>
                    </View>

                    <View style={styles.headerBtnGhost} />
                </View>

                {renderProgress()}

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
                            {
                                paddingBottom:
                                    step === "home"
                                        ? Math.max(16, insets.bottom + 20)
                                        : Math.max(16, insets.bottom + 16) + 84,
                            },
                        ]}
                    >
                        {renderStepContent()}
                    </ScrollView>

                    {step !== "home" ? (
                        <View
                            style={[
                                styles.bottomBar,
                                { paddingBottom: Math.max(12, insets.bottom + 10) },
                            ]}
                        >
                            <Pressable
                                onPress={goBackStep}
                                style={({ pressed }) => [styles.bottomBtn, pressed && styles.pressed]}
                            >
                                <Ionicons name="arrow-back-outline" size={18} color={COLORS.primarySoft} />
                                <Text style={styles.bottomBtnTextMuted}>Atrás</Text>
                            </Pressable>

                            <Pressable
                                onPress={goNextStep}
                                disabled={saving}
                                style={({ pressed }) => [
                                    styles.bottomBtn,
                                    styles.bottomBtnPrimary,
                                    saving && styles.disabled,
                                    pressed && !saving && styles.pressed,
                                ]}
                            >
                                <Ionicons
                                    name={
                                        step === "groupEditor"
                                            ? "checkmark-outline"
                                            : step === "groups"
                                                ? "checkmark-done-outline"
                                                : "arrow-forward-outline"
                                    }
                                    size={18}
                                    color={COLORS.text}
                                />
                                <Text style={styles.bottomBtnText}>
                                    {saving
                                        ? "Guardando..."
                                        : step === "groupEditor"
                                            ? "Guardar grupo"
                                            : step === "groups"
                                                ? "Finalizar"
                                                : "Siguiente"}
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}
                </KeyboardAvoidingView>
            </AdminBackground>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#07111F",
    card: "rgba(10, 20, 37, 0.74)",
    cardStrong: "rgba(8, 17, 31, 0.88)",
    border: "rgba(255,255,255,0.08)",
    borderSoft: "rgba(125, 211, 252, 0.16)",

    text: "#F8FAFC",
    muted: "#9FB0C4",
    softText: "#CBD5E1",

    primary: "#5AC8FA",
    primaryBright: "#7BE0FF",
    primarySoft: "#BFDBFE",

    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",
    info: "#60A5FA",
    purple: "#C4B5FD",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    header: {
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    headerBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: COLORS.borderSoft,
        alignItems: "center",
        justifyContent: "center",
    },
    headerBtnGhost: {
        width: 42,
        height: 42,
    },
    headerCenter: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
    },
    headerTitle: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 18,
        textAlign: "center",
    },
    headerSub: {
        color: COLORS.muted,
        fontWeight: "800",
        fontSize: 12,
        textAlign: "center",
    },

    progressWrap: {
        marginHorizontal: 16,
        marginBottom: 12,
        flexDirection: "row",
        alignItems: "center",
    },
    progressItem: {
        alignItems: "center",
        gap: 6,
        minWidth: 70,
    },
    progressCircle: {
        width: 34,
        height: 34,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: "rgba(255,255,255,0.04)",
        alignItems: "center",
        justifyContent: "center",
    },
    progressCircleToneCyan: {
        backgroundColor: "rgba(90,200,250,0.16)",
        borderColor: "rgba(90,200,250,0.30)",
    },
    progressCircleTonePurple: {
        backgroundColor: "rgba(196,181,253,0.14)",
        borderColor: "rgba(196,181,253,0.30)",
    },
    progressCircleToneGreen: {
        backgroundColor: "rgba(34,197,94,0.14)",
        borderColor: "rgba(34,197,94,0.30)",
    },
    progressCircleDone: {
        backgroundColor: "rgba(90,200,250,0.22)",
        borderColor: "rgba(90,200,250,0.36)",
    },
    progressText: {
        color: COLORS.muted,
        fontSize: 10,
        fontWeight: "800",
        textAlign: "center",
    },
    progressTextToneCyan: {
        color: COLORS.primarySoft,
    },
    progressTextTonePurple: {
        color: COLORS.purple,
    },
    progressTextToneGreen: {
        color: "#86EFAC",
    },
    progressTextDone: {
        color: COLORS.primarySoft,
    },
    progressLine: {
        flex: 1,
        height: 2,
        marginHorizontal: 8,
        backgroundColor: "rgba(255,255,255,0.08)",
        borderRadius: 999,
    },
    progressLineDone: {
        backgroundColor: "rgba(90,200,250,0.40)",
    },

    content: {
        paddingHorizontal: 16,
        gap: 12,
        paddingTop: 2,
    },

    heroCard: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.borderSoft,
        borderRadius: 24,
        padding: 18,
        alignItems: "center",
        gap: 8,
        overflow: "hidden",
    },
    heroIconWrap: {
        width: 58,
        height: 58,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(90,200,250,0.10)",
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.22)",
    },
    heroEyebrow: {
        color: COLORS.primarySoft,
        fontWeight: "800",
        fontSize: 13,
        textAlign: "center",
    },
    heroAmount: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 32,
        textAlign: "center",
    },
    heroSub: {
        color: COLORS.softText,
        fontWeight: "800",
        fontSize: 12,
        textAlign: "center",
        opacity: 0.95,
    },

    primaryInlineBtn: {
        marginTop: 8,
        height: 42,
        paddingHorizontal: 16,
        borderRadius: 999,
        backgroundColor: "rgba(90,200,250,0.16)",
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.26)",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    primaryInlineBtnText: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 20,
        padding: 14,
        gap: 12,
    },
    stepCard: {
        borderColor: COLORS.borderSoft,
    },

    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    titleIconWrap: {
        width: 28,
        height: 28,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    titleIconWrapCyan: {
        backgroundColor: "rgba(90,200,250,0.10)",
        borderColor: "rgba(90,200,250,0.18)",
    },
    titleIconWrapPurple: {
        backgroundColor: "rgba(196,181,253,0.10)",
        borderColor: "rgba(196,181,253,0.18)",
    },
    titleIconWrapGreen: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.18)",
    },
    titleIconWrapGreenSoft: {
        backgroundColor: "rgba(34,197,94,0.08)",
        borderColor: "rgba(34,197,94,0.16)",
    },
    titleIconWrapBlueSoft: {
        backgroundColor: "rgba(96,165,250,0.10)",
        borderColor: "rgba(96,165,250,0.18)",
    },
    sectionTitle: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 15,
    },

    stepHeader: {
        gap: 8,
    },
    stepBadge: {
        alignSelf: "flex-start",
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderWidth: 1,
    },
    stepBadgePrimary: {
        backgroundColor: "rgba(90,200,250,0.12)",
        borderColor: "rgba(90,200,250,0.26)",
    },
    stepBadgePurple: {
        backgroundColor: "rgba(196,181,253,0.12)",
        borderColor: "rgba(196,181,253,0.24)",
    },
    stepBadgeGreen: {
        backgroundColor: "rgba(34,197,94,0.12)",
        borderColor: "rgba(34,197,94,0.24)",
    },
    stepBadgeText: {
        color: COLORS.primarySoft,
        fontWeight: "900",
        fontSize: 11,
    },
    stepBadgeTextPurple: {
        color: COLORS.purple,
        fontWeight: "900",
        fontSize: 11,
    },
    stepBadgeTextGreen: {
        color: "#86EFAC",
        fontWeight: "900",
        fontSize: 11,
    },
    stepHint: {
        color: COLORS.softText,
        fontWeight: "700",
        fontSize: 12,
        lineHeight: 18,
        opacity: 0.92,
    },

    bigInputWrap: {
        height: 72,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.18)",
        backgroundColor: COLORS.cardStrong,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    bigInputIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(90,200,250,0.08)",
    },
    bigMoneyPrefix: {
        color: COLORS.primarySoft,
        fontWeight: "900",
        fontSize: 22,
    },
    bigInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 28,
        fontWeight: "900",
        padding: 0,
    },

    kpisRow: {
        flexDirection: "row",
        gap: 10,
    },
    kpiCard: {
        flex: 1,
        minHeight: 88,
        borderRadius: 16,
        padding: 12,
        borderWidth: 1,
        justifyContent: "space-between",
    },
    kpiCardBlue: {
        backgroundColor: "rgba(90,200,250,0.10)",
        borderColor: "rgba(90,200,250,0.22)",
    },
    kpiCardPurple: {
        backgroundColor: "rgba(196,181,253,0.10)",
        borderColor: "rgba(196,181,253,0.18)",
    },
    kpiCardWarn: {
        backgroundColor: "rgba(251,191,36,0.08)",
        borderColor: "rgba(251,191,36,0.18)",
    },
    kpiCardDanger: {
        borderColor: "rgba(248,113,113,0.35)",
        backgroundColor: "rgba(248,113,113,0.08)",
    },
    kpiLabel: {
        color: COLORS.muted,
        fontWeight: "800",
        fontSize: 11,
    },
    kpiValue: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 14,
    },
    kpiValueDanger: {
        color: COLORS.bad,
    },

    allocSummaryRow: {
        flexDirection: "row",
        gap: 10,
    },
    allocPill: {
        flex: 1,
        borderRadius: 14,
        padding: 10,
        borderWidth: 1,
        gap: 4,
    },
    allocPillBlue: {
        backgroundColor: "rgba(90,200,250,0.10)",
        borderColor: "rgba(90,200,250,0.22)",
    },
    allocPillPurple: {
        backgroundColor: "rgba(196,181,253,0.10)",
        borderColor: "rgba(196,181,253,0.20)",
    },
    allocPillWarn: {
        backgroundColor: "rgba(251,191,36,0.08)",
        borderColor: "rgba(251,191,36,0.20)",
    },
    allocPillLabel: {
        color: COLORS.muted,
        fontWeight: "900",
        fontSize: 11,
    },
    allocPillValue: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    allocPillNeg: {
        borderColor: "rgba(248,113,113,0.35)",
        backgroundColor: "rgba(248,113,113,0.08)",
    },

    groupsActionRow: {
        flexDirection: "row",
        gap: 10,
    },
    secondaryBtn: {
        flex: 1,
        height: 44,
        borderRadius: 14,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    secondaryBtnBlue: {
        backgroundColor: "rgba(90,200,250,0.12)",
        borderColor: "rgba(90,200,250,0.26)",
    },
    secondaryBtnPurple: {
        backgroundColor: "rgba(196,181,253,0.12)",
        borderColor: "rgba(196,181,253,0.24)",
    },
    secondaryBtnText: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 12,
    },

    groupListCard: {
        minHeight: 68,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    groupListCardCyan: {
        borderColor: "rgba(90,200,250,0.16)",
        backgroundColor: "rgba(90,200,250,0.06)",
    },
    groupListCardPurple: {
        borderColor: "rgba(196,181,253,0.16)",
        backgroundColor: "rgba(196,181,253,0.06)",
    },
    groupListCardGreen: {
        borderColor: "rgba(34,197,94,0.14)",
        backgroundColor: "rgba(34,197,94,0.06)",
    },
    groupListIconWrap: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },
    groupListIconWrapCyan: {
        backgroundColor: "rgba(90,200,250,0.10)",
        borderColor: "rgba(90,200,250,0.18)",
    },
    groupListIconWrapPurple: {
        backgroundColor: "rgba(196,181,253,0.10)",
        borderColor: "rgba(196,181,253,0.18)",
    },
    groupListIconWrapGreen: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.18)",
    },
    groupListTitle: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 14,
    },
    groupListSub: {
        color: COLORS.muted,
        fontWeight: "800",
        fontSize: 12,
    },
    groupListRight: {
        width: 30,
        alignItems: "flex-end",
        justifyContent: "center",
    },

    templateCard: {
        alignItems: "stretch",
    },
    templateMainPressable: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    templateActions: {
        justifyContent: "center",
        gap: 8,
    },
    templateActionBtn: {
        width: 34,
        height: 34,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.16)",
        backgroundColor: "rgba(90,200,250,0.08)",
        alignItems: "center",
        justifyContent: "center",
    },
    templateActionBtnDanger: {
        borderColor: "rgba(248,113,113,0.18)",
        backgroundColor: "rgba(248,113,113,0.08)",
    },
    templateNames: {
        color: COLORS.softText,
        fontWeight: "700",
        fontSize: 11,
        opacity: 0.78,
    },
    templatesCountText: {
        color: COLORS.softText,
        fontWeight: "800",
        fontSize: 12,
    },

    fieldBlock: {
        gap: 6,
    },
    fieldLabel: {
        color: COLORS.muted,
        fontWeight: "900",
        fontSize: 12,
    },
    fieldInput: {
        height: 46,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.16)",
        backgroundColor: COLORS.cardStrong,
        paddingHorizontal: 12,
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 14,
    },

    inputRow: {
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.16)",
        backgroundColor: COLORS.cardStrong,
        borderRadius: 14,
        overflow: "hidden",
    },
    moneyPrefix: {
        paddingHorizontal: 12,
        height: 46,
        alignItems: "center",
        justifyContent: "center",
        borderRightWidth: 1,
        borderRightColor: "rgba(90,200,250,0.12)",
    },
    moneyPrefixText: {
        color: COLORS.primarySoft,
        fontWeight: "900",
    },
    input: {
        flex: 1,
        height: 46,
        paddingHorizontal: 12,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },

    miniResumeRow: {
        flexDirection: "row",
        gap: 10,
    },
    miniResumePill: {
        flex: 1,
        minHeight: 64,
        borderRadius: 14,
        padding: 10,
        borderWidth: 1,
        justifyContent: "space-between",
    },
    miniResumePillGreen: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.22)",
    },
    miniResumePillBlue: {
        backgroundColor: "rgba(90,200,250,0.10)",
        borderColor: "rgba(90,200,250,0.22)",
    },
    miniResumeLabel: {
        color: COLORS.muted,
        fontWeight: "800",
        fontSize: 11,
    },
    miniResumeValue: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 14,
    },

    userSelectorList: {
        gap: 8,
    },
    userSelectRow: {
        minHeight: 50,
        borderRadius: 14,
        paddingHorizontal: 12,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    userSelectRowToneCyan: {
        borderColor: "rgba(90,200,250,0.10)",
        backgroundColor: "rgba(90,200,250,0.04)",
    },
    userSelectRowTonePurple: {
        borderColor: "rgba(196,181,253,0.10)",
        backgroundColor: "rgba(196,181,253,0.04)",
    },
    userSelectRowToneGreen: {
        borderColor: "rgba(34,197,94,0.10)",
        backgroundColor: "rgba(34,197,94,0.04)",
    },
    userSelectRowActive: {
        backgroundColor: "rgba(90,200,250,0.10)",
        borderColor: "rgba(90,200,250,0.24)",
    },
    userSelectLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        flex: 1,
    },
    userSelectText: {
        color: COLORS.muted,
        fontWeight: "800",
        fontSize: 13,
    },
    userSelectTextActive: {
        color: COLORS.text,
        fontWeight: "900",
    },

    deleteInlineBtn: {
        marginTop: 4,
        alignSelf: "flex-start",
        height: 38,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: "rgba(248,113,113,0.08)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.18)",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    deleteInlineBtnText: {
        color: COLORS.bad,
        fontWeight: "900",
        fontSize: 12,
    },

    noteCard: {
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(96,165,250,0.16)",
        backgroundColor: "rgba(96,165,250,0.06)",
        alignItems: "flex-start",
    },
    noteText: {
        flex: 1,
        color: COLORS.softText,
        fontWeight: "700",
        fontSize: 12,
        lineHeight: 18,
    },

    summaryRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    summaryIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
    },
    summaryIconWrapCyan: {
        backgroundColor: "rgba(90,200,250,0.10)",
    },
    summaryIconWrapPurple: {
        backgroundColor: "rgba(196,181,253,0.10)",
    },
    summaryIconWrapGreen: {
        backgroundColor: "rgba(34,197,94,0.10)",
    },
    summaryTitle: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    summarySub: {
        color: COLORS.softText,
        fontWeight: "800",
        fontSize: 11,
        opacity: 0.78,
    },
    summaryAmount: {
        color: COLORS.primarySoft,
        fontWeight: "900",
        fontSize: 13,
    },

    emptyBox: {
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: "rgba(90,200,250,0.12)",
        backgroundColor: "rgba(255,255,255,0.03)",
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
    },
    emptyText: {
        flex: 1,
        color: COLORS.softText,
        fontWeight: "700",
        fontSize: 12,
        lineHeight: 18,
        opacity: 0.84,
    },

    bottomBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
        paddingTop: 10,
        backgroundColor: "rgba(7,17,31,0.96)",
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
        borderColor: COLORS.borderSoft,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
    },
    bottomBtnPrimary: {
        backgroundColor: "rgba(90,200,250,0.16)",
        borderColor: "rgba(90,200,250,0.26)",
    },
    bottomBtnText: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },
    bottomBtnTextMuted: {
        color: COLORS.primarySoft,
        fontWeight: "900",
        fontSize: 13,
    },

    disabled: { opacity: 0.55 },
    pressed: { transform: [{ scale: 0.99 }], opacity: 0.96 },
});