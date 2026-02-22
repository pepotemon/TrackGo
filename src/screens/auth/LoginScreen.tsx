import React, { useMemo, useState } from "react";
import {
    ActivityIndicator,
    Image,
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

            <View style={styles.container}>
                {/* LOGO + NAME */}
                <View style={styles.logoContainer}>
                    <Image
                        source={require("../../../assets/logo-trackgo.png")}
                        style={styles.logo}
                        resizeMode="contain"
                    />
                    <Text style={styles.appName}>TrackGo</Text>
                    <Text style={styles.tagline}>Sistema de Rutas Inteligente</Text>
                </View>

                {/* CARD */}
                <View style={styles.card}>
                    <Text style={styles.title}>Entrar</Text>

                    <View style={styles.field}>
                        <Text style={styles.label}>E-mail</Text>
                        <TextInput
                            placeholder="seuemail@dominio.com"
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
                        <Text style={styles.label}>Senha</Text>
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
                        {submitting ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.buttonText}>Entrar</Text>
                        )}
                    </Pressable>
                </View>

                <Text style={styles.footer}>
                    © {new Date().getFullYear()} TrackGo
                </Text>
            </View>
        </SafeAreaView>
    );
}

const COLORS = {
    bg: "#0B1220",
    card: "#111827",
    border: "#1F2937",
    text: "#F9FAFB",
    muted: "#9CA3AF",
    primary: "#2563EB",
    primaryGlow: "#14B8A6",
    danger: "#F87171",
};

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: COLORS.bg,
        paddingTop: Platform.OS === "android" ? 10 : 0,
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
        width: 300,
        height: 300,
    },

    appName: {
        color: COLORS.text,
        fontSize: 32,
        fontWeight: "900",
        letterSpacing: 1,
        marginTop: -90
    },

    tagline: {
        color: COLORS.muted,
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
        color: COLORS.muted,
        fontSize: 12,
        fontWeight: "700",
    },

    input: {
        height: 48,
        borderRadius: 14,
        paddingHorizontal: 14,
        backgroundColor: "#0F172A",
        borderWidth: 1,
        borderColor: COLORS.border,
        color: COLORS.text,
        fontSize: 14,
        fontWeight: "600",
    },

    errorBox: {
        backgroundColor: "rgba(248,113,113,0.1)",
        borderWidth: 1,
        borderColor: "rgba(248,113,113,0.4)",
        padding: 10,
        borderRadius: 12,
    },

    errorText: {
        color: COLORS.danger,
        fontWeight: "700",
        fontSize: 13,
    },

    button: {
        height: 52,
        borderRadius: 18,
        backgroundColor: COLORS.primary,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: COLORS.primaryGlow,
        shadowOpacity: 0.5,
        shadowRadius: 25,
        shadowOffset: { width: 0, height: 12 },
        elevation: 6,
    },

    buttonPressed: {
        transform: [{ scale: 0.96 }],
    },

    buttonDisabled: {
        opacity: 0.5,
    },

    buttonText: {
        color: "#fff",
        fontWeight: "900",
        fontSize: 16,
    },

    footer: {
        textAlign: "center",
        color: COLORS.muted,
        fontSize: 12,
        marginTop: 10,
    },
});