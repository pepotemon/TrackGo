import { Stack } from "expo-router";
import React from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/auth/AuthProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar barStyle="light-content" translucent={false} backgroundColor="#0B1220" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0B1220" } }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}