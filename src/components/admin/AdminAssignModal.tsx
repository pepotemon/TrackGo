import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { UserDoc } from "../../types/models";

type AssignEntityType = "cliente" | "lead" | "registro";

type AdminAssignModalProps = {
    visible: boolean;
    onClose: () => void;

    entityId: string | null;
    entityType?: AssignEntityType;

    entityTitle?: string;
    entitySubtitle?: string;

    users: UserDoc[];
    currentAssignedUserId?: string | null;
    loadingUsers?: boolean;
    busy?: boolean;

    onAssign: (entityId: string, userId: string) => Promise<void>;

    title?: string;
    subtitle?: string;
    confirmTitle?: string;
};

const COLORS = {
    card: "#0F172A",
    border: "rgba(255,255,255,0.08)",
    text: "#F8FAFC",
    muted: "#94A3B8",

    primary: "#7C3AED",
    primarySoft: "#C4B5FD",

    ok: "#22C55E",
    okSoft: "#86EFAC",

    overlay: "rgba(0,0,0,0.58)",
    row: "rgba(255,255,255,0.03)",
    rowPressed: "rgba(255,255,255,0.06)",
    inputBg: "rgba(255,255,255,0.035)",
};

function safeText(x?: string | null) {
    return String(x ?? "").trim().toLowerCase();
}

function entityWord(type?: AssignEntityType) {
    if (type === "lead") return "lead";
    if (type === "registro") return "registro";
    return "cliente";
}

