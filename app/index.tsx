import { signOut } from "firebase/auth";
import React, { useEffect, useRef } from "react";
import {
    Animated,
    ImageBackground,
    Linking,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import carga from "../assets/carga.png";
import { auth } from "../src/config/firebase";

const NEW_URL = "https://trackgo.co";

export default function Index() {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(40)).current;
    const btnScale = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        // Cerrar sesión de cualquier usuario activo
        signOut(auth).catch(() => {});

        // Animación de entrada
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 900,
                useNativeDriver: true,
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 60,
                friction: 10,
                useNativeDriver: true,
            }),
        ]).start();
    }, []);

    const handleOpen = () => {
        Animated.sequence([
            Animated.timing(btnScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
            Animated.timing(btnScale, { toValue: 1, duration: 80, useNativeDriver: true }),
        ]).start(() => {
            Linking.openURL(NEW_URL);
        });
    };

    return (
        <View style={styles.container}>
            <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

            <ImageBackground source={carga} style={styles.bg} resizeMode="cover">
                <View style={styles.overlay} />

                <Animated.View
                    style={[
                        styles.card,
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }],
                        },
                    ]}
                >
                    {/* Logo/Brand */}
                    <View style={styles.brandRow}>
                        <Text style={styles.brandTrack}>Track</Text>
                        <Text style={styles.brandGo}>Go</Text>
                    </View>

                    {/* Badge */}
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>NUEVA VERSION</Text>
                    </View>

                    {/* Mensaje principal */}
                    <Text style={styles.title}>
                        Nos hemos{"\n"}
                        <Text style={styles.titleAccent}>renovado</Text>
                    </Text>

                    <Text style={styles.subtitle}>
                        TrackGo ahora es una app web.{"\n"}
                        Misma potencia, desde cualquier dispositivo.
                    </Text>

                    {/* URL destacada */}
                    <View style={styles.urlBox}>
                        <View style={styles.urlDot} />
                        <Text style={styles.urlText}>trackgo.co</Text>
                    </View>

                    {/* Boton CTA */}
                    <Animated.View style={{ transform: [{ scale: btnScale }], width: "100%" }}>
                        <Pressable style={styles.ctaBtn} onPress={handleOpen}>
                            <Text style={styles.ctaBtnText}>Ir a TrackGo</Text>
                            <Text style={styles.ctaArrow}>→</Text>
                        </Pressable>
                    </Animated.View>

                    <Text style={styles.hint}>
                        Puedes guardar la pagina en tu inicio{"\n"}para acceder igual que antes.
                    </Text>
                </Animated.View>
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
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(8, 18, 40, 0.72)",
    },
    card: {
        width: "100%",
        paddingHorizontal: 28,
        paddingBottom: 56,
        paddingTop: 32,
        alignItems: "center",
    },
    brandRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 12,
    },
    brandTrack: {
        fontSize: 38,
        fontWeight: "900",
        color: "#FFFFFF",
        letterSpacing: 0.2,
    },
    brandGo: {
        fontSize: 38,
        fontWeight: "900",
        color: "#39B8FF",
        letterSpacing: 0.2,
        textShadowColor: "rgba(57,184,255,0.55)",
        textShadowRadius: 12,
    },
    badge: {
        backgroundColor: "rgba(57,184,255,0.15)",
        borderWidth: 1,
        borderColor: "rgba(57,184,255,0.4)",
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 4,
        marginBottom: 20,
    },
    badgeText: {
        color: "#39B8FF",
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 2,
    },
    title: {
        fontSize: 32,
        fontWeight: "900",
        color: "#FFFFFF",
        textAlign: "center",
        lineHeight: 40,
        marginBottom: 14,
    },
    titleAccent: {
        color: "#39B8FF",
        textShadowColor: "rgba(57,184,255,0.5)",
        textShadowRadius: 10,
    },
    subtitle: {
        fontSize: 15,
        color: "rgba(255,255,255,0.72)",
        textAlign: "center",
        lineHeight: 22,
        marginBottom: 24,
        fontWeight: "500",
    },
    urlBox: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.07)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.15)",
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 10,
        marginBottom: 28,
        gap: 8,
    },
    urlDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: "#39B8FF",
        shadowColor: "#39B8FF",
        shadowRadius: 6,
        shadowOpacity: 0.8,
        elevation: 4,
    },
    urlText: {
        color: "#FFFFFF",
        fontSize: 18,
        fontWeight: "800",
        letterSpacing: 0.5,
    },
    ctaBtn: {
        backgroundColor: "#39B8FF",
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 32,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        shadowColor: "#39B8FF",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.45,
        shadowRadius: 16,
        elevation: 10,
        marginBottom: 20,
    },
    ctaBtnText: {
        color: "#0B1220",
        fontSize: 17,
        fontWeight: "900",
        letterSpacing: 0.3,
    },
    ctaArrow: {
        color: "#0B1220",
        fontSize: 18,
        fontWeight: "900",
    },
    hint: {
        fontSize: 13,
        color: "rgba(255,255,255,0.4)",
        textAlign: "center",
        lineHeight: 19,
    },
});
