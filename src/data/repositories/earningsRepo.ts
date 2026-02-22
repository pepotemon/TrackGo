import {
    limit,
    onSnapshot,
    orderBy,
    query,
    where,
    type Unsubscribe,
} from "firebase/firestore";
import type { ClientDoc, UserDoc } from "../../types/models";
import { col } from "../firestore";

export type EarningsRow = {
    userId: string;
    name: string;
    email?: string;
    ratePerVisit: number;
    visited: number;
    amount: number;
};

export type EarningsSummary = {
    rows: EarningsRow[];
    totalVisited: number;
    totalAmount: number;
};

function safeNumber(n: any, fallback = 0) {
    return typeof n === "number" && isFinite(n) ? n : fallback;
}

/**
 * Convierte "YYYY-MM-DD" a ms (medianoche local).
 */
function dayKeyToStartMs(dayKey: string): number {
    const [y, m, d] = dayKey.trim().split("-").map((x) => parseInt(x, 10));
    if (!y || !m || !d) return 0;
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); // local
}

/**
 * Rango [start, end) en ms para un dayKey.
 */
function dayKeyToRangeMs(dayKey: string): { startMs: number; endMs: number } {
    const startMs = dayKeyToStartMs(dayKey);
    const endMs = startMs + 24 * 60 * 60 * 1000;
    return { startMs, endMs };
}

/**
 * Rango [start, end) para weekKey por dayKeys (inclusive ambos dayKeys).
 * Ej: startDayKey=Lunes, endDayKey=Domingo -> end = lunes siguiente 00:00
 */
function rangeDayKeysToRangeMs(startDayKey: string, endDayKey: string): { startMs: number; endMs: number } {
    const startMs = dayKeyToStartMs(startDayKey);
    const endStart = dayKeyToStartMs(endDayKey);
    const endMs = endStart + 24 * 60 * 60 * 1000; // exclusivo
    return { startMs, endMs };
}

/**
 * Soporta ambos nombres de campo:
 * - ratePerVisit (tu modelo)
 * - visitFee (tu código anterior)
 */
function getUserRatePerVisit(u: UserDoc): number {
    const anyU: any = u as any;
    return safeNumber(anyU.ratePerVisit ?? anyU.visitFee ?? anyU.visitFeePerVisit, 0);
}

function buildSummaryFromClients(clients: ClientDoc[], users: UserDoc[]): EarningsSummary {
    const visitedByUser = new Map<string, number>();

    for (const c of clients) {
        if (c.status !== "visited") continue;
        const uid = (c as any).statusBy as string | undefined;
        if (!uid) continue;
        visitedByUser.set(uid, (visitedByUser.get(uid) ?? 0) + 1);
    }

    const rows: EarningsRow[] = users
        .filter((u) => u.role === "user")
        .map((u) => {
            const visited = visitedByUser.get(u.id) ?? 0;
            const rate = getUserRatePerVisit(u);
            return {
                userId: u.id,
                name: u.name ?? "Usuario",
                email: u.email,
                ratePerVisit: rate,
                visited,
                amount: visited * rate,
            };
        })
        .sort((a, b) => b.amount - a.amount);

    const totalVisited = rows.reduce((a, r) => a + r.visited, 0);
    const totalAmount = rows.reduce((a, r) => a + r.amount, 0);

    return { rows, totalVisited, totalAmount };
}

/**
 * ✅ Ganancias por 1 día (dayKey) usando clients.status + statusAt
 *
 * Query:
 * - status == "visited"
 * - statusAt >= startOfDay
 * - statusAt < endOfDay
 *
 * Nota: Firestore probablemente te pedirá un índice compuesto (status + statusAt).
 */
export function subscribeEarningsByDay(
    dayKey: string,
    users: UserDoc[],
    cb: (summary: EarningsSummary) => void,
    onErr?: (err: any) => void
): Unsubscribe {
    const dk = dayKey.trim();
    const { startMs, endMs } = dayKeyToRangeMs(dk);

    const q = query(
        col.clients,
        where("status", "==", "visited"),
        where("statusAt", ">=", startMs),
        where("statusAt", "<", endMs),
        orderBy("statusAt", "desc"),
        limit(10000)
    );

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ClientDoc[];
            cb(buildSummaryFromClients(list, users));
        },
        (err) => {
            console.log("[subscribeEarningsByDay] error:", err?.code, err?.message);
            onErr?.(err);
        }
    );
}

/**
 * ✅ Ganancias por rango de dayKeys (startDayKey..endDayKey) usando clients.status + statusAt
 *
 * Ideal para cierre semanal (Lun..Dom).
 */
export function subscribeEarningsByRange(
    startDayKey: string,
    endDayKey: string,
    users: UserDoc[],
    cb: (summary: EarningsSummary) => void,
    onErr?: (err: any) => void
): Unsubscribe {
    const { startMs, endMs } = rangeDayKeysToRangeMs(startDayKey.trim(), endDayKey.trim());

    const q = query(
        col.clients,
        where("status", "==", "visited"),
        where("statusAt", ">=", startMs),
        where("statusAt", "<", endMs),
        orderBy("statusAt", "asc"),
        limit(20000)
    );

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ClientDoc[];
            cb(buildSummaryFromClients(list, users));
        },
        (err) => {
            console.log("[subscribeEarningsByRange] error:", err?.code, err?.message);
            onErr?.(err);
        }
    );
}