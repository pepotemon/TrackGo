// src/data/repositories/investmentsRepo.ts
import {
    doc,
    onSnapshot,
    runTransaction,
    type Unsubscribe,
} from "firebase/firestore";
import { db } from "../../config/firebase";

export type WeeklyInvestmentAllocations = Record<string, number>;

export type WeeklyInvestmentGroup = {
    id: string;
    name: string;
    amount: number;
    userIds: string[];
};

export type WeeklyInvestmentDoc = {
    id: string; // weekStartKey
    weekStartKey: string;
    weekEndKey: string;

    // total de presupuesto semanal
    amount: number;

    // ✅ legado: distribución individual por usuario
    allocations?: WeeklyInvestmentAllocations;

    // ✅ nuevo: grupos compartidos o individuales
    groups?: WeeklyInvestmentGroup[];

    createdAt: number | any;
    updatedAt: number | any;
};

function safeNum(n: any) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
}

function clamp2(n: number) {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function cleanAllocations(obj: any): WeeklyInvestmentAllocations {
    if (!obj || typeof obj !== "object") return {};

    const out: WeeklyInvestmentAllocations = {};
    for (const [k, v] of Object.entries(obj)) {
        const uid = String(k ?? "").trim();
        if (!uid) continue;

        const num = clamp2(safeNum(v));
        if (num > 0) out[uid] = num;
    }
    return out;
}

function uniqueStrings(arr: any[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const item of arr ?? []) {
        const v = String(item ?? "").trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }

    return out;
}

function cleanGroups(groups: any): WeeklyInvestmentGroup[] {
    if (!Array.isArray(groups)) return [];

    const out: WeeklyInvestmentGroup[] = [];

    for (let i = 0; i < groups.length; i++) {
        const raw: any = groups[i] ?? {};

        const id = String(raw.id ?? `group_${i + 1}`).trim() || `group_${i + 1}`;
        const name = String(raw.name ?? "").trim() || `Grupo ${i + 1}`;
        const amount = clamp2(safeNum(raw.amount));
        const userIds = uniqueStrings(Array.isArray(raw.userIds) ? raw.userIds : []);

        // solo guardamos grupos válidos
        if (amount <= 0) continue;
        if (userIds.length <= 0) continue;

        out.push({
            id,
            name,
            amount,
            userIds,
        });
    }

    return out;
}

export function subscribeWeeklyInvestment(
    weekStartKey: string,
    cb: (doc: WeeklyInvestmentDoc | null) => void,
    onMissing?: () => void
): Unsubscribe {
    const id = (weekStartKey ?? "").trim();
    if (!id) {
        cb(null);
        return () => { };
    }

    const ref = doc(db, "weeklyInvestments", id);

    return onSnapshot(
        ref,
        (snap) => {
            if (!snap.exists()) {
                cb(null);
                onMissing?.();
                return;
            }

            const data = snap.data() as any;

            cb({
                id: snap.id,
                ...data,
                allocations: cleanAllocations(data?.allocations),
                groups: cleanGroups(data?.groups),
            } as WeeklyInvestmentDoc);
        },
        (err) => {
            console.log("[weeklyInvestments] onSnapshot error:", err?.code, err?.message);
            cb(null);
        }
    );
}

/**
 * ✅ Compatibilidad:
 * Puedes llamar de 3 formas:
 *
 * 1) Solo total:
 * upsertWeeklyInvestment(start, end, amount)
 *
 * 2) Total + allocations:
 * upsertWeeklyInvestment(start, end, amount, allocations)
 *
 * 3) Total + allocations + groups:
 * upsertWeeklyInvestment(start, end, amount, allocations, groups)
 */
export async function upsertWeeklyInvestment(
    weekStartKey: string,
    weekEndKey: string,
    amount: number,
    allocations?: WeeklyInvestmentAllocations,
    groups?: WeeklyInvestmentGroup[]
) {
    const id = (weekStartKey ?? "").trim();
    if (!id) throw new Error("weekStartKey inválido");

    const ref = doc(db, "weeklyInvestments", id);

    const amt = clamp2(safeNum(amount));
    const cleanedAllocations = cleanAllocations(allocations);
    const cleanedGroups = cleanGroups(groups);

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now();

        const payload: any = {
            weekStartKey: id,
            weekEndKey: (weekEndKey ?? "").trim(),
            amount: amt,
            allocations: cleanedAllocations, // {} limpia
            groups: cleanedGroups, // [] limpia
            updatedAt: now,
        };

        if (!snap.exists()) {
            payload.createdAt = now;
            tx.set(ref, payload, { merge: true });
            return;
        }

        // si existe, NO tocamos createdAt
        tx.set(ref, payload, { merge: true });
    });
}