// types/models.ts

// ----------------------
// USERS
// ----------------------
export type UserRole = "admin" | "user";

export type UserDoc = {
    id: string;

    name: string;
    email: string;

    role: UserRole;
    active: boolean;

    createdAt: number; // Date.now()
    updatedAt?: number;

    /**
     * ✅ Campo oficial de monetización
     * Tarifa por cliente visitado (R$)
     */
    ratePerVisit?: number;

    /**
     * ✅ Push notifications (Expo)
     * El user puede actualizar esto (rules).
     */
    expoPushToken?: string | null;
    expoPushTokenUpdatedAt?: number; // ms
};

// ----------------------
// CLIENTS
// ----------------------
export type ClientStatus = "pending" | "visited" | "rejected";

/**
 * ✅ Motivos permitidos de rechazo
 */
export type RejectedReason =
    | "clavo"
    | "localizacion"
    | "zona_riesgosa"
    | "ingresos_insuficientes"
    | "muy_endeudado"
    | "informacion_dudosa"
    | "no_le_interesa"
    | "no_estaba_cerrado"
    | "fuera_de_ruta"
    | "otro";

export type ClientDoc = {
    id: string;

    name?: string;
    business?: string;

    phone: string;
    mapsUrl: string;
    address?: string;

    assignedTo?: string;
    assignedAt?: number;
    assignedDayKey?: string;

    /**
     * Estado actual REAL del cliente
     */
    status: ClientStatus;

    /**
     * Quién marcó el último estado.
     * Cuando vuelve a "pending" → debe ser null.
     */
    statusBy?: string | null;

    /**
     * Timestamp del último cambio de estado.
     * Cuando vuelve a "pending" → debe ser null.
     */
    statusAt?: number | null;

    createdAt: number; // ms
    updatedAt: number; // ms

    /**
     * ✅ Compat (legacy):
     * algunos flujos viejos guardaban el motivo en note.
     * Puede ser texto libre.
     */
    note?: string | null;

    /**
     * ✅ Nuevo (preferido):
     * motivo estructurado para rejected.
     */
    rejectedReason?: RejectedReason | null;
};

// ----------------------
// DAILY EVENTS
// ----------------------
export type DailyEventType = "visited" | "rejected" | "pending";

/**
 * Historial (auditoría).
 * ⚠️ NO usar para monetización si no filtras por status actual del client.
 */
export type DailyEventDoc = {
    id: string;

    type: DailyEventType;

    userId: string; // actor que hizo el cambio
    clientId: string;

    // snapshot opcional (debug / historial)
    phone?: string;
    name?: string;
    business?: string;
    address?: string;

    /**
     * ✅ Compat (legacy): motivo como texto libre
     */
    note?: string | null;

    /**
     * ✅ Nuevo (preferido): motivo estructurado
     * Solo debería venir cuando type === "rejected"
     */
    rejectedReason?: RejectedReason | null;

    createdAt: number; // ms
    dayKey: string; // "YYYY-MM-DD"
};

// ----------------------
// ACCOUNTING / INVESTMENTS
// ----------------------
export type WeeklyInvestmentDoc = {
    id: string; // weekStartKey (docId recomendado)
    weekStartKey: string; // "YYYY-MM-DD" (lunes)
    weekEndKey: string; // "YYYY-MM-DD" (domingo)

    /**
     * Monto invertido esa semana (R$)
     */
    amount: number;

    createdAt: number; // ms
    updatedAt: number; // ms
};