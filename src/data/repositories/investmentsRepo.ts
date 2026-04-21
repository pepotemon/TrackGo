// src/data/repositories/investmentsRepo.ts
import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    type Unsubscribe
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

export type WeeklyInvestmentGroupTemplate = {
    id: string;
    name: string;
    defaultAmount: number;
    userIds: string[];
    createdAt: number | any;
    updatedAt: number | any;
    lastUsedAt?: number | any;
    lastUsedWeekStartKey?: string;
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

function cleanTemplate(raw: any, fallbackId: string): WeeklyInvestmentGroupTemplate | null {
    const id = String(raw?.id ?? fallbackId ?? "").trim() || fallbackId;
    const name = String(raw?.name ?? "").trim() || "Grupo";
    const defaultAmount = clamp2(safeNum(raw?.defaultAmount));
    const userIds = uniqueStrings(Array.isArray(raw?.userIds) ? raw.userIds : []);

    if (!id) return null;
    if (!userIds.length) return null;

    return {
        id,
        name,
        defaultAmount,
        userIds,
        createdAt: raw?.createdAt ?? 0,
        updatedAt: raw?.updatedAt ?? 0,
        lastUsedAt: raw?.lastUsedAt ?? 0,
        lastUsedWeekStartKey: String(raw?.lastUsedWeekStartKey ?? "").trim(),
    };
}

function buildTemplateId(group: Pick<WeeklyInvestmentGroup, "name" | "userIds">) {
    const safeName = String(group.name ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^\w\-]/g, "");

    const members = uniqueStrings(group.userIds).sort().join("__");
    return `${safeName || "grupo"}__${members || "sin_usuarios"}`;
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

/**
 * =========================
 * BIBLIOTECA DE GRUPOS
 * =========================
 */

export function subscribeWeeklyInvestmentGroupTemplates(
    cb: (items: WeeklyInvestmentGroupTemplate[]) => void
): Unsubscribe {
    const q = query(
        collection(db, "weeklyInvestmentGroupTemplates"),
        orderBy("updatedAt", "desc")
    );

    return onSnapshot(
        q,
        (snap) => {
            const out: WeeklyInvestmentGroupTemplate[] = [];

            for (const d of snap.docs) {
                const parsed = cleanTemplate(
                    {
                        id: d.id,
                        ...(d.data() as any),
                    },
                    d.id
                );

                if (parsed) out.push(parsed);
            }

            cb(out);
        },
        (err) => {
            console.log(
                "[weeklyInvestmentGroupTemplates] onSnapshot error:",
                err?.code,
                err?.message
            );
            cb([]);
        }
    );
}

export async function upsertWeeklyInvestmentGroupTemplate(
    input: {
        id?: string;
        name: string;
        defaultAmount: number;
        userIds: string[];
        lastUsedWeekStartKey?: string;
    }
) {
    const name = String(input?.name ?? "").trim() || "Grupo";
    const defaultAmount = clamp2(safeNum(input?.defaultAmount));
    const userIds = uniqueStrings(Array.isArray(input?.userIds) ? input.userIds : []);

    if (!userIds.length) {
        throw new Error("El grupo debe tener al menos un usuario.");
    }

    const id =
        String(input?.id ?? "").trim() ||
        buildTemplateId({
            name,
            userIds,
        });

    const ref = doc(db, "weeklyInvestmentGroupTemplates", id);
    const now = Date.now();

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);

        const payload: any = {
            id,
            name,
            defaultAmount,
            userIds,
            updatedAt: now,
            lastUsedAt: now,
            lastUsedWeekStartKey: String(input?.lastUsedWeekStartKey ?? "").trim(),
        };

        if (!snap.exists()) {
            payload.createdAt = now;
        }

        tx.set(ref, payload, { merge: true });
    });
}

export async function syncWeeklyGroupsToTemplates(
    groups?: WeeklyInvestmentGroup[],
    weekStartKey?: string
) {
    const cleanedGroups = cleanGroups(groups);
    if (!cleanedGroups.length) return;

    for (const group of cleanedGroups) {
        await upsertWeeklyInvestmentGroupTemplate({
            name: group.name,
            defaultAmount: group.amount,
            userIds: group.userIds,
            lastUsedWeekStartKey: (weekStartKey ?? "").trim(),
        });
    }
}

export async function deleteWeeklyInvestmentGroupTemplate(templateId: string) {
    const id = String(templateId ?? "").trim();
    if (!id) throw new Error("templateId inválido");

    await deleteDoc(doc(db, "weeklyInvestmentGroupTemplates", id));
}

/**
 * Opcional por si más adelante quieres cargar manualmente
 * la biblioteca una sola vez sin suscripción.
 */
export async function listWeeklyInvestmentGroupTemplates() {
    const q = query(
        collection(db, "weeklyInvestmentGroupTemplates"),
        orderBy("updatedAt", "desc")
    );

    const snap = await getDocs(q);
    const out: WeeklyInvestmentGroupTemplate[] = [];

    for (const d of snap.docs) {
        const parsed = cleanTemplate(
            {
                id: d.id,
                ...(d.data() as any),
            },
            d.id
        );

        if (parsed) out.push(parsed);
    }

    return out;
}