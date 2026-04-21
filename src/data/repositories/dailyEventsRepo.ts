import {
    addDoc,
    limit,
    onSnapshot,
    orderBy,
    query,
    where,
    type Unsubscribe,
} from "firebase/firestore";
import type { DailyEventDoc } from "../../types/models";
import { col } from "../firestore";

/**
 * Convierte timestamp (ms) a YYYY-MM-DD
 * Importante: usar siempre el mismo formato para rangos.
 */
export function dayKeyFromMs(ms: number): string {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/**
 * Crear evento manual (normalmente no lo usas porque
 * updateClientStatus ya lo hace con batch).
 *
 * ✅ Ahora soporta snapshot contable opcional:
 * - rateApplied
 * - amount
 */
export async function createDailyEvent(input: Omit<DailyEventDoc, "id">) {
    await addDoc(col.dailyEvents, input);
}

/**
 * Suscripción en tiempo real por un solo día + por usuario (recomendado).
 *
 * ✅ Evita permission-denied porque el query ya filtra por userId.
 *
 * ⚠ Requiere índice compuesto:
 * dayKey ASC + userId ASC + createdAt DESC
 */
export function subscribeDailyEventsByDay(
    dayKey: string,
    userId: string,
    cb: (events: DailyEventDoc[]) => void,
    onErr?: (err: any) => void
): Unsubscribe {
    const cleanKey = dayKey.trim();
    const uid = userId.trim();

    if (!cleanKey || !uid) {
        cb([]);
        return () => { };
    }

    const q = query(
        col.dailyEvents,
        where("dayKey", "==", cleanKey),
        where("userId", "==", uid),
        orderBy("createdAt", "desc"),
        limit(500)
    );

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map(
                (d) => ({ id: d.id, ...(d.data() as any) }) as DailyEventDoc
            );
            cb(list);
        },
        (err) => {
            console.log("[dailyEventsByDay] onSnapshot error:", err?.code, err?.message);
            onErr?.(err);
        }
    );
}

/**
 * Suscripción por rango de fechas (YYYY-MM-DD → YYYY-MM-DD)
 *
 * ⚠ Requiere índice compuesto:
 * dayKey ASC + createdAt ASC
 *
 * Nota: Este rango lo usa ADMIN normalmente.
 * Si un USER lo usa, necesitarías agregar filtro por userId también.
 */
export function subscribeDailyEventsByRange(
    startDayKey: string,
    endDayKey: string,
    cb: (events: DailyEventDoc[]) => void,
    onErr?: (err: any) => void
): Unsubscribe {
    const start = startDayKey.trim();
    const end = endDayKey.trim();

    if (!start || !end) {
        console.log("[dailyEventsByRange] rango inválido");
        cb([]);
        return () => { };
    }

    const q = query(
        col.dailyEvents,
        where("dayKey", ">=", start),
        where("dayKey", "<=", end),
        orderBy("dayKey", "asc"),
        orderBy("createdAt", "asc"),
        limit(2000)
    );

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map(
                (d) => ({ id: d.id, ...(d.data() as any) }) as DailyEventDoc
            );
            cb(list);
        },
        (err) => {
            console.log("[dailyEventsByRange] onSnapshot error:", err?.code, err?.message);
            onErr?.(err);
        }
    );
}

/**
 * ✅ Suscripción por rango PERO filtrando por usuario (para pantalla USER).
 *
 * ⚠ Requiere índice compuesto:
 * userId ASC + dayKey ASC + createdAt ASC
 */
export function subscribeDailyEventsByRangeForUser(
    startDayKey: string,
    endDayKey: string,
    userId: string,
    cb: (events: DailyEventDoc[]) => void,
    onErr?: (err: any) => void
): Unsubscribe {
    const start = startDayKey.trim();
    const end = endDayKey.trim();
    const uid = userId.trim();

    if (!start || !end || !uid) {
        console.log("[dailyEventsByRangeForUser] rango inválido");
        cb([]);
        return () => { };
    }

    const q = query(
        col.dailyEvents,
        where("userId", "==", uid),
        where("dayKey", ">=", start),
        where("dayKey", "<=", end),
        orderBy("dayKey", "asc"),
        orderBy("createdAt", "asc"),
        limit(2000)
    );

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map(
                (d) => ({ id: d.id, ...(d.data() as any) }) as DailyEventDoc
            );
            cb(list);
        },
        (err) => {
            console.log(
                "[dailyEventsByRangeForUser] onSnapshot error:",
                err?.code,
                err?.message
            );
            onErr?.(err);
        }
    );
}