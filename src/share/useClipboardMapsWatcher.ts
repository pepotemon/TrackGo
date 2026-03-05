import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

function isLikelyMapsUrl(input: string) {
    const lower = (input ?? "").trim().toLowerCase();
    return (
        lower.includes("maps.google") ||
        lower.includes("google.com/maps") ||
        lower.includes("maps.app.goo.gl") ||
        lower.includes("goo.gl/maps") ||
        (lower.includes("google.com") && lower.includes("maps")) ||
        lower.includes("goo.gl/maps")
    );
}

export function useClipboardMapsWatcher(opts?: { enabled?: boolean }) {
    const enabled = opts?.enabled ?? true;

    const [mapsUrl, setMapsUrl] = useState<string | null>(null);
    const lastRef = useRef<string | null>(null);

    const checkClipboard = async () => {
        try {
            const str = await Clipboard.getStringAsync();
            const v = (str ?? "").trim();
            if (!v) return;
            if (!isLikelyMapsUrl(v)) return;
            if (lastRef.current === v) return;

            lastRef.current = v;
            setMapsUrl(v);
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        if (!enabled) return;

        // check al montar
        checkClipboard();

        // check al volver a foreground (cuando vienes de Google Maps)
        const sub = AppState.addEventListener("change", (s) => {
            if (Platform.OS === "android" && s === "active") checkClipboard();
            if (Platform.OS === "ios" && s === "active") checkClipboard();
        });

        return () => sub.remove();
    }, [enabled]);

    const clear = () => setMapsUrl(null);

    return { mapsUrl, clear, recheck: checkClipboard };
}