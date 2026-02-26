import { useEffect, useMemo, useState } from "react";
import { DeviceEventEmitter, Platform } from "react-native";

function isLikelyMapsUrl(input: string) {
    const lower = (input ?? "").trim().toLowerCase();
    return (
        lower.includes("maps.google") ||
        lower.includes("google.com/maps") ||
        lower.includes("maps.app.goo.gl") ||
        lower.includes("goo.gl/maps") ||
        // algunos shares vienen así:
        (lower.includes("google.com") && lower.includes("maps")) ||
        lower.includes("goo.gl")
    );
}

type SharePayload =
    | string
    | {
        text?: string;
        url?: string;
        mapsUrl?: string;
        maps?: string;
        [k: string]: any;
    }
    | null
    | undefined;

/**
 * Android Share Receiver hook
 * - Escucha DeviceEventEmitter("trackgoShareText")
 * - Normaliza payloads (string | object)
 * - Prioriza mapsUrl/url/text
 * - Filtra para quedarse con links de Google Maps (si existen)
 */
export function useShareText() {
    const [sharedRaw, setSharedRaw] = useState<string | null>(null);

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const sub = DeviceEventEmitter.addListener(
            "trackgoShareText",
            (payload: SharePayload) => {
                try {
                    // Caso 1: viene string directo
                    if (typeof payload === "string") {
                        const v = payload.trim();
                        setSharedRaw(v || null);
                        return;
                    }

                    // Caso 2: viene objeto (text/url/mapsUrl...)
                    if (payload && typeof payload === "object") {
                        const anyP: any = payload;
                        const cand =
                            anyP.mapsUrl ??
                            anyP.maps ??
                            anyP.url ??
                            anyP.text ??
                            "";

                        const v = String(cand ?? "").trim();
                        setSharedRaw(v || null);
                        return;
                    }

                    setSharedRaw(null);
                } catch {
                    setSharedRaw(null);
                }
            }
        );

        return () => sub.remove();
    }, []);

    // Derivados “bonitos”
    const sharedText = useMemo(() => {
        if (!sharedRaw) return null;
        return sharedRaw;
    }, [sharedRaw]);

    const sharedMapsUrl = useMemo(() => {
        if (!sharedRaw) return null;
        return isLikelyMapsUrl(sharedRaw) ? sharedRaw : null;
    }, [sharedRaw]);

    const clear = () => setSharedRaw(null);

    return { sharedText, sharedMapsUrl, clear };
}