import {
    collection,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    startAfter,
    where,
    type DocumentData,
    type QueryDocumentSnapshot,
    type Unsubscribe,
} from "firebase/firestore";
import type { IncomingLeadDoc } from "../../types/models";
import { col, db } from "../firestore";

export type ClientMessageDoc = {
    id: string;
    clientId: string;
    direction: "inbound" | "outbound";
    senderType: "client" | "bot" | "admin";
    senderId?: string | null;
    text: string;
    messageType?: string | null;
    whatsappMessageId?: string | null;
    status?: "received" | "sent" | "error" | string | null;
    createdAt: any;
    source?: string | null;
    stage?: string | null;
    profileName?: string | null;
    mapsUrl?: string | null;
    locationCaptured?: boolean | null;
    lat?: number | null;
    lng?: number | null;
};

export type SubscribeClientMessagesOptions = {
    limitCount?: number;
};

export type ClientMessagesPageCursor = QueryDocumentSnapshot<DocumentData> | null;

export type ClientMessagesPageResult = {
    items: ClientMessageDoc[];
    cursor: ClientMessagesPageCursor;
    hasMore: boolean;
};

export type GetClientMessagesPageOptions = {
    pageSize?: number;
    cursor?: ClientMessagesPageCursor;
};

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

function clampPositiveInt(value: unknown, fallback: number, max: number) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(Math.floor(n), max);
}

/**
 * Conversación legacy basada en incomingLeads.
 * La mantengo para no romper pantallas/modales viejos.
 */
export function subscribeIncomingLeadConversation(
    clientId: string,
    callback: (items: IncomingLeadDoc[]) => void
): Unsubscribe {
    const cleanClientId = String(clientId ?? "").trim();

    if (!cleanClientId) {
        callback([]);
        return () => { };
    }

    const qRef = query(
        col.incomingLeads,
        where("clientId", "==", cleanClientId),
        orderBy("createdAt", "desc"),
        limit(100)
    );

    return onSnapshot(
        qRef,
        (snap) => {
            const list = snap.docs.map((d) => {
                return {
                    id: d.id,
                    ...(d.data() as Omit<IncomingLeadDoc, "id">),
                };
            }) as IncomingLeadDoc[];

            list.sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
            callback(list);
        },
        (err) => {
            console.log(
                "[subscribeIncomingLeadConversation] onSnapshot error:",
                err?.code,
                err?.message
            );
            callback([]);
        }
    );
}

/**
 * Nueva conversación real basada en clients/{clientId}/messages.
 *
 * FIX IMPORTANTE:
 * - Antes usaba orderBy asc + limit, lo cual devolvía los MENSAJES MÁS ANTIGUOS.
 * - Ahora trae los ÚLTIMOS N mensajes con orderBy desc + limit
 *   y luego los reordena ascendente en memoria para pintar el chat correctamente.
 */
export function subscribeClientMessages(
    clientId: string,
    callback: (items: ClientMessageDoc[]) => void,
    options?: SubscribeClientMessagesOptions
): Unsubscribe {
    const cleanClientId = String(clientId ?? "").trim();

    if (!cleanClientId) {
        callback([]);
        return () => { };
    }

    const finalLimit = clampPositiveInt(options?.limitCount, 300, 500);
    const messagesCol = collection(db, "clients", cleanClientId, "messages");

    const qRef = query(
        messagesCol,
        orderBy("createdAt", "desc"),
        limit(finalLimit)
    );

    return onSnapshot(
        qRef,
        (snap) => {
            const list = snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<ClientMessageDoc, "id">),
            })) as ClientMessageDoc[];

            list.sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
            callback(list);
        },
        (err) => {
            console.log(
                "[subscribeClientMessages] onSnapshot error:",
                err?.code,
                err?.message
            );
            callback([]);
        }
    );
}

/**
 * ✅ FASE 2:
 * Página manual de mensajes para el chat.
 *
 * Devuelve:
 * - últimos mensajes primero desde Firestore
 * - luego reordenados ascendente para pintar el chat
 * - cursor para seguir cargando más antiguos
 */
export async function getClientMessagesPage(
    clientId: string,
    options?: GetClientMessagesPageOptions
): Promise<ClientMessagesPageResult> {
    const cleanClientId = String(clientId ?? "").trim();

    if (!cleanClientId) {
        return {
            items: [],
            cursor: null,
            hasMore: false,
        };
    }

    const pageSize = clampPositiveInt(options?.pageSize, 50, 150);
    const messagesCol = collection(db, "clients", cleanClientId, "messages");

    const constraints: any[] = [
        orderBy("createdAt", "desc"),
        limit(pageSize),
    ];

    if (options?.cursor) {
        constraints.splice(constraints.length - 1, 0, startAfter(options.cursor));
    }

    const qRef = query(messagesCol, ...constraints);
    const snap = await getDocs(qRef);

    const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ClientMessageDoc, "id">),
    })) as ClientMessageDoc[];

    items.sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));

    const cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    const hasMore = snap.docs.length >= pageSize;

    return {
        items,
        cursor,
        hasMore,
    };
}