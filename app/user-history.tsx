import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ImageBackground,
    Pressable,
    ScrollView,
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
    const geo = String(
        (c as any)?.geoAdminDisplayLabel ??
        (c as any)?.geoDisplayLabel ??
        (c as any)?.geoCityLabel ??
        ""
    ).trim();

    return business || address || geo || "Sin detalle";
}

function statusLabel(status: "pending" | "visited" | "rejected") {
    if (status === "visited") return "Visitado";
    if (status === "rejected") return "Rechazado";
    return "Pendiente";
}

function statusTone(status: "pending" | "visited" | "rejected") {
    if (status === "visited") return "ok";
    if (status === "rejected") return "bad";
    return "warn";
}

function sourceLabel(c: ClientDoc) {
    const source = String((c as any)?.source ?? "").trim().toLowerCase();
    if (source === "whatsapp_meta") return "Meta / WhatsApp";
    return "Manual";
}

function parseStatusLabel(c: ClientDoc) {
    const raw = String((c as any)?.parseStatus ?? "").trim().toLowerCase();
    if (raw === "ready") return "Completo";
    if (raw === "partial") return "Parcial";
    return "Vacío";
}

function verificationStatusLabel(c: ClientDoc) {
    const raw = String((c as any)?.verificationStatus ?? "").trim().toLowerCase();
    if (raw === "verified") return "Verificado";
    if (raw === "pending_review") return "Por revisar";
    if (raw === "not_suitable") return "No apto";
    return "Incompleto";
}

function verificationTone(c: ClientDoc) {
    const raw = String((c as any)?.verificationStatus ?? "").trim().toLowerCase();
    if (raw === "verified") return "ok";
    if (raw === "pending_review") return "info";
    if (raw === "not_suitable") return "bad";
    return "warn";
}

function parseTone(c: ClientDoc) {
    const raw = String((c as any)?.parseStatus ?? "").trim().toLowerCase();
    if (raw === "ready") return "ok";
    if (raw === "partial") return "warn";
    return "neutral";
}

function sourceTone(c: ClientDoc) {
    const source = String((c as any)?.source ?? "").trim().toLowerCase();
    return source === "whatsapp_meta" ? "info" : "neutral";
}

function getStatusDateMs(c: ClientDoc) {
    return (
        toMs((c as any)?.statusAt) ||
        toMs((c as any)?.updatedAt) ||
        toMs((c as any)?.assignedAt) ||
        toMs((c as any)?.createdAt)
    );
}

function getNotSuitableReason(c: ClientDoc) {
    return String((c as any)?.notSuitableReason ?? "").trim();
}

function ToneBadge({
    label,
    tone,
    icon,
}: {
    label: string;
    tone: "ok" | "bad" | "warn" | "info" | "neutral";
    icon?: keyof typeof Ionicons.glyphMap;
}) {
    return (
        <View
            style={[
                styles.infoBadge,
                tone === "ok" && styles.infoBadgeOk,
                tone === "bad" && styles.infoBadgeBad,
                tone === "warn" && styles.infoBadgeWarn,
                tone === "info" && styles.infoBadgeInfo,
                tone === "neutral" && styles.infoBadgeNeutral,
            ]}
        >
            {icon ? <Ionicons name={icon} size={12} color={COLORS.text} /> : null}
            <Text style={styles.infoBadgeText} numberOfLines={1}>
                {label}
            </Text>
        </View>
    );
}

