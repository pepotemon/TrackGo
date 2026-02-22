import { useRootNavigationState, useRouter, useSegments } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useAuth } from "../src/auth/useAuth";

export default function Index() {
    const { firebaseUser, profile, loading } = useAuth();
    const router = useRouter();
    const segments = useSegments();
    const navState = useRootNavigationState();

    useEffect(() => {
        // ✅ espera a que el root navigator esté listo
        if (!navState?.key) return;
        if (loading) return;

        // evita loops: si ya estás en una ruta "destino", no redirigir
        const current = segments.join("/");

        if (!firebaseUser) {
            if (current !== "login") router.replace("/login");
            return;
        }

        if (!profile || !profile.active) {
            if (current !== "no-access") router.replace("/no-access");
            return;
        }

        if (profile.role === "admin") {
            if (!current.startsWith("admin")) router.replace("/admin");
            return;
        }

        // user normal
        if (current !== "user") router.replace("/user");
    }, [
        navState?.key,
        loading,
        firebaseUser?.uid,
        profile?.role,
        profile?.active,
        segments.join("/"),
    ]);

    return (
        <View
            style={{
                flex: 1,
                backgroundColor: "#0B1220",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <ActivityIndicator color="#FFFFFF" />
            <Text style={{ marginTop: 10, color: "#FFFFFF", fontWeight: "800" }}>
                Cargando sesión...
            </Text>
        </View>
    );
}