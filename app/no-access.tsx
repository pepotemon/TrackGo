import { useRouter } from "expo-router";
import React from "react";
import { Button, Text, View } from "react-native";
import { useAuth } from "../src/auth/useAuth";

export default function NoAccess() {
    const { logout } = useAuth();
    const router = useRouter();

    const onLogout = async () => {
        await logout();
        router.replace({ pathname: "/login" as any });
    };

    return (
        <View style={{ padding: 16, gap: 12 }}>
            <Text>Sin acceso: tu usuario no tiene perfil o está inactivo.</Text>
            <Button title="Cerrar sesión" onPress={onLogout} />
        </View>
    );
}
