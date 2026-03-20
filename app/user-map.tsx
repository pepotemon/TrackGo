import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Linking,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    View
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../src/auth/useAuth";
import { subscribeUserClients } from "../src/data/repositories/clientsRepo";
import type { ClientDoc } from "../src/types/models";

type ClientStatus = "pending" | "visited" | "rejected";
type MapFilter = "pending" | "visited" | "rejected" | "all";

type LatLng = {
    latitude: number;
    longitude: number;
};

function normalizeHttpUrl(raw?: string | null) {
    const u = (raw ?? "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) return `https://${u}`;
    return u;
}

function toFiniteNumber(v: any): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

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

function safeStatus(s?: string | null): ClientStatus {
    if (s === "visited") return "visited";
    if (s === "rejected") return "rejected";
    return "pending";
}

function statusLabel(s?: string | null) {
    if (s === "visited") return "Visitado";
    if (s === "rejected") return "Rechazado";
    return "Pendiente";
}

function markerColor(status?: string | null) {
    if (status === "visited") return COLORS.ok;
    if (status === "rejected") return COLORS.bad;
    return COLORS.warn;
}

function buildTitle(c: ClientDoc) {
    const name = ((c as any)?.name ?? "").trim();
    const business = ((c as any)?.business ?? "").trim();
    return name || business || "Cliente";
}

function buildSubtitle(c: ClientDoc) {
    const business = ((c as any)?.business ?? "").trim();
    const address = (c.address ?? "").trim();
    const geo = (
        ((c as any)?.geoAdminDisplayLabel ??
            (c as any)?.geoDisplayLabel ??
            (c as any)?.geoCityLabel ??
            "") as string
    ).trim();

    return business || address || geo || "Sin detalle";
}

function toTitleCaseLoose(raw?: string | null) {
    const text = (raw ?? "").trim();
    if (!text) return "";
    return text
        .split(/\s+/)
        .map((part) => {
            if (!part) return "";
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join(" ");
}

function clientCoords(c: ClientDoc): LatLng | null {
    const lat = toFiniteNumber((c as any)?.lat);
    const lng = toFiniteNumber((c as any)?.lng);

    if (
        lat === null ||
        lng === null ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
    ) {
        return null;
    }

    return {
        latitude: lat,
        longitude: lng,
    };
}

function getCoverageLabel(profile: any) {
    const coverage = Array.isArray(profile?.geoCoverage) ? profile.geoCoverage : [];

    const citiesSet = new Set<string>();
    const statesSet = new Set<string>();

    for (const item of coverage) {
        const city =
            toTitleCaseLoose(item?.cityLabel) ||
            toTitleCaseLoose(item?.cityNormalized) ||
            "";
        const state =
            toTitleCaseLoose(item?.stateLabel) ||
            toTitleCaseLoose(
                typeof item?.stateNormalized === "string"
                    ? String(item.stateNormalized).replace(/_/g, " ")
                    : ""
            ) ||
            "";

        if (city) citiesSet.add(city);
        if (state) statesSet.add(state);
    }

    const cities = Array.from(citiesSet);
    const states = Array.from(statesSet);

    if (cities.length) {
        const cityPart = cities.join(", ");
        const statePart = states.length === 1 ? states[0] : "Cobertura";
        return `${statePart} · ${cityPart}`;
    }

    const primary = (profile?.primaryGeoCoverageLabel ?? "").trim();
    if (primary) return primary;

    return "Zona asignada";
}

function getInitialRegion(points: LatLng[]): Region {
    if (!points.length) {
        return {
            latitude: -1.4558,
            longitude: -48.4902,
            latitudeDelta: 0.35,
            longitudeDelta: 0.35,
        };
    }

    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latitude = (minLat + maxLat) / 2;
    const longitude = (minLng + maxLng) / 2;

    const latSpan = Math.max(0.05, (maxLat - minLat) * 1.6 || 0.1);
    const lngSpan = Math.max(0.05, (maxLng - minLng) * 1.6 || 0.1);

    return {
        latitude,
        longitude,
        latitudeDelta: latSpan,
        longitudeDelta: lngSpan,
    };
}

function FilterChip({
    label,
    icon,
    count,
    active,
    onPress,
    tone,
    compact = false,
}: {
    label?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    count: number;
    active: boolean;
    onPress: () => void;
    tone: "warn" | "ok" | "bad" | "neutral";
    compact?: boolean;
}) {
    const tint =
        tone === "ok"
            ? COLORS.ok
            : tone === "bad"
                ? COLORS.bad
                : tone === "warn"
                    ? COLORS.warn
                    : COLORS.text;

    const borderColor =
        tone === "ok"
            ? "rgba(34,197,94,0.40)"
            : tone === "bad"
                ? "rgba(248,113,113,0.40)"
                : tone === "warn"
                    ? "rgba(251,191,36,0.40)"
                    : "rgba(255,255,255,0.16)";

    const bgColor =
        tone === "ok"
            ? "rgba(34,197,94,0.18)"
            : tone === "bad"
                ? "rgba(248,113,113,0.18)"
                : tone === "warn"
                    ? "rgba(251,191,36,0.20)"
                    : "rgba(15,23,42,0.88)";

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.filterChip,
                compact && styles.filterChipCompact,
                { borderColor, backgroundColor: bgColor },
                active && styles.filterChipActive,
                pressed && styles.pressed,
            ]}
        >
            {icon ? <Ionicons name={icon} size={14} color={active ? COLORS.text : tint} /> : null}
            {label ? (
                <Text style={[styles.filterChipText, { color: active ? COLORS.text : tint }]}>
                    {label}
                </Text>
            ) : null}
            <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
                <Text style={styles.filterBadgeText}>{count}</Text>
            </View>
        </Pressable>
    );
}

