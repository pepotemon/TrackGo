import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    FlatList,
    ImageBackground,
    KeyboardAvoidingView,
    Modal,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import bgMap from "../assets/bg-map.png";
import { useAuth } from "../src/auth/useAuth";
import { subscribeUserClients } from "../src/data/repositories/clientsRepo";
import type { ClientDoc } from "../src/types/models";

type HistoryFilter = "all" | "visited" | "rejected";

const COLORS = {
    bg: "#07111F",
    card: "rgba(10, 20, 37, 0.74)",
    border: "rgba(255,255,255,0.08)",
    borderSoft: "rgba(125, 211, 252, 0.16)",

    text: "#F8FAFC",
    muted: "#9FB0C4",
    softText: "#CBD5E1",

    primary: "#5AC8FA",
    primaryBright: "#7BE0FF",

    navFilter: "#C4B5FD",
    navFilterBright: "#DDD6FE",
    navFilterBg: "rgba(196,181,253,0.14)",
    navFilterBorder: "rgba(196,181,253,0.26)",

    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",

    navBg: "rgba(7, 14, 27, 1)",
    navBorder: "rgba(255,255,255,0.08)",
    navItem: "rgba(255,255,255,0.04)",

    headerBg: "rgba(3,10,20,0.96)",
};

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toMillis === "function") return v.toMillis();
    if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function safeText(x?: string | null) {
    return String(x ?? "").trim().toLowerCase();
}

function normalizePhone(raw?: string | null) {
    return String(raw ?? "").replace(/\D+/g, "");
}

function safeStatus(value?: string | null): "pending" | "visited" | "rejected" {
    if (value === "visited") return "visited";
    if (value === "rejected") return "rejected";
    return "pending";
}

function formatStatusDateLabel(ms?: number) {
    if (!ms || !Number.isFinite(ms)) return "—";

    const d = new Date(ms);
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const targetStart = new Date(d);
    targetStart.setHours(0, 0, 0, 0);

    if (targetStart.getTime() === todayStart.getTime()) return "Hoy";
    if (targetStart.getTime() === yesterdayStart.getTime()) return "Ayer";

    const day = String(d.getDate()).padStart(2, "0");
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const month = months[d.getMonth()];
    const year = d.getFullYear();

    return `${day} ${month} ${year}`;
}

function buildTitle(c: ClientDoc) {
    const name = String((c as any)?.name ?? "").trim();
    const business = String((c as any)?.business ?? "").trim();
    return name || business || c.phone || "Cliente";
}

function buildSubtitle(c: ClientDoc) {
    const business = String((c as any)?.business ?? "").trim();
    const address = String(c.address ?? "").trim();
    const phone = String(c.phone ?? "").trim();

    if (business && business !== buildTitle(c)) return business;
    if (address) return address;
    if (phone) return phone;
    return "Sin detalle";
}

function statusLabel(status: "visited" | "rejected") {
    return status === "visited" ? "Visitado" : "Rechazado";
}

function getStatusDateMs(c: ClientDoc) {
    return (
        toMs((c as any)?.statusAt) ||
        toMs((c as any)?.updatedAt) ||
        toMs((c as any)?.assignedAt) ||
        toMs((c as any)?.createdAt)
    );
}

function BottomNavIcon({
    icon,
    active,
    onPress,
    badge,
    tint,
    activeTint,
    tone = "default",
}: {
    icon: keyof typeof Ionicons.glyphMap;
    active?: boolean;
    onPress: () => void;
    badge?: number;
    tint?: string;
    activeTint?: string;
    tone?: "default" | "filter" | "map";
}) {
    const iconColor = active
        ? activeTint ?? (tone === "filter" ? COLORS.navFilterBright : COLORS.primaryBright)
        : tint ?? (tone === "filter" ? COLORS.navFilter : COLORS.primaryBright);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.bottomIconBtn,
                active && (tone === "filter" ? styles.bottomIconBtnActiveFilter : styles.bottomIconBtnActiveMap),
                pressed && styles.pressed,
            ]}
        >
            <View
                style={[
                    styles.bottomIconInner,
                    tone === "filter" && styles.bottomIconInnerFilter,
                    tone === "map" && styles.bottomIconInnerMap,
                    active && tone === "filter" && styles.bottomIconInnerFilterActive,
                    active && tone === "map" && styles.bottomIconInnerMapActive,
                ]}
            >
                <Ionicons name={icon} size={18} color={iconColor} />
                {typeof badge === "number" ? (
                    <View style={styles.bottomIconBadge}>
                        <Text style={styles.bottomIconBadgeText}>{badge}</Text>
                    </View>
                ) : null}
            </View>
        </Pressable>
    );
}

