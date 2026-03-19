import React from "react";
import AdminUserClientsScreen from "./AdminUserClientsScreen";

/**
 * Wrapper para abrir la base ya filtrada en "pending".
 *
 * OJO:
 * Esta pantalla asume que AdminUserClientsScreen ya lee
 * `useLocalSearchParams().status` y usa "pending" por defecto
 * cuando la ruta se monta con ese estado.
 *
 * Si tu navegación entra con router.push({ pathname, params }),
 * esta pantalla sirve como alias visual / semántico.
 */
export default function AdminUserClientsPendingScreen() {
    return <AdminUserClientsScreen />;
}