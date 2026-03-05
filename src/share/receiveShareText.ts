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
    autoCopyToClipboard?: boolean;
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
    return v;
}

/**
 * ✅ Android Share Receiver hook (robusto)
 * - Warm start: DeviceEventEmitter("trackgoShareText")
 * - Cold start: NativeModules.TrackGoShare.getInitialShare()
 */
export function useShareText(options: Options = {}) {
    const { autoCopyToClipboard = true, copyOnlyIfMaps = true } = options;

    const [sharedRaw, setSharedRaw] = useState<string | null>(null);
    const [didCopy, setDidCopy] = useState(false);

    const lastCopiedRef = useRef<string | null>(null);

    const handleValue = async (rawPayload: SharePayload) => {
        const v = normalizeSharePayload(rawPayload);

        if (!v) {
            setSharedRaw(null);
            setDidCopy(false);
            return;
        }

        setSharedRaw(v);

        if (!autoCopyToClipboard) return;

        const isMaps = isLikelyMapsUrl(v);
        if (copyOnlyIfMaps && !isMaps) return;

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
    };

    useEffect(() => {
        if (Platform.OS !== "android") return;

        // ✅ 1) Cold start: leer share inicial (si existe)
        (async () => {
            try {
                const mod: any = (NativeModules as any).TrackGoShare;
                if (mod?.getInitialShare) {
                    const initial = await mod.getInitialShare(); // string | null
                    if (initial) {
                        await handleValue(initial);
                        // opcional: limpiar para que no se repita
                        if (mod.clearInitialShare) await mod.clearInitialShare();
                    }
                }
            } catch {
                // ignore
            }
        })();

        // ✅ 2) Warm start: escuchar evento en tiempo real
        const sub = DeviceEventEmitter.addListener("trackgoShareText", async (payload: SharePayload) => {
            try {
                await handleValue(payload);
            } catch {
                setSharedRaw(null);
                setDidCopy(false);
            }
        });

        return () => sub.remove();
    }, [autoCopyToClipboard, copyOnlyIfMaps]);

    const sharedText = useMemo(() => (sharedRaw ? sharedRaw : null), [sharedRaw]);
    const sharedMapsUrl = useMemo(() => (sharedRaw && isLikelyMapsUrl(sharedRaw) ? sharedRaw : null), [sharedRaw]);

    const clear = () => {
        setSharedRaw(null);
        setDidCopy(false);
    };

    return { sharedText, sharedMapsUrl, didCopy, clear };
}