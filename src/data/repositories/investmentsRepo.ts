// src/data/repositories/investmentsRepo.ts
import {
    doc,
    onSnapshot,
    type Unsubscribe
} from "firebase/firestore";
import { db } from "../../config/firebase";

export type WeeklyInvestmentAllocations = Record<string, number>;

export type WeeklyInvestmentDoc = {
    id: string; // weekStartKey
    weekStartKey: string;
    weekEndKey: string;

    // total de presupuesto semanal
    amount: number;

    // ✅ nuevo: distribución por usuario
    allocations?: WeeklyInvestmentAllocations;

    createdAt: number | any; // puede venir Timestamp si usas serverTimestamp
    updatedAt: number | any;
};

function safeNum(n: any) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
}

function cleanAllocations(obj: any): WeeklyInvestmentAllocations {
    if (!obj || typeof obj !== "object") return {};

    const out: WeeklyInvestmentAllocations = {};
    for (const [k, v] of Object.entries(obj)) {
        const uid = String(k ?? "").trim();
        if (!uid) continue;

        const num = safeNum(v);
        if (num > 0) out[uid] = num;
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
            cb({ id: snap.id, ...(snap.data() as any) } as WeeklyInvestmentDoc);
        },
        (err) => {
            console.log("[weeklyInvestments] onSnapshot error:", err?.code, err?.message);
            cb(null);
        }
    );
}

export async function upsertWeeklyInvestment(
    weekStartKey: string,
    weekEndKey: string,
    amount: number,
    allocations?: WeeklyInvestmentAllocations
) {
    const id = (weekStartKey ?? "").trim();
    if (!id) throw new Error("weekStartKey inválido");

    const ref = doc(db, "weeklyInvestments", id);

    // Normaliza
    const amt = safeNum(amount);
    const cleaned = cleanAllocations(allocations);

    // ✅ Importante:
    // - updatedAt siempre se actualiza
    // - createdAt NO se pisa: usamos createdAt: serverTimestamp() sólo si no existía (ver nota abajo)
    //
    // Firestore no tiene "set if missing" directo en setDoc merge,
    // así que la forma simple/segura es:
    // 1) escribir createdAt con serverTimestamp SIEMPRE y
    // 2) en reglas / o en UI aceptar que createdAt puede ser Timestamp del último write.
    //
    // Pero tú quieres que createdAt quede fijo: solución sin leer:
    // - Usar un campo createdAtMs y createdAtSet=true, y solo setearlo si NO existe
    // => eso requiere transaction o read.
    //
    // ✅ Mejor solución práctica sin complicarte: usar Date.now() y merge,
    // y SOLO setear createdAt si lo estás creando por primera vez.
    // Para eso, hacemos 1 lectura rápida con getDoc o una transaction.
    //
    // Como quieres "que funcione todo", aquí lo dejamos SIN lectura:
    // createdAt se setea una vez con merge, y ya NO se toca desde tu UI si lo respetas.
    //
    // En la práctica: con merge true, si ya existía createdAt como número, lo sobrescribe.
    // Para evitarlo 100%, necesitas transaction. Te lo dejo ya hecho:
    //
    // ✅ USAMOS TRANSACTION SIMPLE con getDoc:
    //
    // (si no quieres transaction, dímelo y lo simplifico)

    const { getDoc, runTransaction } = await import("firebase/firestore");

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);

        const now = Date.now();

        const payload: any = {
            weekStartKey: id,
            weekEndKey: (weekEndKey ?? "").trim(),
            amount: amt,
            allocations: cleaned, // {} limpia
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