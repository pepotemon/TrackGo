import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, FlatList, Linking, Text, View } from "react-native";
import { useAuth } from "../../auth/useAuth";
import { subscribeUserClients, updateClientStatus } from "../../data/repositories/clientsRepo";
import type { ClientDoc } from "../../types/models";

function waUrl(phoneDigits: string) {
    // phoneDigits debe venir como "5591...."
    return `https://wa.me/${phoneDigits}`;
}

export default function UserHomeScreen() {
    const { firebaseUser, profile, loading, logout } = useAuth();
    const router = useRouter();

    const [clients, setClients] = useState<ClientDoc[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    // Guard de sesión / rol
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

        if (profile.role === "admin") {
            router.replace({ pathname: "/admin" as any });
            return;
        }
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active]);

    // Subscripción a asignados
    useEffect(() => {
        if (!firebaseUser) return;
        const unsub = subscribeUserClients(firebaseUser.uid, setClients);
        return () => unsub();
    }, [firebaseUser?.uid]);

    const pendingCount = useMemo(
        () => clients.filter((c) => c.status === "pending").length,
        [clients]
    );

    const openWhatsApp = async (phone: string) => {
        const url = waUrl(phone);
        const ok = await Linking.canOpenURL(url);
        if (!ok) {
            Alert.alert("WhatsApp", "No se pudo abrir WhatsApp en este dispositivo.");
            return;
        }
        await Linking.openURL(url);
    };

    const openMaps = async (client: ClientDoc) => {
        const url = client.mapsUrl?.trim() || "";
        if (!url) {
            Alert.alert("Maps", "Este cliente no tiene link de Google Maps.");
            return;
        }
        const ok = await Linking.canOpenURL(url);
        if (!ok) {
            Alert.alert("Maps", "No se pudo abrir el link de Maps.");
            return;
        }
        await Linking.openURL(url);
    };

    const mark = async (client: ClientDoc, status: "visited" | "rejected") => {
        if (!firebaseUser) return;

        setBusyId(client.id);
        try {
            await updateClientStatus(client.id, status, firebaseUser.uid, {
                phone: client.phone,
                address: client.address,
            });
        } catch (e: any) {
            Alert.alert("Error", e?.message ?? "No se pudo actualizar");
        } finally {
            setBusyId(null);
        }
    };

    if (loading || !firebaseUser || !profile) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <Text>Cargando...</Text>
            </View>
        );
    }

    return (
        <View style={{ flex: 1, padding: 16, gap: 10 }}>

            <Text style={{ fontWeight: "800", fontSize: 18 }}>TrackGo</Text>
            <Text style={{ opacity: 0.75 }}>
                Usuario: {profile.name} · Pendientes: {pendingCount} · Total: {clients.length}
            </Text>

            <Button title="Cerrar sesión" onPress={logout} />

            <Text style={{ marginTop: 10, fontWeight: "700" }}>Asignados</Text>

            <FlatList
                data={clients}
                keyExtractor={(c) => c.id}
                contentContainerStyle={{ paddingBottom: 30 }}
                renderItem={({ item }) => {
                    const isBusy = busyId === item.id;

                    return (
                        <View style={{ paddingVertical: 12, borderBottomWidth: 1, gap: 6 }}>
                            <Text style={{ fontWeight: "700" }}>
                                {item.phone} — {item.status}
                            </Text>

                            {item.address ? <Text>{item.address}</Text> : null}
                            {item.mapsUrl ? <Text numberOfLines={1}>{item.mapsUrl}</Text> : null}

                            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                                <Button title="WhatsApp" onPress={() => openWhatsApp(item.phone)} />
                                <Button title="Maps" onPress={() => openMaps(item)} />

                                <Button
                                    title={isBusy ? "..." : "Visitado"}
                                    onPress={() => mark(item, "visited")}
                                    disabled={isBusy}
                                />
                                <Button
                                    title={isBusy ? "..." : "Rechazado"}
                                    onPress={() => mark(item, "rejected")}
                                    disabled={isBusy}
                                />
                            </View>
                        </View>
                    );
                }}
                ListEmptyComponent={
                    <Text style={{ opacity: 0.7, paddingVertical: 20 }}>
                        No tienes clientes asignados aún.
                    </Text>
                }
            />
        </View>
    );
}