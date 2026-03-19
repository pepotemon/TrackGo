import {
    addDoc,
    deleteDoc,
    doc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    startAfter,
    updateDoc,
    where,
    writeBatch,
    type DocumentData,
    type QueryDocumentSnapshot,
    type Unsubscribe,
} from "firebase/firestore";
import { db } from "../../config/firebase";
import type {
    ClientAutoFlag,
    ClientBusinessQuality,
    ClientDoc,
    ClientLeadHistoryBucket,
    ClientLeadQuality,
    ClientParseStatus,
    ClientProfileType,
    ClientStatus,
    ClientVerificationStatus,
    RejectedReason,
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

function normalizeNullableString(value?: string | null) {
    if (value == null) return null;
    const v = String(value).trim();
    return v || null;
}

function normalizeNullableNumber(value?: number | null) {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeNullableBoolean(value?: boolean | null) {
    if (value == null) return null;
    return typeof value === "boolean" ? value : null;
}

function normalizeRejectReason(value?: string | null): RejectedReason | null {
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
        "normalized_business_label",
        "multi_signal_business",
        "mixed_business_signals",
        "fallback_business_detected",
    ];

    const list = value
        .map((x) => String(x ?? "").trim())
        .filter((x): x is ClientAutoFlag => allowed.includes(x as ClientAutoFlag));

    return Array.from(new Set(list));
}

function clampPositiveInt(value: unknown, fallback: number, max: number) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(Math.floor(n), max);
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

export const LEAD_HISTORY_STALE_DAYS = 30;
export const LEAD_HISTORY_STALE_MS = LEAD_HISTORY_STALE_DAYS * 24 * 60 * 60 * 1000;

export type SubscribeAdminClientsOptions = {
    limitCount?: number;
    onlyMetaUnassigned?: boolean;
    verificationStatuses?: ClientVerificationStatus[];
};

export type SubscribeAdminLeadQueueOptions = {
    limitCount?: number;
    verificationStatuses?: Array<"pending_review" | "incomplete" | "not_suitable">;
};

export type SubscribeAdminLeadHistoryOptions = {
    limitCount?: number;
    verificationStatuses?: Array<"incomplete" | "not_suitable">;
};

export type AdminLeadsPageCursor = QueryDocumentSnapshot<DocumentData> | null;

export type AdminLeadsPageResult = {
    items: ClientDoc[];
    cursor: AdminLeadsPageCursor;
    hasMore: boolean;
};

export type GetAdminLeadHistoryPageOptions = {
    pageSize?: number;
    cursor?: AdminLeadsPageCursor;
    verificationStatuses?: Array<"incomplete" | "not_suitable">;
};

export type GetAdminLeadQueuePageOptions = {
    pageSize?: number;
    cursor?: AdminLeadsPageCursor;
    verificationStatuses?: Array<"pending_review" | "incomplete" | "not_suitable">;
};

/**
 * Helper para dejar listas pequeñas y válidas para Firestore "in".
 */
function normalizeVerificationStatusListForIn(
    value?: string[] | null
): ClientVerificationStatus[] {
    if (!Array.isArray(value)) return [];

    const normalized = value
        .map((x) => normalizeVerificationStatus(x))
        .filter((x): x is ClientVerificationStatus => !!x);

    return Array.from(new Set(normalized)).slice(0, 10);
}

/**
 * ✅ Actividad relevante para decidir si un lead sigue en cola o ya va a historial.
 *
 * Reglas:
 * - pending_review: no se usa para archivar, siempre queda en principal.
 * - incomplete: sí se reactiva con nuevo inbound, por eso priorizamos lastInboundMessageAt.
 * - not_suitable: NO se reactiva automáticamente por inbound; priorizamos el momento del estado.
 */
export function getClientRelevantLeadActivityAt(client: ClientDoc): number {
    const verificationStatus = normalizeVerificationStatus(
        (client as any)?.verificationStatus
    ) ?? "incomplete";

    if (verificationStatus === "not_suitable") {
        return (
            toMs((client as any)?.verificationStatusChangedAt) ||
            toMs(client.updatedAt) ||
            toMs(client.createdAt)
        );
    }

    return (
        toMs((client as any)?.lastInboundMessageAt) ||
        toMs((client as any)?.verificationStatusChangedAt) ||
        toMs(client.updatedAt) ||
        toMs(client.createdAt)
    );
}

export function getClientLeadHistoryBucket(
    client: ClientDoc,
    now = Date.now()
): ClientLeadHistoryBucket | null {
    const status = normalizeVerificationStatus((client as any)?.verificationStatus);

    if (status !== "incomplete" && status !== "not_suitable") return null;

    const relevantAt = getClientRelevantLeadActivityAt(client);
    if (!relevantAt) return null;

    const isStale = now - relevantAt >= LEAD_HISTORY_STALE_MS;
    if (!isStale) return null;

    return status as ClientLeadHistoryBucket;
}

export function isClientInLeadHistory(client: ClientDoc, now = Date.now()) {
    return getClientLeadHistoryBucket(client, now) != null;
}

export function isClientInActiveLeadQueue(client: ClientDoc, now = Date.now()) {
    const status = normalizeVerificationStatus((client as any)?.verificationStatus);

    if (status === "pending_review") return true;
    if (status !== "incomplete" && status !== "not_suitable") return false;

    return !isClientInLeadHistory(client, now);
}

export function buildLeadHistoryStatePatch(
    client: ClientDoc,
    now = Date.now()
): Partial<ClientDoc> {
    const bucket = getClientLeadHistoryBucket(client, now);

    if (!bucket) {
        return {
            ...({
                leadHistoryArchivedAt: null,
                leadHistoryBucket: null,
            } as any),
        };
    }

    return {
        ...({
            leadHistoryArchivedAt: toMs((client as any)?.leadHistoryArchivedAt) || now,
            leadHistoryBucket: bucket,
        } as any),
    };
}

export async function createClient(input: Omit<ClientDoc, "id">) {
    const now = Date.now();

    const normalizedVerification =
        normalizeVerificationStatus((input as any)?.verificationStatus) ?? "incomplete";

    await addDoc(
        col.clients,
        stripUndefined({
            ...input,
            phone: normalizeClientPhone(input.phone),
            waId: (input as any).waId
                ? normalizeClientPhone((input as any).waId)
                : (input as any).waId,
            lat: normalizeCoord((input as any).lat),
            lng: normalizeCoord((input as any).lng),

            source: (input as any).source ?? "manual",
            parseStatus: normalizeParseStatus((input as any).parseStatus) ?? "empty",
            verificationStatus: normalizedVerification,
            verificationStatusChangedAt:
                (input as any).verificationStatusChangedAt ?? now,

            leadQuality: normalizeLeadQuality((input as any).leadQuality) ?? "unknown",
            profileType: normalizeProfileType((input as any).profileType) ?? "business",
            businessQuality: normalizeBusinessQuality((input as any).businessQuality) ?? "unknown",

            businessFlags: normalizeAutoFlags((input as any).businessFlags) ?? [],
            profileFlags: normalizeAutoFlags((input as any).profileFlags) ?? [],

            leadHistoryArchivedAt: (input as any).leadHistoryArchivedAt ?? null,
            leadHistoryBucket: (input as any).leadHistoryBucket ?? null,

            geoCityLabel: normalizeNullableString((input as any).geoCityLabel),
            geoCityNormalized: normalizeNullableString((input as any).geoCityNormalized),
            geoCluster: normalizeNullableString((input as any).geoCluster),
            geoSource: normalizeNullableString((input as any).geoSource),
            geoResolvedAt: normalizeNullableNumber((input as any).geoResolvedAt),
            geoDistanceToHubKm: normalizeNullableNumber((input as any).geoDistanceToHubKm),
            geoOutOfCoverage: normalizeNullableBoolean((input as any).geoOutOfCoverage),
            geoConfidence: normalizeNullableString((input as any).geoConfidence),
            geoNearestHubKey: normalizeNullableString((input as any).geoNearestHubKey),
            geoNearestHubLabel: normalizeNullableString((input as any).geoNearestHubLabel),

            geoAdminCityLabel: normalizeNullableString((input as any).geoAdminCityLabel),
            geoAdminCityNormalized: normalizeNullableString((input as any).geoAdminCityNormalized),
            geoAdminStateLabel: normalizeNullableString((input as any).geoAdminStateLabel),
            geoAdminStateNormalized: normalizeNullableString((input as any).geoAdminStateNormalized),
            geoAdminCountryLabel: normalizeNullableString((input as any).geoAdminCountryLabel),
            geoAdminCountryNormalized: normalizeNullableString((input as any).geoAdminCountryNormalized),
            geoAdminSource: normalizeNullableString((input as any).geoAdminSource),
            geoAdminResolvedAt: normalizeNullableNumber((input as any).geoAdminResolvedAt),
            geoAdminDisplayLabel: normalizeNullableString((input as any).geoAdminDisplayLabel),

            createdAt: (input as any).createdAt ?? now,
            updatedAt: (input as any).updatedAt ?? now,
        } as any)
    );
}

/**
 * ✅ Actualiza status del client + registra evento diario (SIN INFLAR)
 */
export async function updateClientStatus(
    clientId: string,
    status: ClientStatus,
    actorId: string,
    snapshot?: { phone?: string; name?: string; business?: string; address?: string },
    extra?:
        | string
        | {
            rejectedReason?: RejectedReason | string;
            rejectedReasonText?: string | null;
            note?: string | null;
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

    const rejectedReasonText =
        status === "rejected"
            ? typeof extra === "string"
                ? null
                : (extra?.rejectedReasonText ?? "").trim() || null
            : null;

    const note =
        status === "rejected"
            ? typeof extra === "string"
                ? null
                : (extra?.note ?? "").trim() || null
            : null;

    const batch = writeBatch(db);

    const clientPatch: Partial<ClientDoc> =
        status === "pending"
            ? {
                status: "pending",
                statusBy: null,
                statusAt: null,
                rejectedReason: null,
                rejectedReasonText: null,
                note: null,
                updatedAt: now,
            }
            : status === "visited"
                ? {
                    status: "visited",
                    statusBy: actorId,
                    statusAt: now,
                    rejectedReason: null,
                    rejectedReasonText: null,
                    note: null,
                    updatedAt: now,
                }
                : {
                    status: "rejected",
                    statusBy: actorId,
                    statusAt: now,
                    rejectedReason: normalizedRejectedReason,
                    rejectedReasonText:
                        normalizedRejectedReason === "otro" ? rejectedReasonText : null,
                    note,
                    updatedAt: now,
                };

    batch.update(docRef.client(clientId), stripUndefined(clientPatch as any));

    const eventId = `${dayKey}_${clientId}`;

    const event = stripUndefined({
        type: status,
        userId: actorId,
        clientId,

        phone: snapshot?.phone,
        name: snapshot?.name,
        business: snapshot?.business,
        address: snapshot?.address,

        rejectedReason: status === "rejected" ? normalizedRejectedReason : null,
        rejectedReasonText:
            status === "rejected" && normalizedRejectedReason === "otro"
                ? rejectedReasonText
                : null,
        note: status === "rejected" ? note : null,

        createdAt: now,
        dayKey,
    });

    batch.set(doc(col.dailyEvents, eventId), event, { merge: true });

    await batch.commit();
}

/**
 * ✅ Asignación: guarda assignedAt/assignedDayKey y REINICIA estado del cliente.
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
            rejectedReasonText: null,
            note: null,

            leadHistoryArchivedAt: null,
            leadHistoryBucket: null,

            updatedAt: now,
        } as any)
    );
}

/**
 * Compat general para pantallas admin existentes.
 *
 * - Si no mandas options: se comporta prácticamente como antes
 * - Si mandas onlyMetaUnassigned / verificationStatuses: filtra ya desde Firestore
 *
 * OJO:
 * Firestore requerirá índice compuesto si combinas varios where + orderBy.
 */
export function subscribeAdminClients(
    callback: (clients: ClientDoc[]) => void,
    options?: SubscribeAdminClientsOptions
): Unsubscribe {
    const finalLimit = clampPositiveInt(options?.limitCount, 400, 1000);
    const onlyMetaUnassigned = options?.onlyMetaUnassigned === true;
    const verificationStatuses = normalizeVerificationStatusListForIn(
        options?.verificationStatuses
    );

    let qRef;

    if (onlyMetaUnassigned && verificationStatuses.length > 0) {
        qRef = query(
            col.clients,
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            where("verificationStatus", "in", verificationStatuses),
            orderBy("updatedAt", "desc"),
            limit(finalLimit)
        );
    } else if (onlyMetaUnassigned) {
        qRef = query(
            col.clients,
            where("source", "==", "whatsapp_meta"),
            where("assignedTo", "==", ""),
            orderBy("updatedAt", "desc"),
            limit(finalLimit)
        );
    } else if (verificationStatuses.length > 0) {
        qRef = query(
            col.clients,
            where("verificationStatus", "in", verificationStatuses),
            orderBy("updatedAt", "desc"),
            limit(finalLimit)
        );
    } else {
        qRef = query(col.clients, orderBy("updatedAt", "desc"), limit(finalLimit));
    }

    return onSnapshot(
        qRef,
        (snap) => {
            const list = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as any),
            })) as ClientDoc[];

            callback(list);
        },
        (err) => {
            console.log("[subscribeAdminClients] onSnapshot error:", err?.code, err?.message);
            callback([]);
        }
    );
}

