import { useRootNavigationState, useRouter, useSegments } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    ImageBackground,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import carga from "../assets/carga.png";
import { useAuth } from "../src/auth/useAuth";

export default function Index() {
    const { firebaseUser, profile, loading } = useAuth();
    const router = useRouter();
    const segments = useSegments();
    const navState = useRootNavigationState();

    const loadingSteps = useMemo(
        () => [
            "Validando sesión...",
            "Cargando clientes...",
            "Preparando mapa...",
            "Organizando visitas...",
            "Sincronizando datos...",
        ],
        []
    );

    const [stepIndex, setStepIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setStepIndex((prev) => (prev + 1) % loadingSteps.length);
        }, 1200);

        return () => clearInterval(interval);
    }, [loadingSteps.length]);

    useEffect(() => {
        if (!navState?.key) return;
        if (loading) return;

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

        if (current !== "user") router.replace("/user");
    }, [
        navState?.key,
        loading,
        firebaseUser?.uid,
        profile?.role,
        profile?.active,
        segments.join("/"),
        router,
    ]);

    return (
        <View style={styles.container}>
            <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

            <ImageBackground source={carga} style={styles.bg} resizeMode="cover">
                <View style={styles.bottomContent}>
                    <Text style={styles.brand}>
                        Track<Text style={styles.brandAccent}>Go</Text>
                    </Text>

                    <View style={styles.loaderWrap}>
                        <ActivityIndicator size="large" color="#7FE7FF" />
                    </View>

                    <Text style={styles.stepText}>{loadingSteps[stepIndex]}</Text>
                </View>
            </ImageBackground>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#000",
    },
    bg: {
        flex: 1,
        width: "100%",
        height: "100%",
        justifyContent: "flex-end",
        alignItems: "center",
    },
    bottomContent: {
        width: "100%",
        alignItems: "center",
        paddingHorizontal: 24,
        paddingBottom: 115,
    },
    brand: {
        fontSize: 34,
        fontWeight: "900",
        color: "#FFFFFF",
        letterSpacing: 0.2,
        marginBottom: 14,
        textShadowColor: "rgba(0,0,0,0.35)",
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 8,
    },
    brandAccent: {
        color: "#39B8FF",
    },
    loaderWrap: {
        marginBottom: 16,
    },
    stepText: {
        fontSize: 16,
        fontWeight: "700",
        color: "#EAF6FF",
        textAlign: "center",
        textShadowColor: "rgba(0,0,0,0.35)",
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 8,
    },
});