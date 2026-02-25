import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/auth/AuthProvider";

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    const handleUrl = (urlRaw?: string | null) => {
      const url = (urlRaw ?? "").trim();
      if (!url) return;

      // Si el link que llega es de Google Maps o contiene "maps"
      const lower = url.toLowerCase();
      const looksMaps = lower.includes("maps.google") || lower.includes("google.com/maps") || lower.includes("goo.gl") || lower.includes("maps.app.goo.gl") || lower.includes("maps");

      if (looksMaps) {
        // 🔧 Ajusta este pathname a tu ruta real del admin upload
        router.push({
          pathname: "/admin/upload" as any,
          params: { mapsUrl: url },
        });
        return;
      }

      // Si llega un deep link tipo trackgo://admin/upload?mapsUrl=...
      try {
        const parsed = Linking.parse(url);
        const mapsUrlParam =
          (parsed?.queryParams?.mapsUrl as string) ||
          (parsed?.queryParams?.maps as string) ||
          "";

        if (mapsUrlParam) {
          router.push({
            pathname: "/admin/upload" as any,
            params: { mapsUrl: String(mapsUrlParam) },
          });
        }
      } catch {
        // silent
      }
    };

    // initial URL
    Linking.getInitialURL().then((u) => handleUrl(u)).catch(() => { });

    // subscribe
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));

    return () => {
      sub.remove();
    };
  }, [router]);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar barStyle="light-content" translucent={false} backgroundColor="#0B1220" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0B1220" } }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}