/**
 * ✅ Cola activa optimizada para Leads Meta.
 *
 * Trae:
 * - whatsapp_meta
 * - no asignados
 * - estados operativos
 *
 * La separación "activo vs historial" por tiempo se hace con helpers dinámicos
 * para no depender todavía de cron/jobs.
 */
export function subscribeAdminLeadQueue(
    callback: (clients: ClientDoc[]) => void,
    options?: SubscribeAdminLeadQueueOptions
): Unsubscribe {
    const finalLimit = clampPositiveInt(options?.limitCount, 250, 1000);

    const statuses = normalizeVerificationStatusListForIn(
        options?.verificationStatuses ?? ["pending_review", "incomplete", "not_suitable"]
    );

    const qRef = query(
        col.clients,
        where("source", "==", "whatsapp_meta"),
        where("assignedTo", "==", ""),
        where("verificationStatus", "in", statuses),
        orderBy("updatedAt", "desc"),
        limit(finalLimit)
    );

    return onSnapshot(
        qRef,
        (snap) => {
            const list = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as any),
            })) as ClientDoc[];

            callback(list);
        },
        (err) => {
            console.log("[subscribeAdminLeadQueue] onSnapshot error:", err?.code, err?.message);
            callback([]);
        }
    );
}

/**
 * ✅ Historial optimizado de Leads Meta.
 *
 * Trae:
 * - whatsapp_meta
 * - no asignados
 * - solo incomplete / not_suitable
 *
 * Luego la pantalla filtra dinámicamente los que YA califican como historial.
 */
