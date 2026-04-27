import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
    Alert,
    Linking,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import type { ClientDoc, UserDoc } from "../../types/models";

type AssignCoverageModalProps = {
    open: boolean;
    onClose: () => void;
    leads: ClientDoc[];
    users: UserDoc[];
    onAssign: (leadId: string, userId: string) => Promise<void>;
};

type CoverageItem = {
    id: string;
    type: "city" | "state" | "country";
    cityLabel?: string | null;
    cityNormalized?: string | null;
    stateLabel?: string | null;
    stateNormalized?: string | null;
    countryLabel?: string | null;
    countryNormalized?: string | null;
    displayLabel?: string | null;
    active?: boolean;
};

type UserLeadMatch = {
    user: UserDoc;
    leads: ClientDoc[];
};

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    cardAlt: "#0F172A",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    soft: "#CBD5E1",
    primary: "#2563EB",
    primarySoft: "#93C5FD",
    green: "#86EFAC",
    yellow: "#FDE68A",
    red: "#FCA5A5",
};

function s(v: any) {
    return String(v ?? "").trim();
}

function sn(v: any) {
    return String(v ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[\s\-\/]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function normalizePhone(raw?: string | null) {
    return String(raw ?? "").replace(/\D+/g, "");
}

function getLeadPhone(lead: ClientDoc) {
    return s(lead.phone);
}

function getLeadName(lead: ClientDoc) {
    return (
        s((lead as any)?.name) ||
        s((lead as any)?.profileName) ||
        s((lead as any)?.parsedName) ||
        s((lead as any)?.phone) ||
        "Lead"
    );
}

function getLeadDisplayTitle(lead: ClientDoc) {
    const name =
        s((lead as any)?.name) ||
        s((lead as any)?.profileName) ||
        s((lead as any)?.parsedName);
    const phone = getLeadPhone(lead);

    return name || phone || "Lead";
}

function getLeadBusiness(lead: ClientDoc) {
    return (
        s((lead as any)?.business) ||
        s((lead as any)?.businessRaw) ||
        s((lead as any)?.parsedBusiness)
    );
}

function getLeadGeoAdminCityNormalized(lead: ClientDoc) {
    return sn((lead as any)?.geoAdminCityNormalized);
}

function getLeadGeoAdminStateNormalized(lead: ClientDoc) {
    return sn((lead as any)?.geoAdminStateNormalized);
}

function getLeadGeoAdminCountryNormalized(lead: ClientDoc) {
    const marketCountry = s((lead as any)?.marketCountry);
    const fallbackCountry = marketCountry === "PA" ? "panama" : "brasil";
    return sn((lead as any)?.geoAdminCountryNormalized || (lead as any)?.marketCountryNormalized || fallbackCountry);
}

function getLeadGeoHubCityNormalized(lead: ClientDoc) {
    return sn((lead as any)?.geoCityNormalized);
}

function getLeadGeoDisplayLabel(lead: ClientDoc) {
    return (
        s((lead as any)?.geoAdminDisplayLabel) ||
        (s((lead as any)?.geoAdminCityLabel) && s((lead as any)?.geoAdminStateLabel)
            ? `${s((lead as any)?.geoAdminCityLabel)} · ${s((lead as any)?.geoAdminStateLabel)}`
            : "") ||
        s((lead as any)?.geoAdminCityLabel) ||
        s((lead as any)?.geoCityLabel) ||
        s((lead as any)?.geoNearestHubLabel) ||
        s((lead as any)?.geoAdminStateLabel) ||
        "Sin cobertura detectada"
    );
}

function getLeadUniqueKey(lead: ClientDoc) {
    return s(lead.id);
}

function getLeadMapsUrl(lead: ClientDoc) {
    return s((lead as any)?.mapsUrl);
}

function getUserCoverage(user: UserDoc): CoverageItem[] {
    const raw = (user as any)?.geoCoverage;
    if (!Array.isArray(raw)) return [];

    return raw
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
            id: s(x.id),
            type: sn(x.type) as "city" | "state" | "country",
            cityLabel: s(x.cityLabel) || null,
            cityNormalized: sn(x.cityNormalized) || null,
            stateLabel: s(x.stateLabel) || null,
            stateNormalized: sn(x.stateNormalized) || null,
            countryLabel: s(x.countryLabel) || null,
            countryNormalized: sn(x.countryNormalized) || null,
            displayLabel: s(x.displayLabel) || null,
            active: x.active !== false,
        }))
        .filter((x) => x.active !== false);
}

