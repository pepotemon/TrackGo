import "react-native-gesture-handler";

import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  ImageBackground,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import bgMap from "../assets/bg-map.png";
import { AuthProvider } from "../src/auth/AuthProvider";

type RootHeaderProps = {
  title?: string;
  canGoBack: boolean;
  onGoBack: () => void;
};

function RootHeader({ title, canGoBack, onGoBack }: RootHeaderProps) {
  const insets = useSafeAreaInsets();

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
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitleTrack}>Track</Text>
              <Text style={styles.headerTitleGo}>Go</Text>
            </View>
          </View>

          <View style={styles.headerSide} />
        </View>

        <View style={styles.headerBottomLine} />
      </ImageBackground>
    </View>
  );
}

export default function RootLayout() {
  const router = useRouter();
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

      if (lastHandledUrlRef.current === url) return;
      lastHandledUrlRef.current = url;

      if (isLikelyMapsUrl(url)) {
        goToAdminUploadWithMaps(url);
        return;
      }

      const mapsParam = extractMapsUrlFromQuery(url);
      if (mapsParam) {
        goToAdminUploadWithMaps(mapsParam);
      }
    };

    Linking.getInitialURL().then(handleUrl).catch(() => { });

    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));

    return () => sub.remove();
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar
            barStyle="light-content"
            translucent={false}
            backgroundColor="#0B1220"
          />

          <Stack
            screenOptions={{
              headerShown: true,
              header: ({ navigation, route, back, options }) => (
                <RootHeader
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
              contentStyle: { backgroundColor: "#0B1220" },
              animation: "none",
              animationDuration: 0,
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />

            <Stack.Screen name="user-map" options={{ headerShown: false }} />
            <Stack.Screen name="user-history" options={{ title: "TrackGo" }} />

            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="no-access" options={{ headerShown: false }} />

            <Stack.Screen name="admin" options={{ headerShown: false }} />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
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

  headerBottomLine: {
    height: 1.5,
    backgroundColor: "rgba(12, 22, 34, 0.65)",
  },

  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },

  headerTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
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
    textShadowColor: "rgba(30,167,255,0.6)",
    textShadowRadius: 8,
  },
});