export default function UserHistoryScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { firebaseUser, profile, loading } = useAuth();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [filter, setFilter] = useState<HistoryFilter>("all");
    const [q, setQ] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);

    const [headerHeight, setHeaderHeight] = useState(146);
    const searchInputRef = useRef<TextInput | null>(null);

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
    }, [loading, firebaseUser, profile, router]);

    useEffect(() => {
        if (!firebaseUser?.uid) return;

        const unsub = subscribeUserClients(firebaseUser.uid, (list) => {
            setClients(list ?? []);
        });

        return () => unsub();
    }, [firebaseUser?.uid]);

    useEffect(() => {
        if (!searchOpen) return;
        const t = setTimeout(() => {
            searchInputRef.current?.focus();
        }, 120);
        return () => clearTimeout(t);
    }, [searchOpen]);

    const historyClients = useMemo(() => {
        return clients.filter((c) => {
            const s = safeStatus(c.status);
            return s === "visited" || s === "rejected";
        });
    }, [clients]);

    const summary = useMemo(() => {
        let visited = 0;
        let rejected = 0;

        for (const c of historyClients) {
            const s = safeStatus(c.status);
            if (s === "visited") visited += 1;
            if (s === "rejected") rejected += 1;
        }

        return {
            visited,
            rejected,
            total: visited + rejected,
        };
    }, [historyClients]);

    const filteredClients = useMemo(() => {
        const qtText = q.trim().toLowerCase();
        const qtDigits = normalizePhone(q);

        return historyClients
            .filter((c) => {
                const status = safeStatus(c.status);

                if (filter === "visited" && status !== "visited") return false;
                if (filter === "rejected" && status !== "rejected") return false;

                if (!qtText && !qtDigits) return true;

                if (qtDigits) {
                    const ph = normalizePhone(c.phone);
                    if (ph.includes(qtDigits)) return true;
                }

                if (qtText) {
                    const hay = `
                        ${safeText((c as any)?.name)}
                        ${safeText((c as any)?.business)}
                        ${safeText((c as any)?.businessRaw)}
                        ${safeText(c.address)}
                        ${safeText(c.phone)}
                    `;
                    return hay.includes(qtText);
                }

                return true;
            })
            .slice()
            .sort((a, b) => getStatusDateMs(b) - getStatusDateMs(a));
    }, [historyClients, filter, q]);

    const footerHeight = 92 + Math.max(insets.bottom, 6);
    const listBottomPadding = footerHeight + 24;

    const closeSearchMode = () => {
        setSearchOpen(false);
    };

    const clearSearch = () => setQ("");

    const renderItem = ({ item }: { item: ClientDoc }) => {
        const status = safeStatus(item.status) as "visited" | "rejected";
        const dateLabel = formatStatusDateLabel(getStatusDateMs(item));
        const title = buildTitle(item);
        const subtitle = buildSubtitle(item);
        const phone = String(item.phone ?? "").trim();
        const address = String(item.address ?? "").trim();

        return (
            <Pressable onPress={() => searchOpen && closeSearchMode()} style={styles.card}>
                <View style={styles.cardTop}>
                    <View style={styles.cardMain}>
                        <View style={styles.cardTitleRow}>
                            <Text numberOfLines={1} style={styles.cardTitle}>
                                {title}
                            </Text>

                            <View
                                style={[
                                    styles.statusPill,
                                    status === "visited" ? styles.statusPillOk : styles.statusPillBad,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.statusPillText,
                                        status === "visited"
                                            ? styles.statusPillTextOk
                                            : styles.statusPillTextBad,
                                    ]}
                                >
                                    {statusLabel(status)}
                                </Text>
                            </View>
                        </View>

                        {!!subtitle && subtitle !== title ? (
                            <Text numberOfLines={1} style={styles.cardSubtitle}>
                                {subtitle}
                            </Text>
                        ) : null}
                    </View>
                </View>

                {!!address && address !== subtitle ? (
                    <View style={styles.infoRow}>
                        <Ionicons name="location-outline" size={15} color={COLORS.muted} />
                        <Text style={styles.infoText} numberOfLines={2}>
                            {address}
                        </Text>
                    </View>
                ) : null}

                {!!phone && phone !== subtitle ? (
                    <View style={styles.infoRow}>
                        <Ionicons name="call-outline" size={15} color={COLORS.muted} />
                        <Text style={styles.infoText} numberOfLines={1}>
                            {phone}
                        </Text>
                    </View>
                ) : null}

                <View style={styles.cardBottom}>
                    <View style={styles.dateBadge}>
                        <Ionicons name="time-outline" size={13} color={COLORS.muted} />
                        <Text style={styles.dateBadgeText}>{dateLabel}</Text>
                    </View>
                </View>
            </Pressable>
        );
    };

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

            <ImageBackground
                source={bgMap}
                style={styles.bg}
                imageStyle={styles.bgImage}
                resizeMode="cover"
            >
                <View style={styles.overlay}>
                    <View
                        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
                        style={[
                            styles.fixedHeader,
                            { paddingTop: Math.max(insets.top + 2, 10) },
                        ]}
                    >
                        <View style={styles.header}>
                            <View style={styles.headerLeft}>
                                <Text style={styles.title}>Historial real</Text>
                                <Text style={styles.subtitle}>
                                    Visitados y rechazados
                                </Text>
                            </View>
                        </View>

                        <View style={styles.kpiRow}>
                            <View style={[styles.kpiCard, styles.kpiCardOk]}>
                                <View style={styles.kpiTop}>
                                    <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.ok} />
                                    <Text style={styles.kpiLabel}>Visitados</Text>
                                </View>
                                <Text style={styles.kpiValue}>{summary.visited}</Text>
                            </View>

                            <View style={[styles.kpiCard, styles.kpiCardBad]}>
                                <View style={styles.kpiTop}>
                                    <Ionicons name="close-circle-outline" size={18} color={COLORS.bad} />
                                    <Text style={styles.kpiLabel}>Rechazados</Text>
                                </View>
                                <Text style={styles.kpiValue}>{summary.rejected}</Text>
                            </View>
                        </View>
                    </View>

                    <View
                        pointerEvents="none"
                        style={[styles.headerScrim, { top: headerHeight - 30 }]}
                    />

                    <FlatList
                        data={filteredClients}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[
                            styles.listContent,
                            {
                                paddingTop: headerHeight + 10,
                                paddingBottom: listBottomPadding,
                            },
                        ]}
                        ListEmptyComponent={
                            <View style={styles.empty}>
                                <Ionicons name="documents-outline" size={24} color={COLORS.muted} />
                                <Text style={styles.emptyTitle}>Sin resultados</Text>
                                <Text style={styles.emptyText}>
                                    No hay clientes para el filtro seleccionado.
                                </Text>
                            </View>
                        }
                    />
                </View>

                <View pointerEvents="none" style={[styles.footerScrim, { bottom: footerHeight - 100 }]} />

                <View style={[styles.bottomFooter, { paddingBottom: Math.max(insets.bottom, 6) - 30 }]}>
                    <View style={styles.bottomFooterTopGlow} />

                    <View style={styles.bottomNavContent}>
                        <View style={styles.bottomNavLeft}>
                            <BottomNavIcon
                                icon="apps-outline"
                                active={filter === "all"}
                                onPress={() => setFilter("all")}
                                badge={summary.total}
                                tint={COLORS.navFilter}
                                activeTint={COLORS.navFilterBright}
                                tone="filter"
                            />
                            <BottomNavIcon
                                icon="checkmark"
                                active={filter === "visited"}
                                onPress={() => setFilter("visited")}
                                badge={summary.visited}
                                tint={COLORS.ok}
                                activeTint={COLORS.ok}
                                tone="filter"
                            />
                            <BottomNavIcon
                                icon="close"
                                active={filter === "rejected"}
                                onPress={() => setFilter("rejected")}
                                badge={summary.rejected}
                                tint={COLORS.bad}
                                activeTint={COLORS.bad}
                                tone="filter"
                            />
                            <BottomNavIcon
                                icon="search-outline"
                                onPress={() => setSearchOpen(true)}
                                tint={COLORS.navFilter}
                                tone="filter"
                            />
                        </View>

                        <View style={styles.bottomNavDividerWrap}>
                            <Text style={styles.bottomNavDividerText}>|</Text>
                        </View>

                        <View style={styles.bottomNavRight}>
                            <BottomNavIcon
                                icon="chevron-back-outline"
                                onPress={() => router.back()}
                                tint={COLORS.primaryBright}
                                tone="map"
                            />
                        </View>
                    </View>
                </View>
            </ImageBackground>

            <Modal visible={searchOpen} transparent animationType="fade" onRequestClose={closeSearchMode}>
                <Pressable style={styles.searchBackdrop} onPress={closeSearchMode} />
                <KeyboardAvoidingView

                    style={styles.searchModalWrap}
                >
                    <View style={styles.searchModalCard}>
                        <View style={styles.searchModalHeader}>
                            <View style={styles.searchModalIconWrap}>
                                <Ionicons name="search-outline" size={18} color={COLORS.navFilterBright} />
                            </View>
                            <Text style={styles.searchModalTitle}>Buscar cliente</Text>

                            <Pressable onPress={closeSearchMode} style={styles.searchModalClose}>
                                <Ionicons name="close" size={18} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <View style={styles.searchInputWrap}>
                            <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                            <TextInput
                                ref={searchInputRef}
                                value={q}
                                onChangeText={setQ}
                                placeholder="Nombre, negocio, teléfono, dirección…"
                                placeholderTextColor={COLORS.muted}
                                style={styles.searchInput}
                                autoCapitalize="none"
                                autoCorrect={false}
                                returnKeyType="search"
                            />
                            {!!q ? (
                                <Pressable onPress={clearSearch} style={styles.searchClearBtn}>
                                    <Ionicons name="close" size={16} color={COLORS.text} />
                                </Pressable>
                            ) : null}
                        </View>

                        <View style={styles.searchModalActions}>
                            <Pressable
                                onPress={clearSearch}
                                style={({ pressed }) => [
                                    styles.searchActionGhost,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={styles.searchActionGhostText}>Limpiar</Text>
                            </Pressable>

                            <Pressable
                                onPress={closeSearchMode}
                                style={({ pressed }) => [
                                    styles.searchActionPrimary,
                                    pressed && styles.pressed,
                                ]}
                            >
                                <Text style={styles.searchActionPrimaryText}>Listo</Text>
                            </Pressable>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    bg: { flex: 1 },

    bgImage: { opacity: 0.55 },

    overlay: {
        flex: 1,
        backgroundColor: "rgba(11,18,32,0.40)",
        paddingHorizontal: 16,
    },

    pressed: {
        transform: [{ scale: 0.99 }],
        opacity: 0.96,
    },

    fixedHeader: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        paddingHorizontal: 16,
        paddingBottom: 10,
        backgroundColor: COLORS.headerBg,
    },

    headerScrim: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 42,
        backgroundColor: "rgba(7,14,27,0.18)",
        zIndex: 19,
    },

    listContent: {
        paddingBottom: 140,
    },

    header: {
        paddingTop: 2,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },

    headerLeft: {
        flex: 1,
        gap: 2,
    },

    title: {
        color: COLORS.text,
        fontSize: 22,
        fontWeight: "900",
    },

    subtitle: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },

    kpiRow: {
        flexDirection: "row",
        gap: 12,
        marginBottom: 6,
    },

    kpiCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 12,
        gap: 6,
    },

    kpiCardOk: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.22)",
    },

    kpiCardBad: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.22)",
    },

    kpiTop: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },

    kpiLabel: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },

    kpiValue: {
        color: COLORS.text,
        fontSize: 24,
        fontWeight: "900",
    },

    card: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 18,
        padding: 14,
        gap: 10,
        marginBottom: 10,
    },

    cardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },

    cardMain: {
        flex: 1,
        gap: 4,
    },

    cardTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },

    cardTitle: {
        flex: 1,
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },

    cardSubtitle: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },

    statusPill: {
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },

    statusPillOk: {
        backgroundColor: "rgba(34,197,94,0.12)",
        borderColor: "rgba(34,197,94,0.30)",
    },

    statusPillBad: {
        backgroundColor: "rgba(248,113,113,0.12)",
        borderColor: "rgba(248,113,113,0.30)",
    },

    statusPillText: {
        fontSize: 12,
        fontWeight: "900",
    },

    statusPillTextOk: {
        color: "#86EFAC",
    },

    statusPillTextBad: {
        color: "#FCA5A5",
    },

    infoRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },

    infoText: {
        flex: 1,
        color: COLORS.text,
        opacity: 0.92,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 18,
    },

    cardBottom: {
        flexDirection: "row",
        justifyContent: "flex-end",
    },

    dateBadge: {
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },

    dateBadgeText: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "900",
    },

    empty: {
        marginTop: 18,
        alignItems: "center",
        gap: 8,
        paddingVertical: 18,
    },

    emptyTitle: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },

    emptyText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "800",
        textAlign: "center",
    },

    footerScrim: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 84,
        backgroundColor: "rgba(7, 14, 27, 0.18)",
    },

    bottomFooter: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: COLORS.navBg,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.08)",
        paddingTop: 20,
        paddingHorizontal: 12,
        minHeight: 80,
    },

    bottomFooterTopGlow: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: 1,
        backgroundColor: "rgba(255,255,255,0.02)",
    },

    bottomNavContent: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },

    bottomNavLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flex: 1,
    },

    bottomNavRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },

    bottomNavDividerWrap: {
        width: 22,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 2,
    },

    bottomNavDividerText: {
        color: "rgba(255,255,255,0.42)",
        fontSize: 28,
        fontWeight: "700",
        lineHeight: 28,
        marginTop: -2,
    },

    bottomIconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },

    bottomIconBtnActiveMap: {
        backgroundColor: "rgba(255,255,255,0.03)",
    },

    bottomIconBtnActiveFilter: {
        backgroundColor: "rgba(255,255,255,0.02)",
    },

    bottomIconInner: {
        width: 34,
        height: 34,
        borderRadius: 12,
        backgroundColor: COLORS.navItem,
        borderWidth: 1,
        borderColor: COLORS.borderSoft,
        alignItems: "center",
        justifyContent: "center",
    },

    bottomIconInnerFilter: {
        borderColor: COLORS.navFilterBorder,
        backgroundColor: "rgba(196,181,253,0.06)",
    },

    bottomIconInnerMap: {
        borderColor: "rgba(123,224,255,0.18)",
        backgroundColor: "rgba(90,200,250,0.06)",
    },

    bottomIconInnerFilterActive: {
        backgroundColor: COLORS.navFilterBg,
        borderColor: "rgba(221,214,254,0.34)",
    },

    bottomIconInnerMapActive: {
        backgroundColor: "rgba(90,200,250,0.14)",
        borderColor: "rgba(123,224,255,0.30)",
    },

    bottomIconBadge: {
        position: "absolute",
        top: -4,
        right: -6,
        minWidth: 16,
        height: 16,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.92)",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 3,
    },

    bottomIconBadgeText: {
        color: COLORS.bg,
        fontSize: 9,
        fontWeight: "900",
    },

    searchBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.58)",
    },

    searchModalWrap: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
    },

    searchModalCard: {
        width: "100%",
        maxWidth: 460,
        borderRadius: 22,
        backgroundColor: "#0B1628",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        padding: 16,
        gap: 14,
    },

    searchModalHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },

    searchModalIconWrap: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: "rgba(196,181,253,0.12)",
        borderWidth: 1,
        borderColor: "rgba(196,181,253,0.22)",
        alignItems: "center",
        justifyContent: "center",
    },

    searchModalTitle: {
        flex: 1,
        color: COLORS.text,
        fontSize: 16,
        fontWeight: "900",
    },

    searchModalClose: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },

    searchInputWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 52,
        borderRadius: 16,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        paddingHorizontal: 12,
    },

    searchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
        paddingVertical: 10,
    },

    searchClearBtn: {
        width: 30,
        height: 30,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    searchModalActions: {
        flexDirection: "row",
        gap: 10,
    },

    searchActionGhost: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
    },

    searchActionGhostText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },

    searchActionPrimary: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(196,181,253,0.14)",
        borderWidth: 1,
        borderColor: "rgba(196,181,253,0.30)",
    },

    searchActionPrimaryText: {
        color: COLORS.navFilterBright,
        fontSize: 13,
        fontWeight: "900",
    },
});