// app/+native-intent.ts
export async function redirectSystemPath({
    path,
    initial,
}: {
    path: string;
    initial: boolean;
}) {
    try {
        const url = new URL(path);

        // Cuando viene de share intent, el host suele ser "expo-share-intent"
        // (a veces puede variar, por eso dejamos ambos)
        if (url.hostname === "expo-share-intent" || url.hostname === "expo-sharing") {
            return "/admin/upload-clients";
        }

        return path;
    } catch {
        return "/admin/upload-clients";
    }
}