import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
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

type Options = {
    /** copia automáticamente al portapapeles cuando llegue un link */
    autoCopyToClipboard?: boolean;
    /** si true, solo copia si parece Google Maps */
    copyOnlyIfMaps?: boolean;
};

async function safeCopyToClipboard(text: string) {
    try {
        await Clipboard.setStringAsync(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Android Share Receiver hook
 * - Escucha DeviceEventEmitter("trackgoShareText")
 * - Normaliza payloads (string | object)
 * - Prioriza mapsUrl/url/text
 * - Detecta Google Maps y (opcional) copia al portapapeles
 */
export function useShareText(options: Options = {}) {
    const {
        autoCopyToClipboard = true,
        copyOnlyIfMaps = true,
    } = options;

    const [sharedRaw, setSharedRaw] = useState<string | null>(null);
    const [didCopy, setDidCopy] = useState(false);

    // evita re-copiar el mismo link varias veces
    const lastCopiedRef = useRef<string | null>(null);

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const sub = DeviceEventEmitter.addListener(
            "trackgoShareText",
            async (payload: SharePayload) => {
                try {
                    let v = "";

                    // Caso 1: viene string directo
                    if (typeof payload === "string") {
                        v = payload.trim();
                    }

                    // Caso 2: viene objeto (text/url/mapsUrl...)
                    if (!v && payload && typeof payload === "object") {
                        const anyP: any = payload;
                        const cand =
                            anyP.mapsUrl ??
                            anyP.maps ??
                            anyP.url ??
                            anyP.text ??
                            "";
                        v = String(cand ?? "").trim();
                    }

                    if (!v) {
                        setSharedRaw(null);
                        setDidCopy(false);
                        return;
                    }

                    setSharedRaw(v);

                    // ✅ copiar al portapapeles (si está habilitado)
                    if (!autoCopyToClipboard) return;

                    const isMaps = isLikelyMapsUrl(v);
                    if (copyOnlyIfMaps && !isMaps) return;

                    // idempotencia
                    if (lastCopiedRef.current === v) {
                        setDidCopy(true);
                        return;
                    }

                    const ok = await safeCopyToClipboard(v);
                    if (ok) {
                        lastCopiedRef.current = v;
                        setDidCopy(true);
                    } else {
                        setDidCopy(false);
                    }
                } catch {
                    setSharedRaw(null);
                    setDidCopy(false);
                }
            }
        );

        return () => sub.remove();
    }, [autoCopyToClipboard, copyOnlyIfMaps]);

    const sharedText = useMemo(() => {
        return sharedRaw ? sharedRaw : null;
    }, [sharedRaw]);

    const sharedMapsUrl = useMemo(() => {
        if (!sharedRaw) return null;
        return isLikelyMapsUrl(sharedRaw) ? sharedRaw : null;
    }, [sharedRaw]);

    const clear = () => {
        setSharedRaw(null);
        setDidCopy(false);
        // no borro lastCopiedRef a propósito; si quieres permitir copiar mismo link otra vez:
        // lastCopiedRef.current = null;
    };

    return { sharedText, sharedMapsUrl, didCopy, clear };
}