function FilterChip({
    label,
    icon,
    value,
    active,
    onPress,
}: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    value: number;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.filterChip,
                active && styles.filterChipActive,
                pressed && styles.pressed,
            ]}
        >
            <Ionicons
                name={icon}
                size={14}
                color={active ? COLORS.text : COLORS.muted}
            />
            <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {label}
            </Text>
            <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
                <Text style={styles.filterBadgeText}>{value}</Text>
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

    const summary = useMemo(() => {
        let visited = 0;
        let rejected = 0;
        let pending = 0;

        for (const c of clients) {
            const s = safeStatus(c.status);
            if (s === "visited") visited += 1;
            else if (s === "rejected") rejected += 1;
            else pending += 1;
        }

        return {
            visited,
            rejected,
            pending,
            totalManaged: visited + rejected,
            totalAll: clients.length,
            effectiveness:
                visited + rejected > 0 ? (visited / (visited + rejected)) * 100 : null,
        };
    }, [clients]);

    const filteredClients = useMemo(() => {
        const qtText = q.trim().toLowerCase();
        const qtDigits = normalizePhone(q);

        return clients
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
            ${safeText((c as any)?.geoAdminDisplayLabel)}
            ${safeText((c as any)?.geoDisplayLabel)}
            ${safeText((c as any)?.geoCityLabel)}
            ${safeText(c.phone)}
            ${safeText(sourceLabel(c))}
            ${safeText(parseStatusLabel(c))}
            ${safeText(verificationStatusLabel(c))}
            ${safeText(getNotSuitableReason(c))}
          `;
                    return hay.includes(qtText);
                }

                return true;
            })
            .slice()
            .sort((a, b) => getStatusDateMs(b) - getStatusDateMs(a));
    }, [clients, filter, q]);

    const visitedList = useMemo(
        () => filteredClients.filter((c) => safeStatus(c.status) === "visited"),
        [filteredClients]
    );

    const rejectedList = useMemo(
        () => filteredClients.filter((c) => safeStatus(c.status) === "rejected"),
        [filteredClients]
    );

    const filterCount = useMemo(() => {
        if (filter === "visited") return summary.visited;
        if (filter === "rejected") return summary.rejected;
        return summary.totalAll;
    }, [filter, summary]);

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
                    <ScrollView
                        contentContainerStyle={[
                            styles.content,
                            { paddingBottom: Math.max(20, insets.bottom + 18) },
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.header}>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text style={styles.title}>Historial real</Text>
                                <Text style={styles.subtitle} numberOfLines={2}>
                                    Conteo directo por estado actual del cliente
                                </Text>
                            </View>

                            <View style={styles.headerPill}>
                                <Ionicons name="shield-checkmark-outline" size={14} color={COLORS.info} />
                                <Text style={styles.headerPillText}>Fuente admin</Text>
                            </View>
                        </View>

                        <View style={styles.kpiRow}>
                            <View style={[styles.kpiCard, styles.kpiCardOk]}>
                                <View style={styles.kpiTop}>
                                    <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.ok} />
                                    <Text style={styles.kpiLabel}>Visitados</Text>
                                </View>
                                <Text style={styles.kpiValue}>{summary.visited}</Text>
                                <Text style={styles.kpiHint}>Estado actual = visited</Text>
                            </View>

                            <View style={[styles.kpiCard, styles.kpiCardBad]}>
                                <View style={styles.kpiTop}>
                                    <Ionicons name="close-circle-outline" size={18} color={COLORS.bad} />
                                    <Text style={styles.kpiLabel}>Rechazados</Text>
                                </View>
                                <Text style={styles.kpiValue}>{summary.rejected}</Text>
                                <Text style={styles.kpiHint}>Estado actual = rejected</Text>
                            </View>
                        </View>

                        <View style={styles.kpiRow}>
                            <View style={styles.kpiCard}>
                                <View style={styles.kpiTop}>
                                    <Ionicons name="analytics-outline" size={18} color={COLORS.text} />
                                    <Text style={styles.kpiLabel}>Gestionados reales</Text>
                                </View>
                                <Text style={styles.kpiValue}>{summary.totalManaged}</Text>
                                <Text style={styles.kpiHint}>Visitados + rechazados</Text>
                            </View>

                            <View style={styles.kpiCard}>
                                <View style={styles.kpiTop}>
                                    <Ionicons name="trending-up-outline" size={18} color={COLORS.info} />
                                    <Text style={styles.kpiLabel}>Efectividad</Text>
                                </View>
                                <Text style={styles.kpiValue}>
                                    {summary.effectiveness == null
                                        ? "—"
                                        : `${summary.effectiveness.toFixed(0)}%`}
                                </Text>
                                <Text style={styles.kpiHint}>visitados / gestionados</Text>
                            </View>
                        </View>

                        <View style={styles.searchWrap}>
                            <Ionicons name="search-outline" size={18} color={COLORS.muted} />
                            <TextInput
                                value={q}
                                onChangeText={setQ}
                                placeholder="Buscar por nombre, negocio o número"
                                placeholderTextColor={COLORS.muted}
                                style={styles.searchInput}
                            />
                            {!!q ? (
                                <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                                    <Ionicons name="close" size={18} color={COLORS.text} />
                                </Pressable>
                            ) : null}
                        </View>

                        <View style={styles.filtersRow}>
                            <FilterChip
                                label="Todos"
                                icon="apps-outline"
                                value={summary.totalAll}
                                active={filter === "all"}
                                onPress={() => setFilter("all")}
                            />
                            <FilterChip
                                label="Visitados"
                                icon="checkmark"
                                value={summary.visited}
                                active={filter === "visited"}
                                onPress={() => setFilter("visited")}
                            />
                            <FilterChip
                                label="Rechazados"
                                icon="close"
                                value={summary.rejected}
                                active={filter === "rejected"}
                                onPress={() => setFilter("rejected")}
                            />
                        </View>

                        <View style={styles.banner}>
                            <View style={styles.bannerDot} />
                            <Text style={styles.bannerText}>
                                Mostrando {filterCount} cliente{filterCount === 1 ? "" : "s"}{" "}
                                {filter === "all"
                                    ? "del usuario"
                                    : filter === "visited"
                                        ? "visitado(s)"
                                        : "rechazado(s)"}
                            </Text>
                        </View>

                        {filter !== "rejected" && visitedList.length > 0 ? (
                            <View style={styles.section}>
                                <View style={styles.sectionHead}>
                                    <Text style={styles.sectionTitle}>Visitados</Text>
                                    <View style={styles.sectionPillOk}>
                                        <Text style={styles.sectionPillText}>{visitedList.length}</Text>
                                    </View>
                                </View>

                                <View style={styles.list}>
                                    {visitedList.map((c) => {
                                        const dateLabel = formatStatusDateLabel(getStatusDateMs(c));
                                        const notSuitableReason = getNotSuitableReason(c);

                                        return (
                                            <View key={c.id} style={styles.card}>
                                                <View style={styles.cardTop}>
                                                    <View style={{ flex: 1, gap: 4 }}>
                                                        <View style={styles.titleRow}>
                                                            <Text style={styles.cardTitle} numberOfLines={1}>
                                                                {buildTitle(c)}
                                                            </Text>

                                                            <View style={[styles.statusPill, styles.statusPillOk]}>
                                                                <Text style={[styles.statusPillText, styles.statusPillTextOk]}>
                                                                    {statusLabel("visited")}
                                                                </Text>
                                                            </View>
                                                        </View>

                                                        <Text style={styles.cardSubtitle} numberOfLines={1}>
                                                            {buildSubtitle(c)}
                                                        </Text>
                                                    </View>
                                                </View>

                                                <View style={styles.metaRow}>
                                                    <ToneBadge
                                                        label={sourceLabel(c)}
                                                        tone={sourceTone(c)}
                                                        icon={
                                                            String((c as any)?.source ?? "").toLowerCase() === "whatsapp_meta"
                                                                ? "logo-whatsapp"
                                                                : "create-outline"
                                                        }
                                                    />
                                                    <ToneBadge
                                                        label={parseStatusLabel(c)}
                                                        tone={parseTone(c)}
                                                        icon="document-text-outline"
                                                    />
                                                    <ToneBadge
                                                        label={verificationStatusLabel(c)}
                                                        tone={verificationTone(c)}
                                                        icon="shield-checkmark-outline"
                                                    />
                                                </View>

                                                {!!String(c.address ?? "").trim() ? (
                                                    <View style={styles.infoRow}>
                                                        <Ionicons name="location-outline" size={15} color={COLORS.muted} />
                                                        <Text style={styles.infoText} numberOfLines={2}>
                                                            {c.address}
                                                        </Text>
                                                    </View>
                                                ) : null}

                                                {!!String(c.phone ?? "").trim() ? (
                                                    <View style={styles.infoRow}>
                                                        <Ionicons name="call-outline" size={15} color={COLORS.muted} />
                                                        <Text style={styles.infoText} numberOfLines={1}>
                                                            {c.phone}
                                                        </Text>
                                                    </View>
                                                ) : null}

                                                {notSuitableReason ? (
                                                    <View style={styles.notSuitableTag}>
                                                        <Ionicons name="ban-outline" size={14} color={COLORS.bad} />
                                                        <Text style={styles.notSuitableTagText} numberOfLines={2}>
                                                            {notSuitableReason}
                                                        </Text>
                                                    </View>
                                                ) : null}

                                                <View style={styles.cardBottom}>
                                                    <View style={styles.dateBadge}>
                                                        <Ionicons name="time-outline" size={13} color={COLORS.muted} />
                                                        <Text style={styles.dateBadgeText}>{dateLabel}</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        );
                                    })}
                                </View>
                            </View>
                        ) : null}

                        {filter !== "visited" && rejectedList.length > 0 ? (
                            <View style={styles.section}>
                                <View style={styles.sectionHead}>
                                    <Text style={styles.sectionTitle}>Rechazados</Text>
                                    <View style={styles.sectionPillBad}>
                                        <Text style={styles.sectionPillText}>{rejectedList.length}</Text>
                                    </View>
                                </View>

                                <View style={styles.list}>
                                    {rejectedList.map((c) => {
                                        const dateLabel = formatStatusDateLabel(getStatusDateMs(c));
                                        const notSuitableReason = getNotSuitableReason(c);

                                        return (
                                            <View key={c.id} style={styles.card}>
                                                <View style={styles.cardTop}>
                                                    <View style={{ flex: 1, gap: 4 }}>
                                                        <View style={styles.titleRow}>
                                                            <Text style={styles.cardTitle} numberOfLines={1}>
                                                                {buildTitle(c)}
                                                            </Text>

                                                            <View style={[styles.statusPill, styles.statusPillBad]}>
                                                                <Text style={[styles.statusPillText, styles.statusPillTextBad]}>
                                                                    {statusLabel("rejected")}
                                                                </Text>
                                                            </View>
                                                        </View>

                                                        <Text style={styles.cardSubtitle} numberOfLines={1}>
                                                            {buildSubtitle(c)}
                                                        </Text>
                                                    </View>
                                                </View>

                                                <View style={styles.metaRow}>
                                                    <ToneBadge
                                                        label={sourceLabel(c)}
                                                        tone={sourceTone(c)}
                                                        icon={
                                                            String((c as any)?.source ?? "").toLowerCase() === "whatsapp_meta"
                                                                ? "logo-whatsapp"
                                                                : "create-outline"
                                                        }
                                                    />
                                                    <ToneBadge
                                                        label={parseStatusLabel(c)}
                                                        tone={parseTone(c)}
                                                        icon="document-text-outline"
                                                    />
                                                    <ToneBadge
                                                        label={verificationStatusLabel(c)}
                                                        tone={verificationTone(c)}
                                                        icon="shield-checkmark-outline"
                                                    />
                                                </View>

                                                {!!String(c.address ?? "").trim() ? (
                                                    <View style={styles.infoRow}>
                                                        <Ionicons name="location-outline" size={15} color={COLORS.muted} />
                                                        <Text style={styles.infoText} numberOfLines={2}>
                                                            {c.address}
                                                        </Text>
                                                    </View>
                                                ) : null}

                                                {!!String(c.phone ?? "").trim() ? (
                                                    <View style={styles.infoRow}>
                                                        <Ionicons name="call-outline" size={15} color={COLORS.muted} />
                                                        <Text style={styles.infoText} numberOfLines={1}>
                                                            {c.phone}
                                                        </Text>
                                                    </View>
                                                ) : null}

                                                {notSuitableReason ? (
                                                    <View style={styles.notSuitableTag}>
                                                        <Ionicons name="ban-outline" size={14} color={COLORS.bad} />
                                                        <Text style={styles.notSuitableTagText} numberOfLines={2}>
                                                            {notSuitableReason}
                                                        </Text>
                                                    </View>
                                                ) : null}

                                                <View style={styles.cardBottom}>
                                                    <View style={styles.dateBadge}>
                                                        <Ionicons name="time-outline" size={13} color={COLORS.muted} />
                                                        <Text style={styles.dateBadgeText}>{dateLabel}</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        );
                                    })}
                                </View>
                            </View>
                        ) : null}

                        {!filteredClients.length ? (
                            <View style={styles.empty}>
                                <Ionicons name="documents-outline" size={24} color={COLORS.muted} />
                                <Text style={styles.emptyTitle}>Sin resultados</Text>
                                <Text style={styles.emptyText}>
                                    No hay clientes para el filtro seleccionado.
                                </Text>
                            </View>
                        ) : null}
                    </ScrollView>
                </View>
            </ImageBackground>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    soft: "#CBD5E1",
    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",
    info: "#60A5FA",
};

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.bg },

    bg: { flex: 1 },

    bgImage: { opacity: 0.55 },

    overlay: {
        flex: 1,
        backgroundColor: "rgba(11,18,32,0.40)",
        paddingHorizontal: 16,
    },

    content: {
        paddingTop: 12,
        gap: 12,
    },

    pressed: {
        transform: [{ scale: 0.99 }],
        opacity: 0.96,
    },

    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
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

    headerPill: {
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: "rgba(96,165,250,0.10)",
        borderWidth: 1,
        borderColor: "rgba(96,165,250,0.24)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },

    headerPillText: {
        color: "#BFDBFE",
        fontSize: 11,
        fontWeight: "900",
    },

    kpiRow: {
        flexDirection: "row",
        gap: 12,
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

    kpiHint: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
    },

    searchWrap: {
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

    filtersRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },

    filterChip: {
        minHeight: 38,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },

    filterChipActive: {
        backgroundColor: "rgba(96,165,250,0.12)",
        borderColor: "rgba(96,165,250,0.28)",
    },

    filterChipText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
    },

    filterChipTextActive: {
        color: COLORS.text,
    },

    filterBadge: {
        minWidth: 24,
        height: 20,
        borderRadius: 999,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.10)",
    },

    filterBadgeActive: {
        backgroundColor: "rgba(255,255,255,0.16)",
    },

    filterBadgeText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "900",
    },

    banner: {
        minHeight: 42,
        borderRadius: 14,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },

    bannerDot: {
        width: 9,
        height: 9,
        borderRadius: 999,
        backgroundColor: COLORS.info,
    },

    bannerText: {
        color: COLORS.soft,
        fontSize: 12,
        fontWeight: "900",
    },

    section: {
        gap: 10,
    },

    sectionHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },

    sectionTitle: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },

    sectionPillOk: {
        minWidth: 34,
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(34,197,94,0.12)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.28)",
    },

    sectionPillBad: {
        minWidth: 34,
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(248,113,113,0.12)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.28)",
    },

    sectionPillText: {
        color: COLORS.text,
        fontSize: 12,
        fontWeight: "900",
    },

    list: {
        gap: 10,
    },

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
        gap: 10,
    },

    titleRow: {
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

    metaRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },

    infoBadge: {
        height: 26,
        paddingHorizontal: 9,
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },

    infoBadgeText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "900",
    },

    infoBadgeOk: {
        backgroundColor: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.24)",
    },

    infoBadgeBad: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderColor: "rgba(248,113,113,0.24)",
    },

    infoBadgeWarn: {
        backgroundColor: "rgba(251,191,36,0.10)",
        borderColor: "rgba(251,191,36,0.24)",
    },

    infoBadgeInfo: {
        backgroundColor: "rgba(96,165,250,0.10)",
        borderColor: "rgba(96,165,250,0.24)",
    },

    infoBadgeNeutral: {
        backgroundColor: "rgba(255,255,255,0.05)",
        borderColor: "rgba(255,255,255,0.10)",
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

    notSuitableTag: {
        alignSelf: "flex-start",
        minHeight: 30,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: "rgba(248,113,113,0.12)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.30)",
    },

    notSuitableTagText: {
        color: "#FCA5A5",
        fontSize: 12,
        fontWeight: "900",
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
        marginTop: 8,
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
});