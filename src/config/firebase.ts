import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
    browserLocalPersistence,
    getAuth,
    initializeAuth,
    setPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// @ts-expect-error - getReactNativePersistence existe en RN bundle
import { getReactNativePersistence } from "firebase/auth";

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

declare global {
    // eslint-disable-next-line no-var
    var __TRACKGO_AUTH__: ReturnType<typeof getAuth> | undefined;
}

function getOrInitAuth() {
    if (Platform.OS === "web") {
        const a = getAuth(app);
        setPersistence(a, browserLocalPersistence).catch(() => { });
        return a;
    }

    if (globalThis.__TRACKGO_AUTH__) return globalThis.__TRACKGO_AUTH__;

    const a = initializeAuth(app, {
        persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });

    globalThis.__TRACKGO_AUTH__ = a;
    return a;
}

export const auth = getOrInitAuth();
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");