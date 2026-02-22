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
                // ✅ siempre TrackGo
                headerTitle: "TrackGo",
                headerTitleAlign: "center",
                headerStyle: { backgroundColor: "#0A0F1E" },
                headerTintColor: "#FFFFFF",
                headerTitleStyle: { fontWeight: "900" },
                headerShadowVisible: false,

                // ✅ evita “large title” en iOS (si está soportado en tu versión, ok)
                headerLargeTitle: false,
            }}
        >
            {/* ✅ no pongas title por pantalla si quieres TrackGo fijo */}
            <Stack.Screen name="index" options={{ headerShown: true }} />
            <Stack.Screen name="users" options={{ headerShown: true }} />
            <Stack.Screen name="upload-clients" options={{ headerShown: true }} />
            <Stack.Screen name="history-range" options={{ headerShown: true }} />
            <Stack.Screen name="earnings" options={{ headerShown: true }} />
        </Stack>
    );
}