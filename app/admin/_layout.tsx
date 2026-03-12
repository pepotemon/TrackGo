import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import React, { useEffect } from "react";
import {
    ActivityIndicator,
    ImageBackground,
    Pressable,
    StyleSheet,
    Text,
    View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import bgMap from "../../assets/bg-map.png";
import { useAuth } from "../../src/auth/useAuth";

type AdminHeaderProps = {
    title?: string;
    canGoBack: boolean;
    onGoBack: () => void;
};

function AdminHeader({ title, canGoBack, onGoBack }: AdminHeaderProps) {
    const insets = useSafeAreaInsets();
    const isTrackGo = !title || title === "TrackGo";

    return (
        <View style={[styles.headerShell, { paddingTop: insets.top }]}>
            <ImageBackground
                source={bgMap}
                style={styles.headerBg}
                imageStyle={styles.headerBgImage}
                resizeMode="cover"
            >
                <View style={styles.headerTint} />

                <View style={styles.headerInner}>
                    <View style={styles.headerSide}>
                        {canGoBack ? (
                            <Pressable
                                onPress={onGoBack}
                                style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
                            >
                                <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
                            </Pressable>
                        ) : (
                            <View style={styles.backBtnPlaceholder} />
                        )}
                    </View>

                    <View style={styles.headerCenter}>
                        {isTrackGo ? (
                            <View style={styles.headerTitleWrap}>
                                <Text style={styles.headerTitleTrack}>Track</Text>
                                <Text style={styles.headerTitleGo}>Go</Text>
                            </View>
                        ) : (
                            <Text style={styles.headerTitleText}>{title}</Text>
                        )}
                    </View>

                    <View style={styles.headerSide} />
                </View>

                <View style={styles.headerBottomLine} />
            </ImageBackground>
        </View>
    );
}

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
    }, [
        loading,
        firebaseUser?.uid,
        profile?.role,
        profile?.active,
        router,
    ]);

    if (loading || !firebaseUser || !profile) {
        return (
            <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color="#FFFFFF" />
            </View>
        );
    }

    return (
        <Stack
            screenOptions={{
                headerShown: true,
                header: ({ navigation, route, back, options }) => (
                    <AdminHeader
                        title={
                            typeof options.title === "string"
                                ? options.title
                                : route.name === "index"
                                    ? "TrackGo"
                                    : "TrackGo"
                        }
                        canGoBack={!!back}
                        onGoBack={() => navigation.goBack()}
                    />
                ),
                contentStyle: {
                    backgroundColor: "#0B1220",
                },
                animation: "none",
                animationDuration: 0,
            }}
        >
            <Stack.Screen name="index" options={{ title: "TrackGo" }} />
            <Stack.Screen name="users" options={{ title: "TrackGo" }} />
            <Stack.Screen name="clients" options={{ title: "TrackGo" }} />
            <Stack.Screen name="leads" options={{ title: "TrackGo" }} />
            <Stack.Screen name="accounting" options={{ title: "TrackGo" }} />
            <Stack.Screen name="history" options={{ title: "TrackGo" }} />
            <Stack.Screen name="report" options={{ title: "TrackGo" }} />
        </Stack>
    );
}

const styles = StyleSheet.create({
    loadingWrap: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0B1220",
    },

    headerShell: {
        backgroundColor: "#0B1220",
    },

    headerBg: {
        height: 88,
        justifyContent: "flex-end",
        overflow: "hidden",
    },

    headerBgImage: {
        opacity: 0.95,
    },

    headerTint: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(8, 42, 98, 0.30)",
    },

    headerInner: {
        height: 72,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },

    headerSide: {
        width: 48,
        alignItems: "flex-start",
        justifyContent: "center",
    },

    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(15, 23, 42, 0.34)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
    },

    backBtnPlaceholder: {
        width: 40,
        height: 40,
    },

    headerCenter: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
    },

    headerLogo: {
        width: 120,
        height: 120,
        marginRight: -40,
    },

    headerTitleWrap: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },

    headerTitleTrack: {
        color: "#F8FAFC",
        fontSize: 24,
        fontWeight: "900",
        letterSpacing: 0.2,
    },

    headerTitleGo: {
        color: "#1EA7FF",
        fontSize: 24,
        fontWeight: "900",
        letterSpacing: 0.2,
        textShadowColor: "rgba(30,167,255,0.60)",
        textShadowRadius: 8,
    },

    headerTitleText: {
        color: "#F8FAFC",
        fontSize: 24,
        fontWeight: "900",
        letterSpacing: 0.2,
    },

    headerBottomLine: {
        height: 1.5,
        backgroundColor: "rgba(12, 22, 34, 0.65)",
    },

    pressed: {
        opacity: 0.92,
        transform: [{ scale: 0.98 }],
    },
});