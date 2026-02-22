import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    FlatList,
    Linking,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/useAuth";
import { subscribeUserClients, updateClientStatus } from "../src/data/repositories/clientsRepo";
import { dayKeyFromMs, subscribeDailyEventsByDay } from "../src/data/repositories/dailyEventsRepo";
import type { ClientDoc, DailyEventDoc } from "../src/types/models";

type Filter = "pending" | "visited" | "rejected" | "all";

function safeText(x?: string) {
    return (x ?? "").toLowerCase();
}

function buildCopyText(c: ClientDoc): string {
    const name = ((c as any).name ?? "").trim();
    const business = ((c as any).business ?? "").trim();
    const phone = (c.phone ?? "").trim();
    const mapsUrl = (c.mapsUrl ?? "").trim();
    const address = (c.address ?? "").trim();

    const lines: string[] = [];
    if (name) lines.push(`Nombre: ${name}`);
    if (business) lines.push(`Negocio: ${business}`);
    if (phone) lines.push(`Teléfono: ${phone}`);
    if (mapsUrl) lines.push(`Maps: ${mapsUrl}`);
    if (address) lines.push(`Dirección: ${address}`);

    return lines.join("\n");
}

function statusLabel(s?: string) {
    if (s === "visited") return "Visitado";
    if (s === "rejected") return "Rechazado";
    return "Pendiente";
}

function statusPillStyle(s?: string) {
    if (s === "visited") return styles.pillVisited;
    if (s === "rejected") return styles.pillRejected;
    return styles.pillPending;
}

function statusPillTextStyle(s?: string) {
    if (s === "visited") return styles.pillTextVisited;
    if (s === "rejected") return styles.pillTextRejected;
    return styles.pillTextPending;
}