export function subscribeAdminLeadHistory(
    callback: (clients: ClientDoc[]) => void,
    options?: SubscribeAdminLeadHistoryOptions
): Unsubscribe {
    const finalLimit = clampPositiveInt(options?.limitCount, 400, 1500);

    const statuses = normalizeVerificationStatusListForIn(
        options?.verificationStatuses ?? ["incomplete", "not_suitable"]
    );

    const qRef = query(
        col.clients,
        where("source", "==", "whatsapp_meta"),
        where("assignedTo", "==", ""),
        where("verificationStatus", "in", statuses),
        orderBy("updatedAt", "desc"),
        limit(finalLimit)
    );

    return onSnapshot(
        qRef,
        (snap) => {
            const list = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as any),
            })) as ClientDoc[];

            callback(list);
        },
        (err) => {
            console.log("[subscribeAdminLeadHistory] onSnapshot error:", err?.code, err?.message);
            callback([]);
        }
    );
}

/**
 * ✅ FASE 2:
 * Página manual para la cola activa.
 */
export async function getAdminLeadQueuePage(
    options?: GetAdminLeadQueuePageOptions
): Promise<AdminLeadsPageResult> {
    const pageSize = clampPositiveInt(options?.pageSize, 50, 200);
    const statuses = normalizeVerificationStatusListForIn(
        options?.verificationStatuses ?? ["pending_review", "incomplete", "not_suitable"]
    );

    const constraints: any[] = [
        where("source", "==", "whatsapp_meta"),
        where("assignedTo", "==", ""),
        where("verificationStatus", "in", statuses),
        orderBy("updatedAt", "desc"),
        limit(pageSize),
    ];

    if (options?.cursor) {
        constraints.splice(constraints.length - 1, 0, startAfter(options.cursor));
    }

    const qRef = query(col.clients, ...constraints);
    const snap = await getDocs(qRef);

    const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
    })) as ClientDoc[];

    const cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    const hasMore = snap.docs.length >= pageSize;

    return {
        items,
        cursor,
        hasMore,
    };
}

