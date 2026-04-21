// src/data/repositories/earningsRepo.ts
import {
    limit,
    onSnapshot,
    orderBy,
    query,
    where,
    type Unsubscribe,
} from "firebase/firestore";
import type { DailyEventDoc, UserDoc } from "../../types/models";
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

function getUserRatePerVisit(u?: UserDoc | null): number {
    const anyU: any = u as any;
    return safeNumber(anyU?.ratePerVisit ?? anyU?.visitFee ?? anyU?.visitFeePerVisit, 0);
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

function getFrozenAmountFromEvent(
    event: DailyEventDoc,
    user?: UserDoc | null
): number {
    const anyE: any = event as any;

    const amount = safeNumber(anyE?.amount, NaN);
    if (Number.isFinite(amount)) return amount;

    const rateApplied = safeNumber(anyE?.rateApplied, NaN);
    if (Number.isFinite(rateApplied)) return rateApplied;

    return getUserRatePerVisit(user);
}

function buildSummaryFromEvents(events: DailyEventDoc[], users: UserDoc[]): EarningsSummary {
    const usersById = new Map<string, UserDoc>();
    for (const u of users) usersById.set(u.id, u);

    const latest = latestEventByClient(events);
    const visitedByUser = new Map<string, number>();
    const amountByUser = new Map<string, number>();

    for (const e of latest.values()) {
        if ((e as any)?.type !== "visited") continue;

        const uid = String((e as any)?.userId ?? "").trim();
        if (!uid) continue;

        visitedByUser.set(uid, (visitedByUser.get(uid) ?? 0) + 1);

        const amount = getFrozenAmountFromEvent(e, usersById.get(uid));
        amountByUser.set(uid, (amountByUser.get(uid) ?? 0) + amount);
    }

    const rows: EarningsRow[] = users
        .filter((u) => u.role === "user")
        .map((u) => {
            const visited = visitedByUser.get(u.id) ?? 0;
            const amount = amountByUser.get(u.id) ?? 0;
            const rate = getUserRatePerVisit(u);

            return {
                userId: u.id,
                name: u.name ?? "Usuario",
                email: u.email,
                ratePerVisit: rate, // solo informativo
                visited,
                amount,
            };
        })
        .sort((a, b) => b.amount - a.amount);

    const totalVisited = rows.reduce((a, r) => a + r.visited, 0);
    const totalAmount = rows.reduce((a, r) => a + r.amount, 0);

    return { rows, totalVisited, totalAmount };
}

/**
 * ✅ Ganancias por 1 día usando dailyEvents.
 * Cuenta solo el último evento por cliente dentro del día.
 */
export function subscribeEarningsByDay(
    dayKey: string,
    users: UserDoc[],
    cb: (summary: EarningsSummary) => void,
    onErr?: (err: any) => void
): Unsubscribe {
    const dk = dayKey.trim();

    const q = query(
        col.dailyEvents,
        where("dayKey", "==", dk),
        orderBy("createdAt", "desc"),
        limit(5000)
    );

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as DailyEventDoc[];
            cb(buildSummaryFromEvents(list, users));
        },
        (err) => {
            console.log("[subscribeEarningsByDay] error:", err?.code, err?.message);
            onErr?.(err);
        }
    );
}

/**
 * ✅ Ganancias por rango usando dailyEvents.
 * Ideal para semana o histórico.
 */
export function subscribeEarningsByRange(
    startDayKey: string,
    endDayKey: string,
    users: UserDoc[],
    cb: (summary: EarningsSummary) => void,
    onErr?: (err: any) => void
): Unsubscribe {
    const start = startDayKey.trim();
    const end = endDayKey.trim();

    const q = query(
        col.dailyEvents,
        where("dayKey", ">=", start),
        where("dayKey", "<=", end),
        orderBy("dayKey", "asc"),
        orderBy("createdAt", "asc"),
        limit(20000)
    );

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as DailyEventDoc[];
            cb(buildSummaryFromEvents(list, users));
        },
        (err) => {
            console.log("[subscribeEarningsByRange] error:", err?.code, err?.message);
            onErr?.(err);
        }
    );
}