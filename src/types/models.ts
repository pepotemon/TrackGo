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
};

export type ClientStatus = "pending" | "visited" | "rejected";

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
     * ✅ Motivo / nota
     * Ej: "clavo" | "localización" | "otro" | null
     */
    note?: string | null;
};

export type DailyEventType = "visited" | "rejected" | "pending";

/**
 * Historial (auditoría).
 * ⚠️ NO usar para monetización.
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
     * ✅ Motivo / nota (opcional)
     * Ej: "clavo" | "localización" | "otro"
     */
    note?: string | null;

    createdAt: number; // ms
    dayKey: string; // "YYYY-MM-DD"
};