/**
 * ✅ FASE 2:
 * Página manual para historial.
 */
export async function getAdminLeadHistoryPage(
    options?: GetAdminLeadHistoryPageOptions
): Promise<AdminLeadsPageResult> {
    const pageSize = clampPositiveInt(options?.pageSize, 50, 200);
    const statuses = normalizeVerificationStatusListForIn(
        options?.verificationStatuses ?? ["incomplete", "not_suitable"]
    );

    const constraints: any[] = [
        where("source", "==", "whatsapp_meta"),
        where("assignedTo", "==", ""),
        where("verificationStatus", "in", statuses),
        orderBy("updatedAt", "desc"),
        limit(pageSize),
    ];

    if (options?.cursor) {
        constraints.splice(constraints.length - 1, 0, startAfter(options.cursor));
    }

    const qRef = query(col.clients, ...constraints);
    const snap = await getDocs(qRef);

    const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
    })) as ClientDoc[];

    const cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    const hasMore = snap.docs.length >= pageSize;

    return {
        items,
        cursor,
        hasMore,
    };
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
        verificationStatusChangedAt: number | null;
        leadQuality: ClientLeadQuality;
        profileType: ClientProfileType;
        notSuitableReason: string | null;
        businessQuality: ClientBusinessQuality;
        businessFlags: ClientAutoFlag[];
        profileFlags: ClientAutoFlag[];
        currentLeadMapsConfirmedAt: number | null;
        verifiedAt: number | null;
        verifiedBy: string | null;
        manualReviewNote: string | null;
        assignedTo: string;
        assignedAt: number;
        assignedDayKey: string;
        updatedAt: number;
        source: ClientDoc["source"];
        sourceRef: string | null;
        autoCapturedAt: number | null;
        initialIntroSentAt: number | null;
        lastInboundMessageAt: number | null;
        lastOutboundAt: number | null;
        lastInboundText: string | null;
        lastInboundIntent: string | null;
        lastMessageId: string | null;
        lastBotReplyAt: number | null;
        lastBotReplyText: string | null;
        lastBotStage: string | null;
        rejectedReason: RejectedReason | null;
        rejectedReasonText: string | null;
        note: string | null;
        adminQueueLastSeenMessageAt: number | null;
        adminQueueSeenAt: number | null;
        leadHistoryArchivedAt: number | null;
        leadHistoryBucket: ClientLeadHistoryBucket | null;

        geoCityLabel: string | null;
        geoCityNormalized: string | null;
        geoCluster: string | null;
        geoSource: string | null;
        geoResolvedAt: number | null;
        geoDistanceToHubKm: number | null;
        geoOutOfCoverage: boolean | null;
        geoConfidence: string | null;
        geoNearestHubKey: string | null;
        geoNearestHubLabel: string | null;

        geoAdminCityLabel: string | null;
        geoAdminCityNormalized: string | null;
        geoAdminStateLabel: string | null;
        geoAdminStateNormalized: string | null;
        geoAdminCountryLabel: string | null;
        geoAdminCountryNormalized: string | null;
        geoAdminSource: string | null;
        geoAdminResolvedAt: number | null;
        geoAdminDisplayLabel: string | null;
    }>
) {
    const now = Date.now();

    const data: any = {
        ...patch,
        updatedAt: patch.updatedAt ?? now,
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

        if (!("verificationStatusChangedAt" in patch)) {
            data.verificationStatusChangedAt = now;
        }

        /**
         * Si el status cambia manualmente, sale de historial lógico.
         * Luego la regla temporal decidirá si vuelve a caer ahí.
         */
        data.leadHistoryArchivedAt = null;
        data.leadHistoryBucket = null;
    }

    if ("verificationStatusChangedAt" in patch) {
        data.verificationStatusChangedAt =
            patch.verificationStatusChangedAt == null
                ? null
                : Number(patch.verificationStatusChangedAt) || null;
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

    if ("rejectedReason" in patch) {
        data.rejectedReason =
            patch.rejectedReason == null
                ? null
                : normalizeRejectReason(patch.rejectedReason) ?? "otro";
    }

    if ("rejectedReasonText" in patch) {
        data.rejectedReasonText = (patch.rejectedReasonText ?? "").trim() || null;
    }

    if ("note" in patch) {
        data.note = (patch.note ?? "").trim() || null;
    }

    if ("notSuitableReason" in patch) {
        data.notSuitableReason = (patch.notSuitableReason ?? "").trim() || null;
    }

    if ("leadHistoryArchivedAt" in patch) {
        data.leadHistoryArchivedAt =
            patch.leadHistoryArchivedAt == null
                ? null
                : Number(patch.leadHistoryArchivedAt) || null;
    }

    if ("leadHistoryBucket" in patch) {
        data.leadHistoryBucket = patch.leadHistoryBucket ?? null;
    }

    if ("geoCityLabel" in patch) {
        data.geoCityLabel = normalizeNullableString(patch.geoCityLabel);
    }

    if ("geoCityNormalized" in patch) {
        data.geoCityNormalized = normalizeNullableString(patch.geoCityNormalized);
    }

    if ("geoCluster" in patch) {
        data.geoCluster = normalizeNullableString(patch.geoCluster);
    }

    if ("geoSource" in patch) {
        data.geoSource = normalizeNullableString(patch.geoSource);
    }

    if ("geoResolvedAt" in patch) {
        data.geoResolvedAt = normalizeNullableNumber(patch.geoResolvedAt);
    }

    if ("geoDistanceToHubKm" in patch) {
        data.geoDistanceToHubKm = normalizeNullableNumber(patch.geoDistanceToHubKm);
    }

    if ("geoOutOfCoverage" in patch) {
        data.geoOutOfCoverage = normalizeNullableBoolean(patch.geoOutOfCoverage);
    }

    if ("geoConfidence" in patch) {
        data.geoConfidence = normalizeNullableString(patch.geoConfidence);
    }

    if ("geoNearestHubKey" in patch) {
        data.geoNearestHubKey = normalizeNullableString(patch.geoNearestHubKey);
    }

    if ("geoNearestHubLabel" in patch) {
        data.geoNearestHubLabel = normalizeNullableString(patch.geoNearestHubLabel);
    }

    if ("geoAdminCityLabel" in patch) {
        data.geoAdminCityLabel = normalizeNullableString(patch.geoAdminCityLabel);
    }

    if ("geoAdminCityNormalized" in patch) {
        data.geoAdminCityNormalized = normalizeNullableString(patch.geoAdminCityNormalized);
    }

    if ("geoAdminStateLabel" in patch) {
        data.geoAdminStateLabel = normalizeNullableString(patch.geoAdminStateLabel);
    }

    if ("geoAdminStateNormalized" in patch) {
        data.geoAdminStateNormalized = normalizeNullableString(patch.geoAdminStateNormalized);
    }

    if ("geoAdminCountryLabel" in patch) {
        data.geoAdminCountryLabel = normalizeNullableString(patch.geoAdminCountryLabel);
    }

    if ("geoAdminCountryNormalized" in patch) {
        data.geoAdminCountryNormalized = normalizeNullableString(
            patch.geoAdminCountryNormalized
        );
    }

    if ("geoAdminSource" in patch) {
        data.geoAdminSource = normalizeNullableString(patch.geoAdminSource);
    }

    if ("geoAdminResolvedAt" in patch) {
        data.geoAdminResolvedAt = normalizeNullableNumber(patch.geoAdminResolvedAt);
    }

    if ("geoAdminDisplayLabel" in patch) {
        data.geoAdminDisplayLabel = normalizeNullableString(patch.geoAdminDisplayLabel);
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
    const qRef = query(
        col.clients,
        where("assignedTo", "==", userId),
        orderBy("updatedAt", "desc"),
        limit(200)
    );

    return onSnapshot(
        qRef,
        (snap) => {
            const list = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as any),
            })) as ClientDoc[];

            callback(list);
        },
        (err) => {
            console.log("[subscribeUserClients] onSnapshot error:", err?.code, err?.message);
            callback([]);
        }
    );
}