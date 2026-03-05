import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    type User,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import React, {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Platform, ToastAndroid } from "react-native";

import { auth, db } from "../config/firebase";
import { getUserDoc } from "../data/repositories/usersRepo";
import type { UserDoc } from "../types/models";

// ✅ Expo Managed: NO hay Android intent receiver real.
// Usaremos el clipboard watcher (tu hook nuevo) para detectar links copiados.
import { useClipboardMapsWatcher } from "../share/useClipboardMapsWatcher";

/**
 * ✅ Mostrar notificación incluso con app abierta
 * ✅ FIX TS: NotificationBehavior ahora pide shouldShowBanner + shouldShowList
 */
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        // ✅ nuevas props (expo-notifications recientes)
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

type AuthState = {
    firebaseUser: User | null;
    profile: UserDoc | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;

    // ✅ NUEVO: guardar deep link pendiente (ej: mapsUrl)
    pendingDeepLink: string | null;
    setPendingDeepLink: (url: string | null) => void;
};

const Ctx = createContext<AuthState | null>(null);

// -------------------------
// Push helpers
// -------------------------

function getExpoProjectId(): string | undefined {
    // EAS (recommended)
    const easProjectId =
        (Constants as any)?.expoConfig?.extra?.eas?.projectId ??
        (Constants as any)?.easConfig?.projectId;

    // fallback (algunas versiones)
    const legacyId = (Constants as any)?.expoConfig?.extra?.projectId;

    return easProjectId ?? legacyId;
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
    // Expo Push en Android/iOS requiere dispositivo real
    if (!Device.isDevice) {
        console.log("[PUSH] Not a physical device. Skipping token.");
        return null;
    }

    // Permisos
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        finalStatus = req.status;
    }

    if (finalStatus !== "granted") {
        console.log("[PUSH] Permission not granted.");
        return null;
    }

    // Android: canal
    if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
            name: "Default",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#7C3AED",
        });
    }

    const projectId = getExpoProjectId();
    if (!projectId) {
        console.log(
            "[PUSH] Missing projectId. Add extra.eas.projectId in app.json (EAS projectId)."
        );
        // Igual intentamos sin projectId por si tu entorno lo permite
    }

    // ✅ Token Expo (mejor con projectId)
    const token = (
        await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    ).data;

    return token || null;
}

async function saveExpoPushToken(uid: string, expoPushToken: string) {
    await setDoc(
        doc(db, "users", uid),
        {
            expoPushToken,
            expoPushTokenUpdatedAt: Date.now(),
        },
        { merge: true }
    );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserDoc | null>(null);
    const [loading, setLoading] = useState(true);

    // ✅ NUEVO: deep link pendiente (ej: /admin/upload-clients?mapsUrl=...)
    const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);

    // evita re-registrar token en loop
    const lastSavedTokenRef = useRef<string | null>(null);
    const registeringRef = useRef(false);

    // ✅ Clipboard watcher: detecta links de Google Maps copiados
    const { mapsUrl, clear: clearMapsUrl } = useClipboardMapsWatcher({ enabled: true });

    // ✅ UX simple: cuando detecta un link, avisamos con toast (y ya queda listo para pegar)
    // Nota: en este flujo el link YA está en el clipboard (porque el user lo copió),
    // pero igual el toast confirma que TrackGo lo detectó.
    useEffect(() => {
        if (Platform.OS !== "android") return;
        if (!mapsUrl) return;

        ToastAndroid.show("Link de Google Maps detectado ✅", ToastAndroid.SHORT);

        // si no quieres que aparezca otra vez por el mismo link, limpiamos el estado del hook
        clearMapsUrl();
    }, [mapsUrl, clearMapsUrl]);

    useEffect(() => {
        setLoading(true);

        const unsub = onAuthStateChanged(auth, async (u) => {
            setFirebaseUser(u);
            setProfile(null);

            if (!u) {
                setLoading(false);
                return;
            }

            try {
                console.log("[AUTH] uid:", u.uid, "email:", u.email);

                const docProfile = await getUserDoc(u.uid);
                console.log("[AUTH] profile doc:", docProfile);

                setProfile(docProfile);

                // ✅ SOLO usuarios activos (no admin) guardan token
                if (docProfile?.active && docProfile?.role === "user") {
                    if (!registeringRef.current) {
                        registeringRef.current = true;
                        try {
                            const token = await registerForPushNotificationsAsync();
                            if (token && token !== lastSavedTokenRef.current) {
                                await saveExpoPushToken(u.uid, token);
                                lastSavedTokenRef.current = token;
                                console.log("[PUSH] Saved expo token:", token);
                            }
                        } catch (e) {
                            console.log("[PUSH] register/save error:", e);
                        } finally {
                            registeringRef.current = false;
                        }
                    }
                }
            } catch (err) {
                console.log("[AUTH] error loading profile:", err);
                setProfile(null);
            } finally {
                setLoading(false);
            }
        });

        return () => unsub();
    }, []);

    const login = async (email: string, password: string) => {
        await signInWithEmailAndPassword(auth, email.trim(), password);
    };

    const logout = async () => {
        setPendingDeepLink(null); // ✅ opcional: limpiar al salir
        await signOut(auth);
    };

    const value = useMemo(
        () => ({
            firebaseUser,
            profile,
            loading,
            login,
            logout,
            pendingDeepLink,
            setPendingDeepLink,
        }),
        [firebaseUser, profile, loading, pendingDeepLink]
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
    const v = useContext(Ctx);
    if (!v) throw new Error("useAuth must be used within AuthProvider");
    return v;
}