function getUserCoverageLabel(user: UserDoc) {
    const primary = s((user as any)?.primaryGeoCoverageLabel);
    if (primary) return primary;

    const items = getUserCoverage(user);
    if (!items.length) return "Sin cobertura";

    return items
        .slice(0, 2)
        .map((x) => x.displayLabel || x.cityLabel || x.stateLabel || x.countryLabel || x.type)
        .filter(Boolean)
        .join(" · ");
}

function userMatchesLead(user: UserDoc, lead: ClientDoc) {
    const coverage = getUserCoverage(user);
    if (!coverage.length) return false;
    if (!user.active) return false;
    if (user.role !== "user") return false;

    const leadAdminCity = getLeadGeoAdminCityNormalized(lead);
    const leadAdminState = getLeadGeoAdminStateNormalized(lead);
    const leadAdminCountry = getLeadGeoAdminCountryNormalized(lead);
    const leadHubCity = getLeadGeoHubCityNormalized(lead);

    return coverage.some((item) => {
        const type = sn(item.type);
        const city = sn(item.cityNormalized);
        const state = sn(item.stateNormalized);
        const country = sn(item.countryNormalized || "brasil");

        if (type === "city") {
            const cityMatch =
                (!!leadAdminCity && city === leadAdminCity) ||
                (!!leadHubCity && city === leadHubCity);

            if (!cityMatch) return false;

            if (country && leadAdminCountry && country !== leadAdminCountry) {
                return false;
            }

            if (state && leadAdminState) {
                return state === leadAdminState;
            }

            return true;
        }

        if (type === "state") {
            if (!state || !leadAdminState) return false;
            if (country && leadAdminCountry && country !== leadAdminCountry) return false;
            return state === leadAdminState;
        }

        if (type === "country") {
            if (!country || !leadAdminCountry) return false;
            return country === leadAdminCountry;
        }

        return false;
    });
}

function buildUserLeadMatches(leads: ClientDoc[], users: UserDoc[]): UserLeadMatch[] {
    const activeUsers = users.filter((u) => u.role === "user" && !!u.active);

    return activeUsers
        .map((user) => {
            const matchedLeads = leads.filter((lead) => userMatchesLead(user, lead));
            return {
                user,
                leads: matchedLeads,
            };
        })
        .filter((item) => item.leads.length > 0)
        .sort((a, b) => {
            const aName = s(a.user.name) || s(a.user.email);
            const bName = s(b.user.name) || s(b.user.email);
            return aName.localeCompare(bName, "es", { sensitivity: "base" });
        });
}

