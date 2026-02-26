// src/data/repositories/investmentsRepo.ts
import {
    doc,
    onSnapshot,
    setDoc,
    type Unsubscribe,
} from "firebase/firestore";
import { db } from "../../config/firebase";

export type WeeklyInvestmentDoc = {
    id: string; // weekStartKey
    weekStartKey: string;
    weekEndKey: string;
    amount: number;
    createdAt: number;
    updatedAt: number;
};

function colRef() {
    // colección simple
    return (path: string) => doc(db, path);
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
    amount: number
) {
    const id = weekStartKey.trim();
    const now = Date.now();

    const ref = doc(db, "weeklyInvestments", id);

    const payload = {
        weekStartKey: id,
        weekEndKey: (weekEndKey ?? "").trim(),
        amount: Number.isFinite(amount) ? amount : 0,
        updatedAt: now,
        createdAt: now, // con merge no lo pisa si ya existe (ver abajo)
    };

    // merge true para no sobre-escribir createdAt si ya existía
    await setDoc(
        ref,
        payload,
        { merge: true }
    );
}