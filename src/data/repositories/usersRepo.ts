import {
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import type { UserDoc, UserRole } from "../../types/models";
import { col, docRef } from "../firestore";

export async function upsertUserDoc(user: UserDoc) {
    const now = Date.now();
    await setDoc(
        docRef.user(user.id),
        {
            ...user,
            updatedAt: now,
        },
        { merge: true }
    );
}

export async function getUserDoc(userId: string): Promise<UserDoc | null> {
    const snap = await getDoc(docRef.user(userId));
    if (!snap.exists()) return null;

    return { id: snap.id, ...(snap.data() as any) } as UserDoc;
}

export async function listUsers(role?: UserRole): Promise<UserDoc[]> {
    const q = role
        ? query(
            col.users,
            where("role", "==", role),
            orderBy("createdAt", "desc"),
            limit(200)
        )
        : query(col.users, orderBy("createdAt", "desc"), limit(200));

    const snaps = await getDocs(q);

    return snaps.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as UserDoc);
}

/**
 * ✅ Actualizar tarifa por visita (solo admin en rules)
 * Campo oficial: ratePerVisit
 */
export async function updateUserRatePerVisit(userId: string, ratePerVisit: number) {
    const rate = Number.isFinite(ratePerVisit) ? ratePerVisit : 0;

    await updateDoc(docRef.user(userId), {
        ratePerVisit: rate,
        updatedAt: Date.now(),
    });
}