export default function AdminAssignModal({
    visible,
    onClose,
    entityId,
    entityType = "cliente",
    entityTitle,
    entitySubtitle,
    users,
    currentAssignedUserId,
    loadingUsers = false,
    busy = false,
    onAssign,
    title,
    subtitle,
    confirmTitle,
}: AdminAssignModalProps) {
    const insets = useSafeAreaInsets();

    const [q, setQ] = useState("");
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserDoc | null>(null);
    const [localBusy, setLocalBusy] = useState(false);
    const [successText, setSuccessText] = useState("");

    const isBusy = busy || localBusy;
    const word = entityWord(entityType);

    useEffect(() => {
        if (!visible) {
            setQ("");
            setConfirmOpen(false);
            setSelectedUser(null);
            setSuccessText("");
        }
    }, [visible]);

    const filteredUsers = useMemo(() => {
        const qt = q.trim().toLowerCase();

        const base = users
            .slice()
            .filter((u) => u.id !== currentAssignedUserId)
            .sort((a, b) => safeText(a.name).localeCompare(safeText(b.name)));

        if (!qt) return base;

        return base.filter((u) => {
            const hay = `${safeText(u.name)} ${safeText(u.email)}`;
            return hay.includes(qt);
        });
    }, [users, q, currentAssignedUserId]);

    const openConfirm = (user: UserDoc) => {
        if (isBusy) return;
        setSelectedUser(user);
        setConfirmOpen(true);
    };

    const closeConfirm = () => {
        if (isBusy) return;
        setConfirmOpen(false);
        setSelectedUser(null);
    };

    const closeAll = () => {
        if (isBusy) return;
        onClose();
    };

    const submitAssign = async () => {
        if (!entityId || !selectedUser) return;

        try {
            setLocalBusy(true);
            await onAssign(entityId, selectedUser.id);

            const name =
                String(selectedUser.name ?? "").trim() ||
                String(selectedUser.email ?? "").trim() ||
                "usuario";

            setSuccessText(`${word.charAt(0).toUpperCase() + word.slice(1)} asignado a ${name}`);
            setConfirmOpen(false);

            setTimeout(() => {
                setLocalBusy(false);
                onClose();
            }, 900);
        } catch (e) {
            setLocalBusy(false);
        }
    };

    const modalTitle = title ?? `Asignar ${word}`;
    const modalSubtitle =
        subtitle ??
        `Selecciona el usuario al que quieres asignar este ${word}.`;

    return (
        <>
            <Modal visible={visible} transparent animationType="fade" onRequestClose={closeAll}>
                <Pressable style={styles.backdrop} onPress={closeAll} />

                <View
                    style={[
                        styles.card,
                        { paddingBottom: Math.max(12, insets.bottom + 10) },
                    ]}
                >
                    {!!successText ? (
                        <View style={styles.successBanner}>
                            <Ionicons
                                name="checkmark-circle-outline"
                                size={14}
                                color={COLORS.okSoft}
                            />
                            <Text style={styles.successBannerText} numberOfLines={2}>
                                {successText}
                            </Text>
                        </View>
                    ) : null}

                    <View style={styles.header}>
                        <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.title}>{modalTitle}</Text>
                            <Text style={styles.subtitle}>{modalSubtitle}</Text>
                        </View>

                        <Pressable
                            onPress={closeAll}
                            disabled={isBusy}
                            style={({ pressed }) => [
                                styles.closeBtn,
                                pressed && !isBusy ? styles.pressed : null,
                                isBusy ? { opacity: 0.5 } : null,
                            ]}
                        >
                            <Ionicons name="close" size={16} color={COLORS.text} />
                        </Pressable>
                    </View>

                    {(entityTitle || entitySubtitle) ? (
                        <View style={styles.entityCard}>
                            {!!entityTitle ? (
                                <Text style={styles.entityTitle} numberOfLines={1}>
                                    {entityTitle}
                                </Text>
                            ) : null}
                            {!!entitySubtitle ? (
                                <Text style={styles.entitySubtitle} numberOfLines={2}>
                                    {entitySubtitle}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}

                    <View style={styles.searchWrap}>
                        <Ionicons name="search-outline" size={16} color={COLORS.muted} />
                        <TextInput
                            value={q}
                            onChangeText={setQ}
                            placeholder="Buscar usuario por nombre o email…"
                            placeholderTextColor={COLORS.muted}
                            style={styles.searchInput}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        {!!q ? (
                            <Pressable onPress={() => setQ("")} style={styles.clearBtn}>
                                <Ionicons name="close" size={16} color={COLORS.text} />
                            </Pressable>
                        ) : null}
                    </View>

                    <FlatList
                        data={filteredUsers}
                        keyExtractor={(u) => u.id}
                        contentContainerStyle={{ paddingTop: 4, paddingBottom: 8, gap: 8 }}
                        showsVerticalScrollIndicator={false}
                        renderItem={({ item }) => {
                            const isCurrent = item.id === currentAssignedUserId;

                            return (
                                <Pressable
                                    onPress={() => openConfirm(item)}
                                    disabled={isBusy || isCurrent}
                                    style={({ pressed }) => [
                                        styles.userRow,
                                        pressed && !isBusy && !isCurrent ? styles.userRowPressed : null,
                                        (isBusy || isCurrent) ? { opacity: 0.6 } : null,
                                    ]}
                                >
                                    <View style={styles.userAvatar}>
                                        <Ionicons name="person-outline" size={14} color={COLORS.text} />
                                    </View>

                                    <View style={{ flex: 1, gap: 1 }}>
                                        <Text style={styles.userName} numberOfLines={1}>
                                            {item.name || "Sin nombre"}
                                        </Text>
                                        <Text style={styles.userEmail} numberOfLines={1}>
                                            {item.email || "—"}
                                        </Text>
                                    </View>

                                    <Ionicons
                                        name="chevron-forward"
                                        size={14}
                                        color={COLORS.muted}
                                    />
                                </Pressable>
                            );
                        }}
                        ListEmptyComponent={
                            <View style={styles.empty}>
                                <Ionicons name="person-outline" size={20} color={COLORS.muted} />
                                <Text style={styles.emptyText}>
                                    {loadingUsers ? "Cargando usuarios…" : "No hay usuarios disponibles."}
                                </Text>
                            </View>
                        }
                    />
                </View>
            </Modal>

            <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={closeConfirm}>
                <Pressable style={styles.backdrop} onPress={closeConfirm} />

                <View style={styles.confirmCard}>
                    <View style={styles.confirmIcon}>
                        <Ionicons name="swap-horizontal-outline" size={20} color={COLORS.primarySoft} />
                    </View>

                    <Text style={styles.confirmTitle}>
                        {confirmTitle ?? `Confirmar asignación`}
                    </Text>

                    <Text style={styles.confirmText}>
                        ¿Seguro que quieres asignar este {word} a{" "}
                        <Text style={styles.confirmStrong}>
                            {selectedUser?.name || selectedUser?.email || "este usuario"}
                        </Text>
                        ?
                    </Text>

                    <View style={styles.confirmActions}>
                        <Pressable
                            onPress={closeConfirm}
                            disabled={isBusy}
                            style={({ pressed }) => [
                                styles.confirmBtn,
                                styles.confirmBtnGhost,
                                pressed && !isBusy ? styles.pressed : null,
                            ]}
                        >
                            <Text style={styles.confirmBtnGhostText}>Cancelar</Text>
                        </Pressable>

                        <Pressable
                            onPress={submitAssign}
                            disabled={isBusy}
                            style={({ pressed }) => [
                                styles.confirmBtn,
                                styles.confirmBtnPrimary,
                                pressed && !isBusy ? styles.pressed : null,
                                isBusy ? { opacity: 0.7 } : null,
                            ]}
                        >
                            <Text style={styles.confirmBtnPrimaryText}>
                                {isBusy ? "Asignando…" : "Confirmar"}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: COLORS.overlay,
    },

    pressed: {
        transform: [{ scale: 0.985 }],
        opacity: 0.96,
    },

    card: {
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 14,
        maxHeight: "82%",
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
        gap: 10,
    },

    successBanner: {
        minHeight: 36,
        borderRadius: 12,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: "rgba(34,197,94,0.10)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.20)",
    },

    successBannerText: {
        flex: 1,
        color: COLORS.okSoft,
        fontSize: 12,
        fontWeight: "900",
    },

    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },

    title: {
        color: COLORS.text,
        fontSize: 15,
        fontWeight: "900",
    },

    subtitle: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
    },

    closeBtn: {
        width: 36,
        height: 36,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },

    entityCard: {
        borderRadius: 14,
        padding: 10,
        backgroundColor: "rgba(255,255,255,0.025)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        gap: 2,
    },

    entityTitle: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },

    entitySubtitle: {
        color: COLORS.muted,
        fontSize: 11,
        fontWeight: "700",
    },

    searchWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: COLORS.inputBg,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        paddingHorizontal: 11,
        height: 42,
    },

    searchInput: {
        flex: 1,
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "700",
        paddingVertical: 0,
    },

    clearBtn: {
        width: 28,
        height: 28,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
    },

    userRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)",
        backgroundColor: COLORS.row,
    },

    userRowPressed: {
        backgroundColor: COLORS.rowPressed,
    },

    userAvatar: {
        width: 32,
        height: 32,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.09)",
    },

    userName: {
        color: COLORS.text,
        fontWeight: "900",
        fontSize: 13,
    },

    userEmail: {
        color: COLORS.muted,
        fontWeight: "700",
        fontSize: 11,
    },

    empty: {
        marginTop: 14,
        alignItems: "center",
        gap: 8,
        paddingVertical: 8,
    },

    emptyText: {
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "800",
    },

    confirmCard: {
        position: "absolute",
        left: 24,
        right: 24,
        top: "33%",
        backgroundColor: COLORS.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 18,
        gap: 14,
        alignItems: "center",
    },

    confirmIcon: {
        width: 50,
        height: 50,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(124,58,237,0.12)",
        borderWidth: 1,
        borderColor: "rgba(124,58,237,0.22)",
    },

    confirmTitle: {
        color: COLORS.text,
        fontSize: 16,
        fontWeight: "900",
    },

    confirmText: {
        color: COLORS.muted,
        fontSize: 13,
        fontWeight: "700",
        textAlign: "center",
        lineHeight: 20,
    },

    confirmStrong: {
        color: COLORS.text,
        fontWeight: "900",
    },

    confirmActions: {
        flexDirection: "row",
        gap: 10,
        width: "100%",
        marginTop: 2,
    },

    confirmBtn: {
        flex: 1,
        height: 46,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
    },

    confirmBtnGhost: {
        backgroundColor: "#0F172A",
        borderColor: "rgba(255,255,255,0.12)",
    },

    confirmBtnPrimary: {
        backgroundColor: "rgba(124,58,237,0.14)",
        borderColor: "rgba(124,58,237,0.28)",
    },

    confirmBtnGhostText: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: "900",
    },

    confirmBtnPrimaryText: {
        color: COLORS.primarySoft,
        fontSize: 13,
        fontWeight: "900",
    },
});