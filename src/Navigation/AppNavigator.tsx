import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { useAuth } from "../auth/useAuth";

import AdminHomeScreen from "../screens/admin/AdminHomeScreen";
import AdminUploadClientsScreen from "../screens/admin/AdminUploadClientsScreen";
import AdminUsersScreen from "../screens/admin/AdminUsersScreen";
import LoginScreen from "../screens/auth/LoginScreen";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
    const { firebaseUser, profile, loading } = useAuth();

    if (loading) return null;

    // No logueado
    if (!firebaseUser) {
        return (
            <NavigationContainer>
                <Stack.Navigator>
                    <Stack.Screen name="Login" component={LoginScreen} />
                </Stack.Navigator>
            </NavigationContainer>
        );
    }

    // Logueado pero sin profile en Firestore (o inactive)
    if (!profile || !profile.active) {
        return (
            <NavigationContainer>
                <Stack.Navigator>
                    <Stack.Screen
                        name="NoProfile"
                        component={() => null}
                        options={{ title: "Sin acceso" }}
                    />
                </Stack.Navigator>
            </NavigationContainer>
        );
    }

    // Admin (por ahora solo admin)
    if (profile.role === "admin") {
        return (
            <NavigationContainer>
                <Stack.Navigator>
                    <Stack.Screen name="AdminHome" component={AdminHomeScreen} options={{ title: "TrackGo Admin" }} />
                    <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: "Usuarios" }} />
                    <Stack.Screen name="AdminUploadClients" component={AdminUploadClientsScreen} options={{ title: "Clientes" }} />
                </Stack.Navigator>
            </NavigationContainer>
        );
    }

    // User (lo dejamos para después)
    return (
        <NavigationContainer>
            <Stack.Navigator>
                <Stack.Screen name="UserHome" component={() => null} options={{ title: "TrackGo" }} />
            </Stack.Navigator>
        </NavigationContainer>
    );
}
