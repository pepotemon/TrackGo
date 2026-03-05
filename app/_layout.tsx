import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/auth/AuthProvider";

export default function RootLayout() {
  const router = useRouter();

  // ✅ evita doble navegación (getInitialURL + event, o misma url repetida)
  const lastHandledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const isLikelyMapsUrl = (url: string) => {
      const lower = (url ?? "").trim().toLowerCase();
      return (
        lower.includes("maps.google") ||
        lower.includes("google.com/maps") ||
        lower.includes("maps.app.goo.gl") ||
        lower.includes("goo.gl/maps") ||
        (lower.includes("google.com") && lower.includes("maps"))
      );
    };

    const extractMapsUrlFromQuery = (url: string) => {
      try {
        const parsed = Linking.parse(url);
        const qp: any = parsed?.queryParams ?? {};
        const val = qp.mapsUrl ?? qp.maps ?? qp.url ?? "";
        const out = typeof val === "string" ? val : String(val ?? "");
        return (out ?? "").trim();
      } catch {
        return "";
      }
    };

    const goToAdminUploadWithMaps = (mapsUrl: string) => {
      const clean = (mapsUrl ?? "").trim();
      if (!clean) return;

      router.push({
        pathname: "/admin/upload-clients" as any,
        params: { mapsUrl: clean },
      });
    };

    const handleUrl = (urlRaw?: string | null) => {
      const url = (urlRaw ?? "").trim();
      if (!url) return;

      // ✅ idempotencia
      if (lastHandledUrlRef.current === url) return;
      lastHandledUrlRef.current = url;

      // 1) Si el propio URL que llega es un maps link -> úsalo directo
      if (isLikelyMapsUrl(url)) {
        goToAdminUploadWithMaps(url);
        return;
      }

      // 2) Si llega un deep link tipo trackgo://...?mapsUrl=...
      const mapsParam = extractMapsUrlFromQuery(url);
      if (mapsParam) {
        // mapsParam puede ser un link completo o un string raro; si no es maps, igual lo pasamos
        // porque tu screen puede decidir qué hacer.
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