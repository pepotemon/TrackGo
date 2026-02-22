import type { ClientDoc, UserDoc } from "../../types/models";

export type UserVisitCounts = {
    visited: number;
    // Si quieres extender luego:
    rejected?: number;
    pending?: number;
};

function safeNumber(n: any, fallback = 0) {
    return typeof n === "number" && isFinite(n) ? n : fallback;
}

/**
 * ✅ Tarifa por visita:
 * - Campo oficial: ratePerVisit
 * - Compat: visitFee (legacy)
 */
export function getRatePerVisit(u: UserDoc): number {
    const anyU: any = u as any;
    return safeNumber(anyU.ratePerVisit ?? anyU.visitFee, 0);
}

/**
 * ✅ Cuenta VISITADOS por userId usando clients (estado REAL)
 * Agrupa por statusBy (quien visitó)
 *
 * Nota: este método asume que la lista `clients` ya viene filtrada por rango:
 * status=="visited" y statusAt en el rango (día/semana).
 */
export function calcVisitedByUserFromClients(clients: ClientDoc[]) {
    const out = new Map<string, UserVisitCounts>();

    for (const c of clients) {
        if (c.status !== "visited") continue;

        const uid = (c as any).statusBy as string | null | undefined;
        if (!uid) continue;

        if (!out.has(uid)) out.set(uid, { visited: 0 });
        out.get(uid)!.visited += 1;
    }

    return out;
}

/**
 * ✅ Construye filas de ganancias usando users + clients visitados en el rango
 */
export function buildEarningsRowsFromClients(users: UserDoc[], clients: ClientDoc[]) {
    const counts = calcVisitedByUserFromClients(clients);

    const rows = users
        .filter((u) => u.role === "user")
        .map((u) => {
            const c = counts.get(u.id) ?? { visited: 0 };
            const ratePerVisit = getRatePerVisit(u);
            const total = c.visited * ratePerVisit;

            return {
                userId: u.id,
                name: u.name ?? "Usuario",
                email: u.email,
                ratePerVisit,
                visited: c.visited,
                total,
            };
        });

    rows.sort((a, b) => b.total - a.total);
    const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);

    return { rows, grandTotal };
}