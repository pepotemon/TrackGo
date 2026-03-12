import React, { useMemo, useState } from "react";
import {
    ActivityIndicator,
    Image,
    ImageBackground,
    Platform,
    Pressable,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useAuth } from "../../auth/useAuth";

export default function LoginScreen() {
    const { login } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [err, setErr] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const cleanEmail = useMemo(() => email.trim(), [email]);
    const canSubmit = !!cleanEmail && !!password && !submitting;

    const onSubmit = async () => {
        setErr(null);
        setSubmitting(true);

        try {
            await login(cleanEmail, password);
        } catch (e: any) {
            setErr(e?.message ?? "No fue posible iniciar sesión.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <SafeAreaView style={styles.safe}>
            <StatusBar barStyle="light-content" />

            <ImageBackground
                source={require("../../../assets/login-bg.png")}
                style={styles.background}
                resizeMode="cover"
                imageStyle={{ left: -70, top: -100 }}
            >
                <View style={styles.overlay} />

                <View style={styles.container}>
                    <View style={styles.logoContainer}>
                        <Image
                            source={require("../../../assets/logo-trackgo.png")}
                            style={styles.logo}
                            resizeMode="contain"
                        />

                        <Text style={styles.appName}>
                            <Text style={styles.appNameTrack}>Track</Text>
                            <Text style={styles.appNameGo}>Go</Text>
                        </Text>

                        <Text style={styles.tagline}>Sistema de Rutas Inteligente</Text>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.title}>Entrar</Text>

                        <View style={styles.field}>
                            <Text style={styles.label}>E-mail</Text>
                            <TextInput
                                placeholder="tuemail@dominio.com"
                                placeholderTextColor={COLORS.muted}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="email-address"
                                value={email}
                                onChangeText={setEmail}
                                style={styles.input}
                                editable={!submitting}
                            />
                        </View>

                        <View style={styles.field}>
                            <Text style={styles.label}>Contraseña</Text>
                            <TextInput
                                placeholder="••••••••"
                                placeholderTextColor={COLORS.muted}
                                secureTextEntry
                                value={password}
                                onChangeText={setPassword}
                                style={styles.input}
                                editable={!submitting}
                                onSubmitEditing={() => {
                                    if (canSubmit) onSubmit();
                                }}
                            />
                        </View>

                        {err ? (
                            <View style={styles.errorBox}>
                                <Text style={styles.errorText}>{err}</Text>
                            </View>
                        ) : null}

                        <Pressable
                            onPress={onSubmit}
                            disabled={!canSubmit}
                            style={({ pressed }) => [
                                styles.button,
                                !canSubmit && styles.buttonDisabled,
                                pressed && canSubmit && styles.buttonPressed,
                            ]}
                        >
                            <View style={styles.buttonInner}>
                                {submitting ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.buttonText}>Entrar</Text>
                                )}
                            </View>
                        </Pressable>
                    </View>

                    <Text style={styles.footer}>
                        © {new Date().getFullYear()} TrackGo
                    </Text>
                </View>
            </ImageBackground>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "rgba(10, 18, 34, 0.62)",
    border: "rgba(255,255,255,0.10)",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    primary: "#1D4ED8",
    primaryTop: "#2F6BFF",
    primaryBottom: "#1B56D6",
    primaryGlow: "#2AD4FF",
    danger: "#F87171",
};

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
        paddingTop: Platform.OS === "android" ? 10 : 0,
    },

    background: {
        flex: 1,
    },

    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(3, 10, 24, 0.42)",
    },

    container: {
        flex: 1,
        paddingHorizontal: 20,
        justifyContent: "center",
        gap: 30,
    },

    logoContainer: {
        alignItems: "center",
        gap: 8,
    },

    logo: {
        width: 400,
        height: 400,
    },

    appName: {
        fontSize: 32,
        fontWeight: "900",
        letterSpacing: 1,
        marginTop: -155,
    },

    appNameTrack: {
        color: COLORS.text,
    },

    appNameGo: {
        color: "#18A8FF",
    },

    tagline: {
        color: "#C3CEDD",
        fontSize: 13,
        fontWeight: "600",
    },

    card: {
        backgroundColor: COLORS.card,
        borderRadius: 22,
        padding: 20,
        borderWidth: 1,
        borderColor: COLORS.border,
        gap: 14,
        overflow: "hidden",
    },

    title: {
        color: COLORS.text,
        fontSize: 20,
        fontWeight: "800",
    },

    field: {
        gap: 6,
    },

    label: {
        color: "#CBD5E1",
        fontSize: 12,
        fontWeight: "700",
    },

    input: {
        height: 48,
        borderRadius: 14,
        paddingHorizontal: 14,
        backgroundColor: "rgba(15, 23, 42, 0.72)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "600",
    },

    errorBox: {
        backgroundColor: "rgba(248,113,113,0.10)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.35)",
        padding: 10,
        borderRadius: 12,
    },

    errorText: {
        color: COLORS.danger,
        fontWeight: "700",
        fontSize: 13,
    },

    button: {
        height: 56,
        borderRadius: 18,
        backgroundColor: COLORS.primary,
        borderWidth: 1,
        borderColor: "rgba(123, 211, 255, 0.28)",
        justifyContent: "center",
        shadowColor: COLORS.primaryGlow,
        shadowOpacity: 0.28,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
        overflow: "hidden",
    },

    buttonInner: {
        flex: 1,
        borderRadius: 18,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "transparent",
    },

    buttonPressed: {
        transform: [{ scale: 0.97 }],
    },

    buttonDisabled: {
        opacity: 0.5,
    },

    buttonText: {
        color: "#fff",
        fontWeight: "900",
        fontSize: 16,
        letterSpacing: 0.2,
    },

    footer: {
        textAlign: "center",
        color: "#D6DFEC",
        fontSize: 12,
        marginTop: 10,
        fontWeight: "600",
    },
});