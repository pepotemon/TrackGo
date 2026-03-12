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
import type {
    ClientAutoFlag,
    ClientBusinessQuality,
    ClientDoc,
    ClientLeadQuality,
    ClientParseStatus,
    ClientProfileType,
    ClientStatus,
    ClientVerificationStatus,
} from "../../types/models";
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

function normalizeClientPhone(raw?: string | null) {
    return String(raw ?? "").replace(/\D+/g, "");
}

function normalizeCoord(value?: number | null) {
    if (value === null) return null;
    if (value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
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

    if (v === "fuera_de_ruta" || v === "fuera de ruta") {
        return "fuera_de_ruta";
    }

    if (v === "otro" || v === "outro") return "otro";

    return "otro";
}

function normalizeLeadQuality(value?: string | null): ClientLeadQuality | undefined {
    if (!value) return undefined;
    const v = String(value).trim().toLowerCase();

    if (v === "valid") return "valid";
    if (v === "review") return "review";
    if (v === "not_suitable") return "not_suitable";
    if (v === "unknown") return "unknown";

    return undefined;
}

function normalizeProfileType(value?: string | null): ClientProfileType | undefined {
    if (!value) return undefined;
    const v = String(value).trim().toLowerCase();

    if (v === "business") return "business";
    if (v === "app_driver") return "app_driver";
    if (v === "retired") return "retired";
    if (v === "salary_worker") return "salary_worker";
    if (v === "mixed_restricted") return "mixed_restricted";

    return undefined;
}

function normalizeVerificationStatus(
    value?: string | null
): ClientVerificationStatus | undefined {
    if (!value) return undefined;
    const v = String(value).trim().toLowerCase();

    if (v === "verified") return "verified";
    if (v === "pending_review") return "pending_review";
    if (v === "incomplete") return "incomplete";
    if (v === "not_suitable") return "not_suitable";

    return undefined;
}

function normalizeParseStatus(value?: string | null): ClientParseStatus | undefined {
    if (!value) return undefined;
    const v = String(value).trim().toLowerCase();

    if (v === "ready") return "ready";
    if (v === "partial") return "partial";
    if (v === "empty") return "empty";

    return undefined;
}

function normalizeBusinessQuality(value?: string | null): ClientBusinessQuality | undefined {
    if (!value) return undefined;
    const v = String(value).trim().toLowerCase();

    if (v === "unknown") return "unknown";
    if (v === "clear") return "clear";
    if (v === "mixed") return "mixed";
    if (v === "review") return "review";

    return undefined;
}

function normalizeAutoFlags(value: unknown): ClientAutoFlag[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const allowed: ClientAutoFlag[] = [
        "retirement_profile",
        "salary_profile",
        "app_driver_profile",
    ];

    const list = value
        .map((x) => String(x ?? "").trim())
        .filter((x): x is ClientAutoFlag => allowed.includes(x as ClientAutoFlag));

    return Array.from(new Set(list));
}

export async function createClient(input: Omit<ClientDoc, "id">) {
    const now = Date.now();

    await addDoc(
        col.clients,
        stripUndefined({
            ...input,
            phone: normalizeClientPhone(input.phone),
            waId: input.waId ? normalizeClientPhone(input.waId) : input.waId,
            lat: normalizeCoord(input.lat),
            lng: normalizeCoord(input.lng),

            source: input.source ?? "manual",
            parseStatus: normalizeParseStatus(input.parseStatus) ?? "empty",
            verificationStatus:
                normalizeVerificationStatus(input.verificationStatus) ?? "incomplete",
            leadQuality: normalizeLeadQuality(input.leadQuality) ?? "unknown",
            profileType: normalizeProfileType(input.profileType) ?? "business",
            businessQuality: normalizeBusinessQuality(input.businessQuality) ?? "unknown",

            businessFlags: normalizeAutoFlags(input.businessFlags) ?? [],
            profileFlags: normalizeAutoFlags(input.profileFlags) ?? [],

            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        } as any)
    );
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

    const eventId = `${dayKey}_${clientId}`;

    const event: any = stripUndefined({
        type: status,
        userId: actorId,
        clientId,

        phone: snapshot?.phone,
        name: snapshot?.name,
        business: snapshot?.business,
        address: snapshot?.address,

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
            assignedAt: userId ? now : 0,
            assignedDayKey: userId ? dayKeyFromMs(now) : "",

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
    const q = query(col.clients, orderBy("updatedAt", "desc"), limit(400));

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
    patch: Partial<{
        name: string;
        business: string;
        businessRaw: string;
        phone: string;
        mapsUrl: string;
        address: string;
        lat: number | null;
        lng: number | null;
        waId: string;
        parseStatus: ClientParseStatus;
        verificationStatus: ClientVerificationStatus;
        leadQuality: ClientLeadQuality;
        profileType: ClientProfileType;
        notSuitableReason: string | null;
        businessQuality: ClientBusinessQuality;
        businessFlags: ClientAutoFlag[];
        profileFlags: ClientAutoFlag[];
        currentLeadMapsConfirmedAt: number | null;
        verifiedAt: number | null;
        assignedTo: string;
        assignedAt: number;
        assignedDayKey: string;
        updatedAt: number;
        source: ClientDoc["source"];
        sourceRef: string | null;
        autoCapturedAt: number | null;
        initialIntroSentAt: number | null;
        lastInboundMessageAt: number | null;
        lastInboundText: string | null;
        lastInboundIntent: string | null;
        lastMessageId: string | null;
        lastBotReplyAt: number | null;
        lastBotReplyText: string | null;
        lastBotStage: string | null;
    }>
) {
    const data: any = {
        ...patch,
        updatedAt: patch.updatedAt ?? Date.now(),
    };

    if (patch.phone !== undefined) {
        data.phone = normalizeClientPhone(patch.phone);
    }

    if (patch.waId !== undefined) {
        data.waId = normalizeClientPhone(patch.waId);
    }

    if ("lat" in patch) {
        data.lat = normalizeCoord(patch.lat);
    }

    if ("lng" in patch) {
        data.lng = normalizeCoord(patch.lng);
    }

    if ("leadQuality" in patch) {
        data.leadQuality = normalizeLeadQuality(patch.leadQuality) ?? patch.leadQuality;
    }

    if ("profileType" in patch) {
        data.profileType = normalizeProfileType(patch.profileType) ?? patch.profileType;
    }

    if ("verificationStatus" in patch) {
        data.verificationStatus =
            normalizeVerificationStatus(patch.verificationStatus) ?? patch.verificationStatus;
    }

    if ("parseStatus" in patch) {
        data.parseStatus = normalizeParseStatus(patch.parseStatus) ?? patch.parseStatus;
    }

    if ("businessQuality" in patch) {
        data.businessQuality =
            normalizeBusinessQuality(patch.businessQuality) ?? patch.businessQuality;
    }

    if ("businessFlags" in patch) {
        data.businessFlags = normalizeAutoFlags(patch.businessFlags) ?? [];
    }

    if ("profileFlags" in patch) {
        data.profileFlags = normalizeAutoFlags(patch.profileFlags) ?? [];
    }

    await updateDoc(docRef.client(clientId), stripUndefined(data));
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