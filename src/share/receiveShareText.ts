import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeviceEventEmitter, NativeModules, Platform } from "react-native";

function isLikelyMapsUrl(input: string) {
    const lower = (input ?? "").trim().toLowerCase();
    return (
        lower.includes("maps.google") ||
        lower.includes("google.com/maps") ||
        lower.includes("maps.app.goo.gl") ||
        lower.includes("goo.gl/maps") ||
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

function normalizeSharePayload(payload: SharePayload): string {
    let v = "";
    if (typeof payload === "string") v = payload.trim();

    if (!v && payload && typeof payload === "object") {
        const anyP: any = payload;
        const cand = anyP.mapsUrl ?? anyP.maps ?? anyP.url ?? anyP.text ?? "";
        v = String(cand ?? "").trim();
    }

    // a veces viene "Mira este lugar: <url>" -> intentamos extraer URL
    if (v && !isLikelyMapsUrl(v)) {
        const match = v.match(/https?:\/\/\S+/i);
        if (match?.[0]) v = match[0].trim();
    }

    return v;
}

/**
 * ✅ Android Share Receiver hook (robusto, SOLO share-intent)
 *
 * - Warm start: DeviceEventEmitter("trackgoShareText")
 * - Cold start: NativeModules.TrackGoShare.getInitialShare()
 *
 * Importante:
 * - YA NO miramos el clipboard por defecto (eso era el plan anterior y causaba avisos raros).
 * - Esto reacciona SOLO cuando te comparten a TrackGo.
 */
export function useShareText(options: Options = {}) {
    const { autoCopyToClipboard = true, copyOnlyIfMaps = true } = options;

    const [sharedRaw, setSharedRaw] = useState<string | null>(null);
    const [didCopy, setDidCopy] = useState(false);

    // idempotencia: no re-copiar ni re-notificar el mismo link
    const lastHandledRef = useRef<string | null>(null);

    const handleValue = async (rawPayload: SharePayload) => {
        const v = normalizeSharePayload(rawPayload);

        if (!v) {
            setSharedRaw(null);
            setDidCopy(false);
            return;
        }

        // si pedimos solo maps, validamos
        const isMaps = isLikelyMapsUrl(v);
        if (copyOnlyIfMaps && !isMaps) {
            setSharedRaw(v); // igual guardamos el raw, por si quieres debug
            setDidCopy(false);
            return;
        }

        // idempotencia
        if (lastHandledRef.current === v) {
            setSharedRaw(v);
            setDidCopy(true);
            return;
        }

        setSharedRaw(v);

        if (!autoCopyToClipboard) {
            setDidCopy(false);
            lastHandledRef.current = v;
            return;
        }

        const ok = await safeCopyToClipboard(v);
        lastHandledRef.current = v;
        setDidCopy(!!ok);
    };

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const mod: any = (NativeModules as any)?.TrackGoShare;

        // ✅ 1) Cold start: leer share inicial (si existe)
        (async () => {
            try {
                if (!mod?.getInitialShare) return;

                const initial = await mod.getInitialShare(); // string | null
                if (initial) {
                    await handleValue(initial);
                    // limpiar para que no se repita si el user abre/cierra
                    if (mod?.clearInitialShare) {
                        await mod.clearInitialShare();
                    }
                }
            } catch {
                // ignore
            }
        })();

        // ✅ 2) Warm start: escuchar evento en tiempo real (si tu módulo lo emite)
        const sub = DeviceEventEmitter.addListener(
            "trackgoShareText",
            async (payload: SharePayload) => {
                try {
                    await handleValue(payload);
                } catch {
                    setSharedRaw(null);
                    setDidCopy(false);
                }
            }
        );

        return () => sub.remove();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoCopyToClipboard, copyOnlyIfMaps]);

    const sharedText = useMemo(() => (sharedRaw ? sharedRaw : null), [sharedRaw]);

    const sharedMapsUrl = useMemo(() => {
        if (!sharedRaw) return null;
        return isLikelyMapsUrl(sharedRaw) ? sharedRaw : null;
    }, [sharedRaw]);

    const clear = () => {
        setSharedRaw(null);
        setDidCopy(false);
        // no limpiamos lastHandledRef a propósito para evitar “doble toast” por el mismo share
    };

    return { sharedText, sharedMapsUrl, didCopy, clear };
}