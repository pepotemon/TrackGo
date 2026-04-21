// src/data/repositories/earnings.ts
import type { DailyEventDoc, UserDoc } from "../../types/models";

export type UserVisitCounts = {
    visited: number;
    amount: number;
};

function safeNumber(n: any, fallback = 0) {
    return typeof n === "number" && isFinite(n) ? n : fallback;
}

/**
 * ✅ Tarifa actual del usuario
 * Solo se usa como fallback para eventos viejos que todavía no tengan snapshot.
 */
export function getRatePerVisit(u?: UserDoc | null): number {
    const anyU: any = u as any;
    return safeNumber(anyU?.ratePerVisit ?? anyU?.visitFee, 0);
}

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v?.toMillis === "function") return v.toMillis();
    if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function latestEventByClient(events: DailyEventDoc[]) {
    const map = new Map<string, DailyEventDoc>();

    for (const e of events) {
        const cid = (e as any)?.clientId;
        if (!cid) continue;

        const prev = map.get(cid);
        const eMs = toMs((e as any)?.createdAt);
        const pMs = prev ? toMs((prev as any)?.createdAt) : 0;

        if (!prev || eMs >= pMs) map.set(cid, e);
    }

    return map;
}

/**
 * ✅ Monto congelado del evento.
 * Orden de prioridad:
 * 1. amount (snapshot exacto)
 * 2. rateApplied (snapshot de tarifa)
 * 3. tarifa actual del usuario (solo fallback legacy)
 */
export function getFrozenAmountFromEvent(
    event: DailyEventDoc,
    user?: UserDoc | null
): number {
    const anyE: any = event as any;

    const amount = safeNumber(anyE?.amount, NaN);
    if (Number.isFinite(amount)) return amount;

    const rateApplied = safeNumber(anyE?.rateApplied, NaN);
    if (Number.isFinite(rateApplied)) return rateApplied;

    return getRatePerVisit(user);
}

/**
 * ✅ Cuenta visitados y monto por usuario usando dailyEvents.
 * Toma solo el último evento por cliente dentro del rango.
 */
export function calcVisitedByUserFromEvents(
    events: DailyEventDoc[],
    usersById: Map<string, UserDoc>
) {
    const out = new Map<string, UserVisitCounts>();
    const latest = latestEventByClient(events);

    for (const e of latest.values()) {
        if ((e as any)?.type !== "visited") continue;

        const uid = String((e as any)?.userId ?? "").trim();
        if (!uid) continue;

        const prev = out.get(uid) ?? { visited: 0, amount: 0 };
        const amount = getFrozenAmountFromEvent(e, usersById.get(uid));

        out.set(uid, {
            visited: prev.visited + 1,
            amount: prev.amount + amount,
        });
    }

    return out;
}

/**
 * ✅ Construye filas de ganancias usando users + dailyEvents del rango
 */
export function buildEarningsRowsFromEvents(users: UserDoc[], events: DailyEventDoc[]) {
    const usersById = new Map<string, UserDoc>();
    for (const u of users) usersById.set(u.id, u);

    const counts = calcVisitedByUserFromEvents(events, usersById);

    const rows = users
        .filter((u) => u.role === "user")
        .map((u) => {
            const c = counts.get(u.id) ?? { visited: 0, amount: 0 };
            const currentRate = getRatePerVisit(u);

            return {
                userId: u.id,
                name: u.name ?? "Usuario",
                email: u.email,
                ratePerVisit: currentRate, // solo informativo
                visited: c.visited,
                total: c.amount,
            };
        });

    rows.sort((a, b) => b.total - a.total);
    const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);

    return { rows, grandTotal };
}