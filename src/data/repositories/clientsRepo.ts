// src/data/repositories/clientsRepo.ts
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

/**
 * ✅ Motivos ampliados de rechazo
 */
export type RejectReason =
    | "clavo"
    | "localizacion"
    | "zona_riesgosa"
    | "ingresos_insuficientes"
    | "muy_endeudado"
    | "informacion_dudosa"
    | "no_le_interesa"
    | "no_estaba_cerrado"
    | "fuera_de_ruta"
    | "otro";

function normalizeRejectReason(value?: string | null): RejectReason | null {
    if (!value) return null;

    const v = String(value).toLowerCase().trim();

    if (v === "clavo") return "clavo";

    if (
        v === "localizacion" ||
        v === "localización" ||
        v === "localizacao" ||
        v === "localização"
    ) {
        return "localizacion";
    }

    if (v === "zona_riesgosa" || v === "zona riesgosa" || v === "zona peligrosa") {
        return "zona_riesgosa";
    }

    if (
        v === "ingresos_insuficientes" ||
        v === "ingresos insuficientes" ||
        v === "sin ingresos suficientes"
    ) {
        return "ingresos_insuficientes";
    }

    if (
        v === "muy_endeudado" ||
        v === "muy endeudado" ||
        v === "endeudado"
    ) {
        return "muy_endeudado";
    }

    if (
        v === "informacion_dudosa" ||
        v === "información dudosa" ||
        v === "datos dudosos"
    ) {
        return "informacion_dudosa";
    }

    if (
        v === "no_le_interesa" ||
        v === "no le interesa" ||
        v === "no interesado"
    ) {
        return "no_le_interesa";
    }

    if (
        v === "no_estaba_cerrado" ||
        v === "no estaba / cerrado" ||
        v === "no estaba" ||
        v === "cerrado"
    ) {
        return "no_estaba_cerrado";
    }

    if (
        v === "fuera_de_ruta" ||
        v === "fuera de ruta"
    ) {
        return "fuera_de_ruta";
    }

    if (v === "otro" || v === "outro") return "otro";

    return "otro";
}

export async function createClient(input: Omit<ClientDoc, "id">) {
    await addDoc(col.clients, input);
}

/**
 * ✅ Actualiza status del client + registra evento diario (SIN INFLAR)
 *
 * FIXES:
 * 1) Si status === "pending": limpia statusBy/statusAt y también limpia rejectedReason/note.
 * 2) dailyEvents idempotente por día y cliente: eventId = dayKey_clientId
 *    (evita duplicar si cambia actor o si togglea varias veces)
 *
 * EXTRA:
 * - Soporta motivos ampliados de rechazo
 * - Guarda el motivo en:
 *   - client.rejectedReason
 *   - dailyEvent.rejectedReason
 *
 * ✅ Compat: para arreglar tu error TS "Expected 3-4 arguments, but got 5"
 * aceptamos un 5to argumento opcional (string u objeto).
 */
export async function updateClientStatus(
    clientId: string,
    status: ClientStatus,
    actorId: string,
    snapshot?: { phone?: string; name?: string; business?: string; address?: string },
    extra?:
        | string
        | {
            rejectedReason?: RejectReason | string;
            note?: string;
        }
) {
    const now = Date.now();
    const dayKey = dayKeyFromMs(now);

    const normalizedRejectedReason =
        status === "rejected"
            ? normalizeRejectReason(
                typeof extra === "string" ? extra : extra?.rejectedReason
            ) ?? "otro"
            : null;

    const note =
        status === "rejected"
            ? typeof extra === "string"
                ? null
                : extra?.note ?? null
            : null;

    const batch = writeBatch(db);

    // 1) update client (estado actual)
    const clientPatch: any =
        status === "pending"
            ? {
                status: "pending" as const,
                statusBy: null,
                statusAt: null,
                rejectedReason: null,
                note: null,
                updatedAt: now,
            }
            : status === "visited"
                ? {
                    status: "visited" as const,
                    statusBy: actorId,
                    statusAt: now,
                    rejectedReason: null,
                    note: null,
                    updatedAt: now,
                }
                : {
                    status: "rejected" as const,
                    statusBy: actorId,
                    statusAt: now,
                    rejectedReason: normalizedRejectedReason,
                    note,
                    updatedAt: now,
                };

    batch.update(docRef.client(clientId), stripUndefined(clientPatch));

    // 2) daily event (idempotente por día+cliente)
    const eventId = `${dayKey}_${clientId}`;

    const event: any = stripUndefined({
        type: status,
        userId: actorId,
        clientId,

        // snapshot opcional
        phone: snapshot?.phone,
        name: snapshot?.name,
        business: snapshot?.business,
        address: snapshot?.address,

        // motivo / nota solo si rejected
        rejectedReason: status === "rejected" ? normalizedRejectedReason : null,
        note: status === "rejected" ? note : null,

        createdAt: now,
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
 * - Limpia rejectedReason/note
 * - updatedAt se actualiza para que suba en el listado
 */
export async function assignClient(clientId: string, userId: string) {
    const now = Date.now();

    await updateDoc(
        docRef.client(clientId),
        stripUndefined({
            assignedTo: userId,
            assignedAt: now,
            assignedDayKey: dayKeyFromMs(now),

            status: "pending",
            statusBy: null,
            statusAt: null,
            rejectedReason: null,
            note: null,

            updatedAt: now,
        } as any)
    );
}

/**
 * Admin realtime subscription
 */
export function subscribeAdminClients(callback: (clients: ClientDoc[]) => void): Unsubscribe {
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
export function subscribeUserClients(userId: string, callback: (clients: ClientDoc[]) => void): Unsubscribe {
    const q = query(col.clients, where("assignedTo", "==", userId), orderBy("updatedAt", "desc"), limit(200));

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