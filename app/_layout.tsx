import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/auth/AuthProvider";

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    const isLikelyMapsUrl = (url: string) => {
      const lower = (url ?? "").toLowerCase();
      return (
        lower.includes("maps.google") ||
        lower.includes("google.com/maps") ||
        lower.includes("maps.app.goo.gl") ||
        lower.includes("goo.gl/maps") ||
        lower.includes("goo.gl") ||
        // deja este último al final para no falsear tanto
        (lower.includes("google.com") && lower.includes("maps"))
      );
    };

    const extractMapsUrlFromQuery = (url: string) => {
      try {
        const parsed = Linking.parse(url);
        const qp: any = parsed?.queryParams ?? {};
        const val = qp.mapsUrl ?? qp.maps ?? qp.url ?? "";
        return typeof val === "string" ? val : String(val ?? "");
      } catch {
        return "";
      }
    };

    const goToAdminUploadWithMaps = (mapsUrl: string) => {
      const clean = (mapsUrl ?? "").trim();
      if (!clean) return;

      // Nota: ajusta pathname si tu ruta real es otra
      router.push({
        pathname: "/admin/upload-clients" as any,
        params: { mapsUrl: clean },
      });
    };

    const handleUrl = (urlRaw?: string | null) => {
      const url = (urlRaw ?? "").trim();
      if (!url) return;

      // 1) Si el propio URL que llega es un maps link -> úsalo directo
      if (isLikelyMapsUrl(url)) {
        goToAdminUploadWithMaps(url);
        return;
      }

      // 2) Si llega un deep link tipo trackgo://admin/upload?mapsUrl=...
      const mapsParam = extractMapsUrlFromQuery(url);
      if (mapsParam) {
        goToAdminUploadWithMaps(mapsParam);
      }
    };

    // initial URL (cold start)
    Linking.getInitialURL().then(handleUrl).catch(() => { });

    // runtime events
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));

    return () => sub.remove();
  }, [router]);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar
          barStyle="light-content"
          translucent={false}
          backgroundColor="#0B1220"
        />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#0B1220" },
          }}
        />
      </AuthProvider>
    </SafeAreaProvider>
  );
}