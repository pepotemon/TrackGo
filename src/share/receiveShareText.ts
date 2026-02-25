import { useEffect, useState } from "react";
import { DeviceEventEmitter, Platform } from "react-native";

export function useShareText() {
    const [sharedText, setSharedText] = useState<string | null>(null);

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const sub = DeviceEventEmitter.addListener("trackgoShareText", (text: string) => {
            setSharedText(String(text ?? ""));
        });

        return () => sub.remove();
    }, []);

    return { sharedText, clear: () => setSharedText(null) };
}