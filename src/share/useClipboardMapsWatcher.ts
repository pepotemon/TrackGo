import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

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

export function useClipboardMapsWatcher(opts?: {
    enabled?: boolean;
    /** si true, NO revisa al montar; solo cuando vuelve a foreground */
    skipInitialCheck?: boolean;
}) {
    const enabled = opts?.enabled ?? true;
    const skipInitialCheck = opts?.skipInitialCheck ?? true;

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

        // ✅ NO revisa al montar (evita alertas por links viejos)
        if (!skipInitialCheck) {
            checkClipboard();
        }

        const sub = AppState.addEventListener("change", (s) => {
            if (s !== "active") return;
            // iOS/Android igual
            checkClipboard();
        });

        return () => sub.remove();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, skipInitialCheck]);

    const clear = () => setMapsUrl(null);

    return { mapsUrl, clear, recheck: checkClipboard };
}