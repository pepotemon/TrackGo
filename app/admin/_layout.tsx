import { Stack, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../../src/auth/useAuth";

export default function AdminLayout() {
    const { firebaseUser, profile, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (loading) return;

        if (!firebaseUser) {
            router.replace({ pathname: "/login" as any });
            return;
        }

        if (!profile || !profile.active || profile.role !== "admin") {
            router.replace({ pathname: "/no-access" as any });
            return;
        }
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active]);

    if (loading || !firebaseUser || !profile) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <Stack
            screenOptions={{
                headerTitleAlign: "center",
                headerStyle: { backgroundColor: "#0A0F1E" },
                headerTintColor: "#FFFFFF",
                headerTitleStyle: { fontWeight: "800" },
                headerShadowVisible: false,
            }}
        >
            {/* Ajusta estos nombres según tus archivos dentro de /app/admin */}
            <Stack.Screen name="index" options={{ title: "Admin" }} />
            <Stack.Screen name="users" options={{ title: "Usuarios" }} />
            <Stack.Screen name="upload-clients" options={{ title: "Clientes" }} />
            <Stack.Screen name="history-range" options={{ title: "Historial" }} />
            <Stack.Screen name="earnings" options={{ title: "Comisiones" }} />
            {/* Si tienes pantallas tipo modal dentro de admin, aquí puedes configurarlas también */}
            {/* <Stack.Screen name="modal" options={{ presentation: "modal", title: "Detalle" }} /> */}
        </Stack>
    );
}