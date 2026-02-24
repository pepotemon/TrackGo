import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Platform } from "react-native";

import { db } from "../config/firebase";

// ✅ Handler global: corrige el error de NotificationBehavior
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,

        // ✅ NUEVOS CAMPOS (requeridos por types nuevos)
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

async function ensureAndroidChannel() {
    if (Platform.OS !== "android") return;

    await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#7C3AED",
    });
}

function getExpoProjectId(): string | undefined {
    // expo sdk new: a veces viene en Constants.easConfig
    const easId = (Constants as any)?.easConfig?.projectId as string | undefined;
    const extraId = (Constants as any)?.expoConfig?.extra?.eas?.projectId as string | undefined;
    return easId || extraId;
}

export async function ensurePushTokenForUser(uid: string) {
    if (!uid) return;

    await ensureAndroidChannel();

    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;

    if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
    }

    if (status !== "granted") {
        // Sin permiso, no hacemos nada
        return;
    }

    const projectId = getExpoProjectId();
    if (!projectId) {
        console.log("[PUSH] Missing projectId (EAS). Revisa app.json extra.eas.projectId");
        return;
    }

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenResp.data;

    // ✅ Guardar token en users/{uid} (merge)
    await setDoc(
        doc(db, "users", uid),
        {
            expoPushToken,
            expoPushTokenUpdatedAt: serverTimestamp(),
            platform: Platform.OS,
        },
        { merge: true }
    );
}