/** ✅ Normaliza links HTTP/HTTPS para que Linking.openURL no falle por falta de esquema */
function normalizeHttpUrl(raw: string) {
    const u = (raw ?? "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) return `https://${u}`;
    return u;
}

/** ✅ WA.me requiere número con país. Brasil: 55 + DDD + número */
function normalizeBRPhoneToWa(phoneRaw: string) {
    const digits = (phoneRaw ?? "").replace(/[^\d]/g, "");
    if (!digits) return "";
    // si ya viene 55..., ok. si no, asumimos Brasil
    return digits.startsWith("55") ? digits : `55${digits}`;
}

export default function UserHome() {
    const { firebaseUser, profile, loading, logout } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    // UI
    const [filter, setFilter] = useState<Filter>("pending");
    const [q, setQ] = useState("");

    // Daily events (resumen HOY)
    const [todayEvents, setTodayEvents] = useState<DailyEventDoc[]>([]);
    const [eventsErr, setEventsErr] = useState<string | null>(null);

    // -------------------------
    // Guard de sesión / rol
    // -------------------------
    useEffect(() => {
        if (loading) return;

        if (!firebaseUser) {
            router.replace({ pathname: "/login" as any });
            return;
        }

        if (!profile || !profile.active) {
            router.replace({ pathname: "/no-access" as any });
            return;
        }

        if (profile.role !== "user") {
            router.replace({ pathname: "/admin" as any });
            return;
        }
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active]);

    // -------------------------
    // Subscripción a clients asignados
    // -------------------------
    useEffect(() => {
        if (!firebaseUser) return;
        const unsub = subscribeUserClients(firebaseUser.uid, setClients);
        return () => unsub();
    }, [firebaseUser?.uid]);

    // -------------------------
    // Subscripción a dailyEvents de HOY
    // -------------------------
    useEffect(() => {
        if (!firebaseUser) return;

        const dk = dayKeyFromMs(Date.now());
        const unsub = subscribeDailyEventsByDay(
            dk,
            firebaseUser.uid,
            (list) => {
                setEventsErr(null);
                setTodayEvents(list);
            },
            (err) => {
                setEventsErr(`${err?.code ?? "error"}: ${err?.message ?? ""}`);
            }
        );

        return () => unsub();
    }, [firebaseUser?.uid]);

    // -------------------------
    // Contadores por estado (lista)
    // -------------------------
    const counts = useMemo(() => {
        const pending = clients.filter((c) => c.status === "pending").length;
        const visited = clients.filter((c) => c.status === "visited").length;
        const rejected = clients.filter((c) => c.status === "rejected").length;
        return { pending, visited, rejected, total: clients.length };
    }, [clients]);

    // -------------------------
    // Contadores HOY (deduplicado por cliente, último evento)
    // -------------------------
    const todayCounts = useMemo(() => {
        const lastByClient = new Map<string, DailyEventDoc>();

        for (const e of todayEvents) {
            if (e.type !== "visited" && e.type !== "rejected" && e.type !== "pending") continue;
            if (!e.clientId) continue;

            const prev = lastByClient.get(e.clientId);
            if (!prev || (e.createdAt ?? 0) > (prev.createdAt ?? 0)) {
                lastByClient.set(e.clientId, e);
            }
        }

        let visited = 0;
        let rejected = 0;

        for (const e of lastByClient.values()) {
            if (e.type === "visited") visited += 1;
            if (e.type === "rejected") rejected += 1;
        }

        return { visited, rejected };
    }, [todayEvents]);

    // -------------------------
    // Lista filtrada + orden
    // -------------------------
    const filteredClients = useMemo(() => {
        const queryText = q.trim().toLowerCase();

        return clients
            .filter((c) => {
                if (filter !== "all" && c.status !== filter) return false;
                if (!queryText) return true;

                const name = safeText((c as any).name);
                const business = safeText((c as any).business);

                const hay =
                    safeText(c.phone) +
                    " " +
                    safeText(c.address) +
                    " " +
                    safeText(c.mapsUrl) +
                    " " +
                    name +
                    " " +
                    business;

                return hay.includes(queryText);
            })
            .sort((a, b) => {
                // Pendientes primero
                const ap = a.status === "pending" ? 0 : 1;
                const bp = b.status === "pending" ? 0 : 1;
                if (ap !== bp) return ap - bp;
                return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
            });
    }, [clients, filter, q]);

    // -------------------------
    // Acciones externas (✅ FIX APK: openURL directo + try/catch)
    // -------------------------
    const openWhatsApp = async (phone: string) => {
        const waDigits = normalizeBRPhoneToWa(phone);
        if (!waDigits) {
            Alert.alert("WhatsApp", "Este cliente no tiene teléfono.");
            return;
        }

        const url = `https://wa.me/${waDigits}`;

        try {
            await Linking.openURL(url);
        } catch (e) {
            Alert.alert("WhatsApp", "No se pudo abrir WhatsApp en este dispositivo.");
        }
    };

    const openMaps = async (mapsUrl?: string) => {
        const url = normalizeHttpUrl(mapsUrl ?? "");
        if (!url) {
            Alert.alert("Maps", "Este cliente no tiene link de Google Maps.");
            return;
        }

        try {
            await Linking.openURL(url);
        } catch (e) {
            Alert.alert("Maps", "No se pudo abrir el link de Maps.");
        }
    };

    const copyClient = async (c: ClientDoc) => {
        const text = buildCopyText(c);
        await Clipboard.setStringAsync(text);
        Alert.alert("Copiado", "La información del cliente fue copiada.");
    };

    // -------------------------
    // Estado: solo 1 botón cuando ya está marcado
    // -------------------------
    const confirmSetStatus = (client: ClientDoc, nextStatus: "pending" | "visited" | "rejected") => {
        const title =
            nextStatus === "pending"
                ? "Volver a pendiente"
                : nextStatus === "visited"
                    ? "Marcar como visitado"
                    : "Marcar como rechazado";

        const msg =
            nextStatus === "pending"
                ? "¿Quieres quitar el estado actual y volver a Pendiente?"
                : nextStatus === "visited"
                    ? "¿Confirmas que ya fue visitado?"
                    : "¿Confirmas que fue rechazado?";

        Alert.alert(title, msg, [
            { text: "Cancelar", style: "cancel" },
            {
                text: "Confirmar",
                style: "default",
                onPress: async () => {
                    if (!firebaseUser || !client.id) return;
                    try {
                        setBusyId(client.id);
                        await updateClientStatus(client.id, nextStatus, firebaseUser.uid);
                    } catch (e: any) {
                        Alert.alert("Error", e?.message ?? "No se pudo actualizar el estado.");
                    } finally {
                        setBusyId(null);
                    }
                },
            },
        ]);
    };

    const clearSearch = () => setQ("");

    const Chip = ({
        label,
        active,
        onPress,
        badge,
    }: {
        label: string;
        active: boolean;
        onPress: () => void;
        badge?: number;
    }) => (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}
        >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>

            {typeof badge === "number" ? (
                <View style={[styles.chipBadge, active && styles.chipBadgeActive]}>
                    <Text style={[styles.chipBadgeText, active && styles.chipBadgeTextActive]}>{badge}</Text>
                </View>
            ) : null}
        </Pressable>
    );

    const IconBtn = ({
        icon,
        onPress,
        disabled,
        label,
    }: {
        icon: any;
        onPress: () => void;
        disabled?: boolean;
        label: string;
    }) => (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            style={({ pressed }) => [
                styles.iconBtn,
                disabled && styles.iconBtnDisabled,
                pressed && !disabled && styles.iconBtnPressed,
            ]}
            accessibilityLabel={label}
        >
            <Ionicons name={icon} size={18} color={COLORS.text} />
        </Pressable>
    );

    const StatusIconBtn = ({
        kind,
        onPress,
        disabled,
    }: {
        kind: "visited" | "rejected" | "undo";
        onPress: () => void;
        disabled?: boolean;
    }) => {
        const icon = kind === "visited" ? "checkmark" : kind === "rejected" ? "close" : "refresh";
        const tint = kind === "visited" ? COLORS.visited : kind === "rejected" ? COLORS.rejected : COLORS.text;

        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                style={({ pressed }) => [
                    styles.statusIconBtn,
                    kind === "visited" && styles.statusIconBtnVisited,
                    kind === "rejected" && styles.statusIconBtnRejected,
                    kind === "undo" && styles.statusIconBtnUndo,
                    disabled && styles.statusIconBtnDisabled,
                    pressed && !disabled && styles.statusIconBtnPressed,
                ]}
            >
                <Ionicons name={icon} size={18} color={tint} />
            </Pressable>
        );
    };

    const renderItem = ({ item }: { item: ClientDoc }) => {
        const name = ((item as any).name ?? "").trim() || "Cliente";
        const business = ((item as any).business ?? "").trim();
        const phone = (item.phone ?? "").trim();
        const address = (item.address ?? "").trim();
        const mapsUrl = (item.mapsUrl ?? "").trim();
        const isBusy = busyId === item.id;

        const isPending = item.status === "pending";

        return (
            <View style={styles.card}>
                <View style={styles.cardTop}>
                    <View style={styles.cardTitleWrap}>
                        <Text numberOfLines={1} style={styles.clientName}>
                            {name}
                        </Text>
                        {business ? <Text numberOfLines={1} style={styles.clientBusiness}>{business}</Text> : null}
                    </View>

                    <View style={[styles.pill, statusPillStyle(item.status)]}>
                        <Text style={[styles.pillText, statusPillTextStyle(item.status)]}>{statusLabel(item.status)}</Text>
                    </View>
                </View>

                <View style={styles.cardInfo}>
                    {phone ? (
                        <View style={styles.infoRow}>
                            <Ionicons name="call-outline" size={16} color={COLORS.muted} />
                            <Text style={styles.infoText}>{phone}</Text>
                        </View>
                    ) : null}

                    {address ? (
                        <View style={styles.infoRow}>
                            <Ionicons name="location-outline" size={16} color={COLORS.muted} />
                            <Text numberOfLines={2} style={styles.infoText}>{address}</Text>
                        </View>
                    ) : null}
                </View>

                <View style={styles.actionsRow}>
                    <View style={styles.actionsLeft}>
                        <IconBtn
                            icon="logo-whatsapp"
                            label="Abrir WhatsApp"
                            onPress={() => openWhatsApp(phone)}
                            disabled={!phone || isBusy}
                        />
                        <IconBtn
                            icon="map-outline"
                            label="Abrir Maps"
                            onPress={() => openMaps(mapsUrl)}
                            disabled={!mapsUrl || isBusy}
                        />
                        <IconBtn icon="copy-outline" label="Copiar datos" onPress={() => copyClient(item)} disabled={isBusy} />
                    </View>

                    <View style={styles.actionsRight}>
                        {isPending ? (
                            <>
                                <StatusIconBtn kind="visited" onPress={() => confirmSetStatus(item, "visited")} disabled={isBusy} />
                                <StatusIconBtn kind="rejected" onPress={() => confirmSetStatus(item, "rejected")} disabled={isBusy} />
                            </>
                        ) : (
                            <StatusIconBtn kind="undo" onPress={() => confirmSetStatus(item, "pending")} disabled={isBusy} />
                        )}
                    </View>
                </View>

                {isBusy ? (
                    <View style={styles.busyRow}>
                        <Text style={styles.busyText}>Actualizando…</Text>
                    </View>
                ) : null}
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" translucent={false} backgroundColor={COLORS.bg} />

            <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 8) }]}>
                <View style={styles.headerLeft}>
                    <Text style={styles.hTitle}>TrackGo</Text>
                    <Text style={styles.hSub}>
                        Hoy: <Text style={styles.hSubStrong}>{todayCounts.visited}</Text> visitados ·{" "}
                        <Text style={styles.hSubStrong}>{todayCounts.rejected}</Text> rechazados
                    </Text>
                    {eventsErr ? <Text style={styles.hErr}>{eventsErr}</Text> : null}
                </View>

                <Pressable onPress={logout} style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutBtnPressed]}>
                    <Ionicons name="log-out-outline" size={18} color={COLORS.text} />
                </Pressable>
            </View>

            <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar cliente, negocio, teléfono…"
                    placeholderTextColor={COLORS.muted}
                    style={styles.searchInput}
                />
                {!!q ? (
                    <Pressable onPress={clearSearch} style={styles.clearBtn}>
                        <Ionicons name="close" size={18} color={COLORS.text} />
                    </Pressable>
                ) : null}
            </View>

            <View style={styles.chipsRow}>
                <Chip label="Pendientes" active={filter === "pending"} onPress={() => setFilter("pending")} badge={counts.pending} />
                <Chip label="Visitados" active={filter === "visited"} onPress={() => setFilter("visited")} badge={counts.visited} />
                <Chip label="Rechazados" active={filter === "rejected"} onPress={() => setFilter("rejected")} badge={counts.rejected} />
                <Chip label="Todos" active={filter === "all"} onPress={() => setFilter("all")} badge={counts.total} />
            </View>

            <FlatList
                data={filteredClients}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="people-outline" size={24} color={COLORS.muted} />
                        <Text style={styles.emptyText}>No hay clientes con ese filtro.</Text>
                    </View>
                }
            />
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
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    header: {
        paddingHorizontal: 16,
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerLeft: { flex: 1, gap: 2 },
    hTitle: { color: COLORS.text, fontSize: 22, fontWeight: "900", letterSpacing: 0.5 },
    hSub: { color: COLORS.muted, fontSize: 13, fontWeight: "700", marginTop: 2 },
    hSubStrong: { color: COLORS.text, fontWeight: "900" },
    hErr: { marginTop: 6, color: COLORS.rejected, fontSize: 12, fontWeight: "800" },

    logoutBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    logoutBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.95 },

    searchWrap: {
        marginHorizontal: 16,
        marginTop: 6,
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

    chipsRow: {
        paddingHorizontal: 16,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 8,
    },
    chip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        height: 36,
        borderRadius: 999,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    chipActive: {
        borderColor: "rgba(34,197,94,0.35)",
        backgroundColor: "rgba(37,99,235,0.14)",
    },
    chipPressed: { transform: [{ scale: 0.98 }], opacity: 0.96 },
    chipText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    chipTextActive: { color: COLORS.text },
    chipBadge: {
        minWidth: 26,
        height: 22,
        paddingHorizontal: 8,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },
    chipBadgeActive: { backgroundColor: "rgba(34,197,94,0.14)" },
    chipBadgeText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
    chipBadgeTextActive: { color: COLORS.text },

    listContent: { paddingHorizontal: 16, paddingBottom: 22, paddingTop: 10, gap: 12 },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 12,
    },

    cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
    cardTitleWrap: { flex: 1, gap: 2 },
    clientName: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
    clientBusiness: { color: COLORS.muted, fontSize: 13, fontWeight: "700" },

    pill: { paddingHorizontal: 10, height: 28, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    pillText: { fontSize: 12, fontWeight: "900" },
    pillPending: { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.35)" },
    pillTextPending: { color: "#FDE68A" },
    pillVisited: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.35)" },
    pillTextVisited: { color: "#86EFAC" },
    pillRejected: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)" },
    pillTextRejected: { color: "#FCA5A5" },

    cardInfo: { gap: 6 },
    infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    infoText: { flex: 1, color: COLORS.text, opacity: 0.9, fontSize: 13, fontWeight: "700" },

    actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 2 },
    actionsLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    actionsRight: { flexDirection: "row", alignItems: "center", gap: 10 },

    iconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    iconBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.96 },
    iconBtnDisabled: { opacity: 0.4 },

    statusIconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },
    statusIconBtnVisited: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.30)" },
    statusIconBtnRejected: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.30)" },
    statusIconBtnUndo: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" },
    statusIconBtnPressed: { transform: [{ scale: 0.97 }], opacity: 0.96 },
    statusIconBtnDisabled: { opacity: 0.5 },

    busyRow: { paddingTop: 4 },
    busyText: { color: COLORS.muted, fontSize: 12, fontWeight: "800" },

    empty: { marginTop: 40, alignItems: "center", gap: 10 },
    emptyText: { color: COLORS.muted, fontSize: 13, fontWeight: "800" },
});