import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../src/auth/useAuth";
import LoginScreen from "../src/screens/auth/LoginScreen";

export default function LoginRoute() {
    const { firebaseUser, profile, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (loading) return;

        // Si ya está logueado y tiene perfil activo, redirigimos bien
        if (firebaseUser && profile?.active) {
            if (profile.role === "admin") {
                router.replace("/admin");
            } else {
                // ✅ antes estaba mandando a /(tabs)
                router.replace("/user");
            }
        }
    }, [loading, firebaseUser?.uid, profile?.role, profile?.active]);

    // Si ya está logueado, mostramos loading mientras redirige
    if (!loading && firebaseUser && profile?.active) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }

    return <LoginScreen />;
}