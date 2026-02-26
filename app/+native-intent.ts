export async function redirectSystemPath({
    path,
    initial,
}: {
    path: string;
    initial: boolean;
}) {
    try {
        const url = new URL(path);

        // Cuando viene del share intent / share extension,
        // Expo suele exponer hostname "expo-sharing"
        if (url.hostname === "expo-sharing") {
            // A veces llega como ?text=... o ?url=... (depende del share)
            const text =
                url.searchParams.get("mapsUrl") ||
                url.searchParams.get("maps") ||
                url.searchParams.get("url") ||
                url.searchParams.get("text") ||
                "";

            const clean = (text ?? "").trim();

            // Si hay algo, lo pasamos como mapsUrl a tu pantalla real
            if (clean) {
                return `/admin/upload-clients?mapsUrl=${encodeURIComponent(clean)}`;
            }

            // Si no vino nada, igual abre la pantalla
            return "/admin/upload-clients";
        }

        // Si no es share intent, dejamos que Expo Router lo maneje normal
        return path;
    } catch {
        // fallback seguro
        return "/";
    }
}