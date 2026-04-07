import { Ionicons } from "@expo/vector-icons";
import {
    collection,
    getDocs,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Pressable,
    RefreshControl,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AdminBackground from "../../components/admin/AdminBackground";
import { db } from "../../config/firebase";

type AutoAssignLogDoc = {
    id: string;

    leadId?: string;
    leadName?: string | null;
    leadPhone?: string | null;
    leadBusiness?: string | null;

    leadGeoAdminDisplayLabel?: string | null;
    leadGeoAdminCityLabel?: string | null;
    leadGeoAdminStateLabel?: string | null;
    leadGeoHubLabel?: string | null;

    userId?: string;
    userName?: string | null;
    userCoverageLabel?: string | null;

    matchType?: "city" | "hub_city" | "state" | "country" | string | null;
    coverageKey?: string | null;

    createdAt: number;
    dayKey?: string;
    mode?: string | null;
};

function safeString(v?: string | null) {
    return String(v ?? "").trim();
}

function safeText(v?: string | null) {
    return safeString(v).toLowerCase();
}

function todayDayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function formatHour(ms?: number | null) {
    if (!ms || !Number.isFinite(ms)) return "—";
    try {
        return new Date(ms).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "—";
    }
}

function matchTypeLabel(matchType?: string | null) {
    const t = safeString(matchType);

    if (t === "city") return "Asignado por ciudad";
    if (t === "hub_city") return "Asignado por hub";
    if (t === "state") return "Asignado por estado";
    if (t === "country") return "Asignado por país";
    return "Match";
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",

    primary: "#2563EB",
    softPrimary: "#93C5FD",

    ok: "#86EFAC",
    rejected: "#F87171",
    purple: "#C4B5FD",
    amber: "#FDE68A",
};

export default function AdminAutoAssignHistoryScreen() {
    const insets = useSafeAreaInsets();

    const [rows, setRows] = useState<AutoAssignLogDoc[]>([]);
    const [loading, setLoading] = useState(false);
    const [q, setQ] = useState("");

    const loadTodayLogs = useCallback(async () => {
        setLoading(true);
        try {
            const dayKey = todayDayKey();

            const qy = query(
                collection(db, "autoAssignLogs"),
                where("dayKey", "==", dayKey),
                orderBy("createdAt", "desc")
            );

            const snap = await getDocs(qy);

            const items: AutoAssignLogDoc[] = snap.docs.map((docSnap) => {
                const data = docSnap.data() as Omit<AutoAssignLogDoc, "id">;
                return {
                    id: docSnap.id,
                    ...data,
                };
            });

            setRows(items);
        } catch (e: any) {
            console.log("[AdminAutoAssignHistoryScreen] load error:", e?.code, e?.message);
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTodayLogs();
    }, [loadTodayLogs]);

    const filteredRows = useMemo(() => {
        const qt = q.trim().toLowerCase();
        if (!qt) return rows;

        return rows.filter((row) => {
            const hay = [
                safeText(row.leadName),
                safeText(row.leadPhone),
                safeText(row.leadBusiness),
                safeText(row.leadGeoAdminDisplayLabel),
                safeText(row.leadGeoHubLabel),
                safeText(row.userName),
                safeText(row.userCoverageLabel),
                safeText(row.matchType),
                safeText(row.coverageKey),
            ].join(" ");

            return hay.includes(qt);
        });
    }, [rows, q]);

    const summary = useMemo(() => {
        const total = rows.length;
        const byUser = new Set(rows.map((x) => safeString(x.userId)).filter(Boolean)).size;

        let city = 0;
        let hub = 0;
        let state = 0;
        let country = 0;

        for (const row of rows) {
            const t = safeString(row.matchType);
            if (t === "city") city += 1;
            else if (t === "hub_city") hub += 1;
            else if (t === "state") state += 1;
            else if (t === "country") country += 1;
        }

        return { total, byUser, city, hub, state, country };
    }, [rows]);

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            <AdminBackground>
                <View style={[styles.header, { paddingTop: 10 }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.hTitle}>Autoasignaciones de hoy</Text>
                        <Text style={styles.hSub} numberOfLines={1}>
                            Total <Text style={styles.hStrong}>{summary.total}</Text> · Usuarios{" "}
                            <Text style={styles.hStrong}>{summary.byUser}</Text> · Ciudad{" "}
                            <Text style={styles.hStrong}>{summary.city}</Text> · Hub{" "}
                            <Text style={styles.hStrong}>{summary.hub}</Text>
                        </Text>
                    </View>

                    <Pressable
                        onPress={loadTodayLogs}
                        disabled={loading}
                        style={({ pressed }) => [
                            styles.refreshBtn,
                            pressed && !loading && styles.btnPressed,
                            loading && styles.btnDisabled,
                        ]}
                    >
                        <Ionicons
                            name={loading ? "sync-outline" : "refresh-outline"}
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
                        placeholder="Buscar..."
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
                    data={filteredRows}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={{
                        paddingHorizontal: 16,
                        paddingBottom: Math.max(24, insets.bottom + 24),
                        gap: 12,
                    }}
                    refreshControl={
                        <RefreshControl refreshing={loading} onRefresh={loadTodayLogs} tintColor="#fff" />
                    }
                    renderItem={({ item }) => {
                        const leadTitle =
                            safeString(item.leadName) ||
                            safeString(item.leadPhone) ||
                            "Lead";

                        const leadBusiness = safeString(item.leadBusiness);
                        const adminGeo = safeString(item.leadGeoAdminDisplayLabel);
                        const hubGeo = safeString(item.leadGeoHubLabel);
                        const userName = safeString(item.userName) || "Usuario";
                        const userCoverage = safeString(item.userCoverageLabel);
                        const timeText = formatHour(item.createdAt);
                        const mt = safeString(item.matchType);

                        return (
                            <View style={styles.card}>
                                <View style={styles.topRow}>
                                    <View style={{ flex: 1, gap: 4 }}>
                                        <Text style={styles.userName} numberOfLines={1}>
                                            {userName}
                                        </Text>

                                        {!!userCoverage ? (
                                            <Text style={styles.userCoverage} numberOfLines={1}>
                                                {userCoverage}
                                            </Text>
                                        ) : (
                                            <Text style={styles.userCoverageMuted}>
                                                Sin cobertura visible
                                            </Text>
                                        )}
                                    </View>

                                    <View style={styles.timePill}>
                                        <Ionicons name="time-outline" size={13} color={COLORS.muted} />
                                        <Text style={styles.timeText}>{timeText}</Text>
                                    </View>
                                </View>

                                <View style={styles.divider} />

                                <View style={{ gap: 4 }}>
                                    <Text style={styles.leadTitle} numberOfLines={1}>
                                        {leadTitle}
                                    </Text>

                                    {!!leadBusiness ? (
                                        <Text style={styles.leadBusiness} numberOfLines={1}>
                                            {leadBusiness}
                                        </Text>
                                    ) : null}

                                    {!!item.leadPhone && item.leadPhone !== leadTitle ? (
                                        <Text style={styles.leadPhone} numberOfLines={1}>
                                            {item.leadPhone}
                                        </Text>
                                    ) : null}
                                </View>

                                <View style={styles.pillsWrap}>
                                    {!!adminGeo ? (
                                        <View style={styles.geoPill}>
                                            <Ionicons
                                                name="location-outline"
                                                size={13}
                                                color={COLORS.softPrimary}
                                            />
                                            <Text style={styles.geoPillText} numberOfLines={1}>
                                                {adminGeo}
                                            </Text>
                                        </View>
                                    ) : null}

                                    {!!hubGeo && hubGeo !== adminGeo ? (
                                        <View style={styles.hubPill}>
                                            <Ionicons
                                                name="trail-sign-outline"
                                                size={13}
                                                color={COLORS.purple}
                                            />
                                            <Text style={styles.hubPillText} numberOfLines={1}>
                                                {hubGeo}
                                            </Text>
                                        </View>
                                    ) : null}

                                    <View
                                        style={[
                                            styles.matchPill,
                                            mt === "hub_city"
                                                ? styles.matchPillHub
                                                : mt === "city"
                                                    ? styles.matchPillCity
                                                    : mt === "state"
                                                        ? styles.matchPillState
                                                        : styles.matchPillCountry,
                                        ]}
                                    >
                                        <Ionicons
                                            name={
                                                mt === "hub_city"
                                                    ? "git-branch-outline"
                                                    : mt === "city"
                                                        ? "business-outline"
                                                        : mt === "state"
                                                            ? "map-outline"
                                                            : "globe-outline"
                                            }
                                            size={13}
                                            color={
                                                mt === "hub_city"
                                                    ? COLORS.purple
                                                    : mt === "city"
                                                        ? COLORS.ok
                                                        : mt === "state"
                                                            ? COLORS.amber
                                                            : COLORS.softPrimary
                                            }
                                        />
                                        <Text
                                            style={[
                                                styles.matchPillText,
                                                mt === "hub_city"
                                                    ? styles.matchPillTextHub
                                                    : mt === "city"
                                                        ? styles.matchPillTextCity
                                                        : mt === "state"
                                                            ? styles.matchPillTextState
                                                            : styles.matchPillTextCountry,
                                            ]}
                                        >
                                            {matchTypeLabel(mt)}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        );
                    }}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <Ionicons name="flash-outline" size={26} color={COLORS.muted} />
                            <Text style={styles.emptyText}>
                                {q.trim()
                                    ? "No hay resultados con ese filtro."
                                    : "Aún no hay autoasignaciones registradas hoy."}
                            </Text>
                        </View>
                    }
                />
            </AdminBackground>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },

    header: {
        paddingHorizontal: 16,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    hTitle: {
        color: COLORS.text,
        fontSize: 22,
        fontWeight: "900",
        letterSpacing: 0.4,
    },
    hSub: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        marginTop: 4,
    },
    hStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },

    refreshBtn: {
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
    searchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
    },
    clearBtn: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 10,
    },

    topRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
    },

    userName: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },
    userCoverage: {
        color: COLORS.softPrimary,
        fontSize: 12,
        fontWeight: "800",
    },
    userCoverageMuted: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
        opacity: 0.75,
    },

    timePill: {
        minHeight: 30,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    timeText: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "900",
    },

    divider: {
        height: 1,
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    leadTitle: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },
    leadBusiness: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },
    leadPhone: {
        color: COLORS.text,
        opacity: 0.88,
        fontSize: 12,
        fontWeight: "800",
    },

    pillsWrap: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
    },

    geoPill: {
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
    geoPillText: {
        color: COLORS.softPrimary,
        fontSize: 11,
        fontWeight: "900",
        flexShrink: 1,
    },

    hubPill: {
        minHeight: 30,
        maxWidth: "100%",
        borderRadius: 999,
        paddingHorizontal: 10,
        backgroundColor: "rgba(124,58,237,0.14)",
        borderWidth: 1,
        borderColor: "rgba(124,58,237,0.32)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    hubPillText: {
        color: COLORS.purple,
        fontSize: 11,
        fontWeight: "900",
        flexShrink: 1,
    },

    matchPill: {
        minHeight: 30,
        borderRadius: 999,
        paddingHorizontal: 10,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    matchPillCity: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.30)",
    },
    matchPillHub: {
        backgroundColor: "rgba(124,58,237,0.14)",
        borderColor: "rgba(124,58,237,0.32)",
    },
    matchPillState: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.30)",
    },
    matchPillCountry: {
        backgroundColor: "rgba(37,99,235,0.12)",
        borderColor: "rgba(37,99,235,0.30)",
    },
    matchPillText: {
        fontSize: 11,
        fontWeight: "900",
    },
    matchPillTextCity: {
        color: COLORS.ok,
    },
    matchPillTextHub: {
        color: COLORS.purple,
    },
    matchPillTextState: {
        color: COLORS.amber,
    },
    matchPillTextCountry: {
        color: COLORS.softPrimary,
    },

    empty: {
        marginTop: 48,
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 20,
    },
    emptyText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "900",
        textAlign: "center",
    },

    btnPressed: {
        transform: [{ scale: 0.99 }],
        opacity: 0.96,
    },
    btnDisabled: {
        opacity: 0.55,
    },
});