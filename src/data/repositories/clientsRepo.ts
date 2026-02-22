import {
    addDoc,
    deleteDoc,
    doc,
    limit,
    onSnapshot,
    orderBy,
    query,
    updateDoc,
    where,
    writeBatch,
    type Unsubscribe,
} from "firebase/firestore";
import { db } from "../../config/firebase";
import type { ClientDoc, ClientStatus } from "../../types/models";
import { col, docRef } from "../firestore";
import { dayKeyFromMs } from "./dailyEventsRepo";

/**
 * Ojo: este helper NO elimina null (solo undefined).
 * Eso es bueno aquí porque queremos mandar null para limpiar.
 */
function stripUndefined<T extends Record<string, any>>(obj: T): T {
    const out: any = {};
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v !== undefined) out[k] = v;
    }
    return out;
}

export async function createClient(input: Omit<ClientDoc, "id">) {
    await addDoc(col.clients, input);
}

/**
 * ✅ Actualiza status del client + registra evento diario (SIN INFLAR)
 *
 * FIXES:
 * 1) Si status === "pending": limpia statusBy/statusAt (null) para que pending sea real
 * 2) dailyEvents idempotente por día y cliente: eventId = dayKey_clientId
 *    (evita duplicar si cambia actor o si togglea varias veces)
 *
 * Nota: si tu regla de negocio quiere conservar quién hizo el cambio aunque sea pending,
 * lo guardamos en el dailyEvent.userId (actor), pero NO en el client (porque pending no debe contar).
 */
export async function updateClientStatus(
    clientId: string,
    status: ClientStatus,
    actorId: string,
    snapshot?: { phone?: string; name?: string; business?: string }
) {
    const now = Date.now();
    const dayKey = dayKeyFromMs(now);

    const batch = writeBatch(db);

    // 1) update client (estado actual)
    const clientPatch =
        status === "pending"
            ? {
                status: "pending" as const,
                statusBy: null, // ✅ limpiar
                statusAt: null, // ✅ limpiar
                updatedAt: now,
            }
            : {
                status,
                statusBy: actorId,
                statusAt: now,
                updatedAt: now,
            };

    batch.update(docRef.client(clientId), stripUndefined(clientPatch as any));

    // 2) daily event (idempotente por día+cliente)
    // ✅ 1 evento por cliente por día (se actualiza con merge si cambia tipo)
    const eventId = `${dayKey}_${clientId}`;

    const event = stripUndefined({
        type: status, // "pending" | "visited" | "rejected"
        userId: actorId,
        clientId,
        phone: snapshot?.phone,
        name: snapshot?.name,
        business: snapshot?.business,
        createdAt: now, // si vuelve a tocar, se actualiza
        dayKey,
    });

    batch.set(doc(col.dailyEvents, eventId), event, { merge: true });

    await batch.commit();
}

/**
 * ✅ Asignación: guarda assignedAt/assignedDayKey y REINICIA estado del cliente.
 *
 * REGLA DE NEGOCIO:
 * - Al reasignar, el cliente vuelve a "pending"
 * - Limpia statusBy/statusAt para que no herede "rejected/visited" del usuario anterior
 * - updatedAt se actualiza para que suba en el listado
 *
 * (Opcional) Si quieres también “marcar” que fue reiniciado, lo ideal sería un campo extra
 * tipo resetAt/resetBy, pero aquí lo dejamos simple.
 */
export async function assignClient(clientId: string, userId: string) {
    const now = Date.now();

    await updateDoc(
        docRef.client(clientId),
        stripUndefined({
            assignedTo: userId,
            assignedAt: now,
            assignedDayKey: dayKeyFromMs(now),

            // ✅ RESET de estado al reasignar
            status: "pending",
            statusBy: null,
            statusAt: null,

            updatedAt: now,
        } as any)
    );
}

/**
 * Admin realtime subscription
 */
export function subscribeAdminClients(
    callback: (clients: ClientDoc[]) => void
): Unsubscribe {
    const q = query(col.clients, orderBy("updatedAt", "desc"), limit(200));

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ClientDoc[];
            callback(list);
        },
        (err) => {
            console.log("[subscribeAdminClients] onSnapshot error:", err?.code, err?.message);
            callback([]);
        }
    );
}

// ✅ Actualiza campos editables por admin
export async function updateClientFields(
    clientId: string,
    patch: {
        name?: string;
        business?: string;
        phone: string;
        mapsUrl: string;
        address?: string;
        // (si algún día quieres permitir editar assignedTo aquí, lo agregamos, pero ahora no)
    }
) {
    await updateDoc(
        docRef.client(clientId),
        stripUndefined({
            ...patch,
            updatedAt: Date.now(),
        })
    );
}

// ✅ Elimina cliente
export async function deleteClient(clientId: string) {
    await deleteDoc(docRef.client(clientId));
}

/**
 * User realtime subscription
 */
export function subscribeUserClients(
    userId: string,
    callback: (clients: ClientDoc[]) => void
): Unsubscribe {
    const q = query(
        col.clients,
        where("assignedTo", "==", userId),
        orderBy("updatedAt", "desc"),
        limit(200)
    );

    return onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ClientDoc[];
            callback(list);
        },
        (err) => {
            console.log("[subscribeUserClients] onSnapshot error:", err?.code, err?.message);
            callback([]);
        }
    );
}