export default function UserMapScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { firebaseUser, profile, loading } = useAuth();

    const mapRef = useRef<MapView | null>(null);
    const initialFitDoneRef = useRef(false);

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
    const [locatingMe, setLocatingMe] = useState(false);
    const [filter, setFilter] = useState<MapFilter>("pending");

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
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active, firebaseUser, profile, router]);

    useEffect(() => {
        if (!firebaseUser?.uid) return;

        const unsub = subscribeUserClients(firebaseUser.uid, (list) => {
            setClients(list ?? []);
        });

        return () => unsub();
    }, [firebaseUser?.uid]);

    const coverageLabel = useMemo(() => getCoverageLabel(profile), [profile]);

    const allMapClients = useMemo(() => {
        return clients
            .filter((c) => !!clientCoords(c))
            .slice()
            .sort((a, b) => {
                const aKey = toMs((a as any).createdAt ?? (a as any).assignedAt ?? (a as any).updatedAt);
                const bKey = toMs((b as any).createdAt ?? (b as any).assignedAt ?? (b as any).updatedAt);
                return aKey - bKey;
            });
    }, [clients]);

    const counts = useMemo(() => {
        let pending = 0;
        let visited = 0;
        let rejected = 0;

        for (const c of allMapClients) {
            const s = safeStatus(c.status);
            if (s === "visited") visited += 1;
            else if (s === "rejected") rejected += 1;
            else pending += 1;
        }

        return {
            pending,
            visited,
            rejected,
            total: allMapClients.length,
        };
    }, [allMapClients]);

    const filteredClients = useMemo(() => {
        if (filter === "all") return allMapClients;
        return allMapClients.filter((c) => safeStatus(c.status) === filter);
    }, [allMapClients, filter]);

    const allPoints = useMemo(() => {
        return allMapClients
            .map((c) => clientCoords(c))
            .filter((v): v is LatLng => !!v);
    }, [allMapClients]);

    const filteredPoints = useMemo(() => {
        return filteredClients
            .map((c) => clientCoords(c))
            .filter((v): v is LatLng => !!v);
    }, [filteredClients]);

    const selectedClient = useMemo(() => {
        if (!selectedClientId) return null;
        return filteredClients.find((c) => c.id === selectedClientId) ?? null;
    }, [selectedClientId, filteredClients]);

    useEffect(() => {
        if (selectedClientId && !filteredClients.some((c) => c.id === selectedClientId)) {
            setSelectedClientId(null);
        }
    }, [selectedClientId, filteredClients]);

    const initialRegion = useMemo(() => {
        const pts = filteredPoints.length ? filteredPoints : allPoints;
        return getInitialRegion(pts);
    }, [filteredPoints, allPoints]);

    const fitPoints = (points: LatLng[]) => {
        if (!mapRef.current || !points.length) return;

        try {
            if (points.length === 1) {
                const first = points[0];
                mapRef.current.animateToRegion(
                    {
                        latitude: first.latitude,
                        longitude: first.longitude,
                        latitudeDelta: 0.035,
                        longitudeDelta: 0.035,
                    },
                    280
                );
                return;
            }

            mapRef.current.fitToCoordinates(points, {
                edgePadding: {
                    top: 160,
                    right: 70,
                    bottom: 260,
                    left: 70,
                },
                animated: true,
            });
        } catch { }
    };

    useEffect(() => {
        if (!mapReady) return;
        if (initialFitDoneRef.current) return;

        const pts = filteredPoints.length ? filteredPoints : allPoints;
        if (!pts.length) return;

        const timeout = setTimeout(() => {
            fitPoints(pts);
            initialFitDoneRef.current = true;
        }, 180);

        return () => clearTimeout(timeout);
    }, [mapReady, filteredPoints, allPoints]);

    const goToMyLocation = async () => {
        try {
            setLocatingMe(true);

            const { status } = await Location.requestForegroundPermissionsAsync();

            if (status !== "granted") {
                Alert.alert(
                    "Ubicación",
                    "Debes permitir la ubicación para centrar el mapa en tu posición actual."
                );
                return;
            }

            const pos = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });

            const next = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
            };

            setCurrentLocation(next);

            mapRef.current?.animateToRegion(
                {
                    latitude: next.latitude,
                    longitude: next.longitude,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                },
                420
            );
        } catch {
            Alert.alert("Ubicación", "No se pudo obtener tu ubicación actual.");
        } finally {
            setLocatingMe(false);
        }
    };

    const openMaps = async (client: ClientDoc) => {
        const directMaps = normalizeHttpUrl(client.mapsUrl);
        const coords = clientCoords(client);

        const fallback = coords
            ? `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`
            : "";

        const url = directMaps || fallback;

        if (!url) {
            Alert.alert("Maps", "Este cliente no tiene ubicación disponible.");
            return;
        }

        try {
            await Linking.openURL(url);
        } catch {
            Alert.alert("Maps", "No se pudo abrir Google Maps.");
        }
    };

    return (
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
            <StatusBar barStyle="dark-content" translucent={false} backgroundColor="#FFFFFF" />

            <View style={styles.container}>
                <MapView
                    ref={(ref: MapView | null) => {
                        mapRef.current = ref;
                    }}
                    style={StyleSheet.absoluteFill}
                    initialRegion={initialRegion}
                    onMapReady={() => setMapReady(true)}
                    onPress={() => setSelectedClientId(null)}
                    showsCompass={false}
                    showsBuildings
                    showsTraffic={false}
                    showsIndoors={false}
                    toolbarEnabled={false}
                    loadingEnabled
                    moveOnMarkerPress={false}
                    mapType="standard"
                    liteMode={false}
                >
                    {filteredClients.map((client) => {
                        const coords = clientCoords(client);
                        if (!coords) return null;

                        const active = selectedClientId === client.id;

                        return (
                            <Marker
                                key={`${filter}-${client.id}-${safeStatus(client.status)}`}
                                coordinate={coords}
                                anchor={{ x: 0.5, y: 1 }}
                                pinColor={markerColor(client.status)}
                                onPress={() => setSelectedClientId(client.id)}
                                tracksViewChanges={false}
                                zIndex={active ? 20 : 10}
                            />
                        );
                    })}

                    {currentLocation ? (
                        <Marker
                            coordinate={currentLocation}
                            anchor={{ x: 0.5, y: 0.5 }}
                            tracksViewChanges={false}
                            zIndex={30}
                        >
                            <View style={styles.meOuterDot}>
                                <View style={styles.meInnerDot} />
                            </View>
                        </Marker>
                    ) : null}
                </MapView>

                <View
                    pointerEvents="box-none"
                    style={[styles.topOverlay, { paddingTop: Math.max(10, insets.top + 4) }]}
                >
                    <View style={styles.topBar}>
                        <View style={styles.titleBlock}>
                            <Text style={styles.title}>Mapa de clientes</Text>
                            <Text style={styles.subtitle} numberOfLines={2}>
                                {coverageLabel}
                            </Text>
                        </View>

                        <Pressable
                            onPress={() => fitPoints(filteredPoints.length ? filteredPoints : allPoints)}
                            style={({ pressed }) => [styles.circleBtn, pressed && styles.pressed]}
                            accessibilityLabel="Ver filtro actual"
                            disabled={!(filteredPoints.length || allPoints.length)}
                        >
                            <Ionicons name="scan-outline" size={18} color={COLORS.text} />
                        </Pressable>

                        <Pressable
                            onPress={goToMyLocation}
                            style={({ pressed }) => [
                                styles.circleBtn,
                                locatingMe && styles.circleBtnActive,
                                pressed && styles.pressed,
                            ]}
                            accessibilityLabel="Ir a mi ubicación"
                        >
                            <Ionicons
                                name={locatingMe ? "radio-outline" : "locate-outline"}
                                size={18}
                                color={COLORS.text}
                            />
                        </Pressable>
                    </View>

                    <View style={styles.filtersRow}>
                        <FilterChip
                            label="Pendientes"
                            count={counts.pending}
                            active={filter === "pending"}
                            onPress={() => setFilter("pending")}
                            tone="warn"
                        />

                        <FilterChip
                            icon="checkmark"
                            count={counts.visited}
                            active={filter === "visited"}
                            onPress={() => setFilter("visited")}
                            tone="ok"
                            compact
                        />

                        <FilterChip
                            icon="close"
                            count={counts.rejected}
                            active={filter === "rejected"}
                            onPress={() => setFilter("rejected")}
                            tone="bad"
                            compact
                        />

                        <FilterChip
                            icon="apps-outline"
                            count={counts.total}
                            active={filter === "all"}
                            onPress={() => setFilter("all")}
                            tone="neutral"
                            compact
                        />
                    </View>
                </View>

                {!filteredClients.length ? (
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIconWrap}>
                            <Ionicons name="map-outline" size={24} color={COLORS.muted} />
                        </View>
                        <Text style={styles.emptyTitle}>Sin puntos para este filtro</Text>
                        <Text style={styles.emptyText}>
                            No hay clientes con coordenadas válidas en la categoría seleccionada.
                        </Text>
                    </View>
                ) : null}

                {selectedClient ? (
                    <View
                        style={[
                            styles.bottomCardWrap,
                            { bottom: Math.max(16, insets.bottom + 8) },
                        ]}
                    >
                        <View style={styles.bottomCard}>
                            <View style={styles.bottomCardTop}>
                                <View style={{ flex: 1, gap: 4 }}>
                                    <View style={styles.bottomTitleRow}>
                                        <Text style={styles.bottomTitle} numberOfLines={1}>
                                            {buildTitle(selectedClient)}
                                        </Text>

                                        <View
                                            style={[
                                                styles.statusPill,
                                                {
                                                    backgroundColor:
                                                        safeStatus(selectedClient.status) === "visited"
                                                            ? "rgba(34,197,94,0.18)"
                                                            : safeStatus(selectedClient.status) === "rejected"
                                                                ? "rgba(248,113,113,0.18)"
                                                                : "rgba(251,191,36,0.20)",
                                                    borderColor:
                                                        safeStatus(selectedClient.status) === "visited"
                                                            ? "rgba(34,197,94,0.44)"
                                                            : safeStatus(selectedClient.status) === "rejected"
                                                                ? "rgba(248,113,113,0.44)"
                                                                : "rgba(251,191,36,0.48)",
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.statusPillText,
                                                    {
                                                        color:
                                                            safeStatus(selectedClient.status) === "visited"
                                                                ? "#86EFAC"
                                                                : safeStatus(selectedClient.status) === "rejected"
                                                                    ? "#FCA5A5"
                                                                    : "#FDE68A",
                                                    },
                                                ]}
                                            >
                                                {statusLabel(selectedClient.status)}
                                            </Text>
                                        </View>
                                    </View>

                                    <Text style={styles.bottomSubtitle} numberOfLines={1}>
                                        {buildSubtitle(selectedClient)}
                                    </Text>

                                    {!!(selectedClient.address ?? "").trim() ? (
                                        <View style={styles.bottomInfoRow}>
                                            <Ionicons name="location-outline" size={15} color={COLORS.muted} />
                                            <Text style={styles.bottomInfoText} numberOfLines={2}>
                                                {selectedClient.address}
                                            </Text>
                                        </View>
                                    ) : null}

                                    {!!(selectedClient.phone ?? "").trim() ? (
                                        <View style={styles.bottomInfoRow}>
                                            <Ionicons name="call-outline" size={15} color={COLORS.muted} />
                                            <Text style={styles.bottomInfoText} numberOfLines={1}>
                                                {selectedClient.phone}
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>

                                <Pressable
                                    onPress={() => setSelectedClientId(null)}
                                    style={({ pressed }) => [styles.smallCloseBtn, pressed && styles.pressed]}
                                >
                                    <Ionicons name="close" size={16} color={COLORS.text} />
                                </Pressable>
                            </View>

                            <View style={styles.bottomActions}>
                                <Pressable
                                    onPress={() => openMaps(selectedClient)}
                                    style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                                >
                                    <Ionicons name="map-outline" size={17} color={COLORS.text} />
                                    <Text style={styles.primaryBtnText}>Abrir Maps</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
                ) : null}
            </View>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "rgba(15, 23, 42, 0.98)",
    border: "rgba(255,255,255,0.10)",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    ok: "#22C55E",
    bad: "#F87171",
    warn: "#FBBF24",
    me: "#38BDF8",
};

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },

    container: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },

    pressed: {
        transform: [{ scale: 0.98 }],
        opacity: 0.96,
    },

    topOverlay: {
        position: "absolute",
        top: 0,
        left: 16,
        right: 16,
        zIndex: 20,
        gap: 12,
    },

    topBar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },

    circleBtn: {
        width: 44,
        height: 44,
        borderRadius: 15,
        backgroundColor: "rgba(15, 23, 42, 0.96)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
    },

    circleBtnActive: {
        borderColor: "rgba(56,189,248,0.45)",
        backgroundColor: "rgba(56,189,248,0.16)",
    },

    titleBlock: {
        flex: 1,
        minHeight: 56,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 8,
        justifyContent: "center",
        backgroundColor: "rgba(15, 23, 42, 0.96)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },

    title: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },

    subtitle: {
        color: "#D8E4F2",
        fontSize: 11,
        fontWeight: "700",
        marginTop: 2,
        lineHeight: 15,
    },

    filtersRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
    },

    filterChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 38,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
    },

    filterChipCompact: {
        minWidth: 58,
        justifyContent: "center",
        paddingHorizontal: 10,
    },

    filterChipActive: {
        borderColor: "rgba(255,255,255,0.24)",
        backgroundColor: "rgba(15,23,42,0.96)",
    },

    filterChipText: {
        fontSize: 12,
        fontWeight: "900",
    },

    filterBadge: {
        minWidth: 24,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.12)",
    },

    filterBadgeActive: {
        backgroundColor: "rgba(255,255,255,0.18)",
    },

    filterBadgeText: {
        color: COLORS.text,
        fontSize: 11,
        fontWeight: "900",
    },

    meOuterDot: {
        width: 24,
        height: 24,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(56,189,248,0.18)",
        borderWidth: 1.5,
        borderColor: "rgba(125,211,252,0.55)",
    },

    meInnerDot: {
        width: 11,
        height: 11,
        borderRadius: 999,
        backgroundColor: COLORS.me,
        borderWidth: 1.5,
        borderColor: "#FFFFFF",
    },

    emptyState: {
        position: "absolute",
        left: 24,
        right: 24,
        top: "36%",
        borderRadius: 22,
        padding: 18,
        backgroundColor: "rgba(15, 23, 42, 0.96)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        gap: 10,
    },

    emptyIconWrap: {
        width: 54,
        height: 54,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },

    emptyTitle: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },

    emptyText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "700",
        textAlign: "center",
        lineHeight: 19,
    },

    bottomCardWrap: {
        position: "absolute",
        left: 16,
        right: 16,
        zIndex: 25,
    },

    bottomCard: {
        backgroundColor: "rgba(15, 23, 42, 0.98)",
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 20,
        padding: 14,
        gap: 14,
    },

    bottomCardTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
    },

    bottomTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },

    bottomTitle: {
        flex: 1,
        color: COLORS.text,
        fontSize: 16,
        fontWeight: "900",
    },

    bottomSubtitle: {
        color: "#D1D5DB",
        fontSize: 13,
        fontWeight: "700",
    },

    statusPill: {
        paddingHorizontal: 10,
        height: 28,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },

    statusPillText: {
        fontSize: 12,
        fontWeight: "900",
    },

    bottomInfoRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        marginTop: 2,
    },

    bottomInfoText: {
        flex: 1,
        color: COLORS.text,
        opacity: 0.94,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 18,
    },

    smallCloseBtn: {
        width: 38,
        height: 38,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        borderColor: COLORS.border,
    },

    bottomActions: {
        flexDirection: "row",
        gap: 10,
    },

    primaryBtn: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.10)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.16)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },

    primaryBtnText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },
});