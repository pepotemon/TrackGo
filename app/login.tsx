import { useRouter } from "expo-router";
import React, { useEffect } from "react";

// La app ha migrado a trackgo.co — redirigimos al index que muestra la pantalla de migración
export default function LoginRoute() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/");
    }, []);

    return null;
}