export default function AssignCoverageModal({
    open,
    onClose,
    leads,
    users,
    onAssign,
}: AssignCoverageModalProps) {
    const [q, setQ] = useState("");
    const [running, setRunning] = useState(false);
    const [assignedCount, setAssignedCount] = useState(0);
    const [lastResultText, setLastResultText] = useState("");
    const [assigningKey, setAssigningKey] = useState<string | null>(null);

    const groupedMatches = useMemo(() => {
        const base = buildUserLeadMatches(leads, users);
        const qt = sn(q);

        if (!qt) return base;

        return base
            .map((group) => {
                const userBlob = sn(`
                    ${s(group.user.name)}
                    ${s(group.user.email)}
                    ${getUserCoverageLabel(group.user)}
                `);

                const filteredLeads = group.leads.filter((lead) => {
                    const blob = sn(`
                        ${getLeadDisplayTitle(lead)}
                        ${getLeadPhone(lead)}
                        ${getLeadBusiness(lead)}
                        ${getLeadGeoDisplayLabel(lead)}
                        ${userBlob}
                    `);

                    return blob.includes(qt);
                });

                if (filteredLeads.length > 0 || userBlob.includes(qt)) {
                    return {
                        ...group,
                        leads: filteredLeads.length > 0 ? filteredLeads : group.leads,
                    };
                }

                return null;
            })
            .filter((x): x is UserLeadMatch => !!x);
    }, [leads, users, q]);

    const compatibleLeadsCount = useMemo(() => {
        const ids = new Set<string>();
        for (const group of groupedMatches) {
            for (const lead of group.leads) {
                ids.add(getLeadUniqueKey(lead));
            }
        }
        return ids.size;
    }, [groupedMatches]);

    const autoPlan = useMemo(() => {
        const taken = new Set<string>();
        const plan: Array<{ leadId: string; userId: string }> = [];

        for (const group of groupedMatches) {
            for (const lead of group.leads) {
                const leadId = getLeadUniqueKey(lead);
                if (!leadId || taken.has(leadId)) continue;

                if (group.user?.id) {
                    taken.add(leadId);
                    plan.push({
                        leadId,
                        userId: group.user.id,
                    });
                }
            }
        }

        return plan;
    }, [groupedMatches]);

    const openMaps = async (lead: ClientDoc) => {
        const url = getLeadMapsUrl(lead);

        if (!url) {
            Alert.alert("Sin Maps", "Este lead no tiene ubicación guardada.");
            return;
        }

        try {
            const ok = await Linking.canOpenURL(url);
            if (!ok) {
                Alert.alert("Error", "No se pudo abrir Google Maps.");
                return;
            }
            await Linking.openURL(url);
        } catch {
            Alert.alert("Error", "No se pudo abrir Google Maps.");
        }
    };

    const assignSingleLead = async (leadId: string, userId: string) => {
        if (!leadId || !userId) return;

        const key = `${leadId}__${userId}`;
        setAssigningKey(key);

        try {
            await onAssign(leadId, userId);
            setLastResultText("Lead asignado correctamente.");
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo asignar el lead.");
        } finally {
            setAssigningKey(null);
        }
    };

    const executeAssign = async () => {
        if (running || !autoPlan.length) return;

        setRunning(true);
        setAssignedCount(0);
        setLastResultText("");

        let ok = 0;
        let fail = 0;

        try {
            for (const item of autoPlan) {
                try {
                    await onAssign(item.leadId, item.userId);
                    ok += 1;
                    setAssignedCount(ok);
                } catch {
                    fail += 1;
                }
            }

            setLastResultText(
                fail > 0
                    ? `Asignados ${ok} lead(s) · fallaron ${fail}.`
                    : `Asignados ${ok} lead(s).`
            );
        } finally {
            setRunning(false);
        }
    };

    return (
        <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
                <View style={styles.wrap}>
                    <View style={styles.card}>
                        <View style={styles.header}>
                            <View style={{ flex: 1, gap: 3 }}>
                                <Text style={styles.title}>Asignación por cobertura</Text>
                                <Text style={styles.sub}>
                                    Leads detectados:{" "}
                                    <Text style={styles.subStrong}>{compatibleLeadsCount}</Text>
                                </Text>
                            </View>

                            <Pressable onPress={onClose} style={styles.closeBtn}>
                                <Ionicons name="close" size={18} color={COLORS.text} />
                            </Pressable>
                        </View>

                        <View style={styles.searchWrap}>
                            <Ionicons name="search-outline" size={16} color={COLORS.muted} />
                            <TextInput
                                value={q}
                                onChangeText={setQ}
                                placeholder="Buscar por usuario, ciudad, estado o lead..."
                                placeholderTextColor={COLORS.muted}
                                style={styles.searchInput}
                            />
                            {!!q ? (
                                <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                                    <Ionicons name="close" size={16} color={COLORS.text} />
                                </Pressable>
                            ) : null}
                        </View>

                        <ScrollView
                            style={{ maxHeight: 440 }}
                            contentContainerStyle={styles.listContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {!groupedMatches.length ? (
                                <View style={styles.empty}>
                                    <Ionicons
                                        name="trail-sign-outline"
                                        size={22}
                                        color={COLORS.muted}
                                    />
                                    <Text style={styles.emptyText}>
                                        No hay coincidencias entre leads y coberturas de usuarios.
                                    </Text>
                                </View>
                            ) : (
                                groupedMatches.map((group) => (
                                    <View key={group.user.id} style={styles.userBlock}>
                                        <View style={styles.userHeader}>
                                            <View style={styles.userAvatar}>
                                                <Ionicons
                                                    name="person-outline"
                                                    size={18}
                                                    color={COLORS.text}
                                                />
                                            </View>

                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.userTitle} numberOfLines={1}>
                                                    {s(group.user.name) ||
                                                        s(group.user.email) ||
                                                        "Usuario"}
                                                </Text>
                                                <Text style={styles.userCoverage} numberOfLines={1}>
                                                    {getUserCoverageLabel(group.user)}
                                                </Text>
                                            </View>

                                            <View style={styles.userCountPill}>
                                                <Text style={styles.userCountText}>
                                                    {group.leads.length}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.leadsList}>
                                            {group.leads.map((lead) => {
                                                const leadTitle = getLeadDisplayTitle(lead);
                                                const leadPhone = getLeadPhone(lead);
                                                const leadBusiness = getLeadBusiness(lead);
                                                const leadGeo = getLeadGeoDisplayLabel(lead);
                                                const assignKey = `${lead.id}__${group.user.id}`;
                                                const isAssigning = assigningKey === assignKey;

                                                return (
                                                    <View
                                                        key={`${group.user.id}__${lead.id}`}
                                                        style={styles.leadRow}
                                                    >
                                                        <View style={{ flex: 1, gap: 3 }}>
                                                            <Text style={styles.leadTitle} numberOfLines={1}>
                                                                {leadTitle}
                                                            </Text>

                                                            {!!leadPhone && leadTitle !== leadPhone ? (
                                                                <Text
                                                                    style={styles.leadPhone}
                                                                    numberOfLines={1}
                                                                >
                                                                    {leadPhone}
                                                                </Text>
                                                            ) : null}

                                                            {!!leadBusiness ? (
                                                                <Text
                                                                    style={styles.leadBusiness}
                                                                    numberOfLines={1}
                                                                >
                                                                    {leadBusiness}
                                                                </Text>
                                                            ) : null}

                                                            <View style={styles.geoPill}>
                                                                <Ionicons
                                                                    name="location-outline"
                                                                    size={12}
                                                                    color={COLORS.primarySoft}
                                                                />
                                                                <Text
                                                                    style={styles.geoPillText}
                                                                    numberOfLines={1}
                                                                >
                                                                    {leadGeo}
                                                                </Text>
                                                            </View>
                                                        </View>

                                                        <View style={styles.leadActions}>
                                                            <Pressable
                                                                onPress={() => void openMaps(lead)}
                                                                style={({ pressed }) => [
                                                                    styles.miniActionBtn,
                                                                    pressed && styles.btnPressed,
                                                                ]}
                                                            >
                                                                <Ionicons
                                                                    name="map-outline"
                                                                    size={17}
                                                                    color={COLORS.soft}
                                                                />
                                                            </Pressable>

                                                            <Pressable
                                                                onPress={() =>
                                                                    void assignSingleLead(
                                                                        lead.id,
                                                                        group.user.id
                                                                    )
                                                                }
                                                                style={({ pressed }) => [
                                                                    styles.miniActionBtn,
                                                                    styles.assignIconBtn,
                                                                    pressed && styles.btnPressed,
                                                                    isAssigning && styles.btnDisabled,
                                                                ]}
                                                                disabled={isAssigning}
                                                            >
                                                                <Ionicons
                                                                    name={
                                                                        isAssigning
                                                                            ? "time-outline"
                                                                            : "git-compare-outline"
                                                                    }
                                                                    size={17}
                                                                    color={
                                                                        isAssigning
                                                                            ? COLORS.muted
                                                                            : COLORS.text
                                                                    }
                                                                />
                                                            </Pressable>
                                                        </View>
                                                    </View>
                                                );
                                            })}
                                        </View>
                                    </View>
                                ))
                            )}
                        </ScrollView>

                        {!!lastResultText ? (
                            <View style={styles.resultBox}>
                                <Ionicons
                                    name="checkmark-circle-outline"
                                    size={16}
                                    color={COLORS.green}
                                />
                                <Text style={styles.resultText}>{lastResultText}</Text>
                            </View>
                        ) : null}

                        {running ? (
                            <Text style={styles.progressText}>
                                Asignando... {assignedCount}/{autoPlan.length}
                            </Text>
                        ) : null}

                        <View style={styles.footer}>
                            <Pressable
                                onPress={onClose}
                                style={({ pressed }) => [
                                    styles.ghostBtn,
                                    pressed && styles.btnPressed,
                                ]}
                                disabled={running}
                            >
                                <Text style={styles.ghostBtnText}>Cerrar</Text>
                            </Pressable>

                            <Pressable
                                onPress={executeAssign}
                                style={({ pressed }) => [
                                    styles.primaryBtn,
                                    pressed && styles.btnPressed,
                                    (running || !autoPlan.length) && styles.btnDisabled,
                                ]}
                                disabled={running || !autoPlan.length}
                            >
                                <Ionicons name="git-compare-outline" size={16} color="#fff" />
                                <Text style={styles.primaryBtnText}>
                                    {running ? "Asignando..." : "Ejecutar asignación"}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.55)",
        justifyContent: "center",
        padding: 14,
    },
    wrap: {
        width: "100%",
    },
    card: {
        backgroundColor: COLORS.card,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        maxHeight: "88%",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 10,
    },
    title: {
        color: COLORS.text,
        fontSize: 17,
        fontWeight: "900",
    },
    sub: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },
    subStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },
    closeBtn: {
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: COLORS.cardAlt,
        borderWidth: 1,
        borderColor: COLORS.border,
    },

    searchWrap: {
        marginBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: COLORS.cardAlt,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        paddingHorizontal: 12,
        height: 46,
    },
    searchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "700",
    },
    clearBtn: {
        width: 30,
        height: 30,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
    },

    listContent: {
        gap: 12,
        paddingBottom: 4,
    },

    userBlock: {
        backgroundColor: COLORS.cardAlt,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 16,
        padding: 12,
        gap: 10,
    },
    userHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    userAvatar: {
        width: 38,
        height: 38,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    userTitle: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },
    userCoverage: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
        marginTop: 2,
    },
    userCountPill: {
        minWidth: 28,
        height: 28,
        borderRadius: 999,
        paddingHorizontal: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    userCountText: {
        color: COLORS.soft,
        fontSize: 11,
        fontWeight: "900",
    },

    leadsList: {
        gap: 8,
    },
    leadRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.03)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
    },
    leadTitle: {
        color: COLORS.text,
        fontSize: 12,
        fontWeight: "900",
    },
    leadPhone: {
        color: COLORS.soft,
        fontSize: 11,
        fontWeight: "800",
    },
    leadBusiness: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "800",
    },

    geoPill: {
        alignSelf: "flex-start",
        minHeight: 24,
        maxWidth: "100%",
        paddingHorizontal: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: "rgba(37,99,235,0.25)",
        backgroundColor: "rgba(37,99,235,0.12)",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    geoPillText: {
        color: COLORS.primarySoft,
        fontSize: 11,
        fontWeight: "900",
        flexShrink: 1,
    },

    leadActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginLeft: 4,
    },
    miniActionBtn: {
        width: 34,
        height: 34,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },
    assignIconBtn: {
        backgroundColor: "rgba(255,255,255,0.02)",
        borderColor: "rgba(255,255,255,0.10)",
    },

    resultBox: {
        marginTop: 12,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.20)",
        backgroundColor: "rgba(34,197,94,0.08)",
    },
    resultText: {
        color: COLORS.soft,
        fontSize: 12,
        fontWeight: "800",
        flex: 1,
    },
    progressText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "900",
        marginBottom: 10,
    },

    footer: {
        flexDirection: "row",
        gap: 10,
        marginTop: 4,
    },
    ghostBtn: {
        flex: 1,
        height: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: COLORS.cardAlt,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    ghostBtnText: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "900",
    },
    primaryBtn: {
        flex: 1.4,
        height: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: COLORS.primary,
        flexDirection: "row",
        gap: 8,
    },
    primaryBtnText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "900",
    },
    btnPressed: {
        transform: [{ scale: 0.99 }],
        opacity: 0.96,
    },
    btnDisabled: {
        opacity: 0.55,
    },

    empty: {
        paddingVertical: 28,
        paddingHorizontal: 16,
        alignItems: "center",
        gap: 10,
    },
    emptyText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "900",
        textAlign: "center",
    },
});
