import {
    collection,
    limit,
    onSnapshot,
    orderBy,
    query,
    where,
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

    const q = query(
        col.incomingLeads,
        where("clientId", "==", cleanClientId),
        orderBy("createdAt", "desc"),
        limit(100)
    );

    return onSnapshot(
        q,
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
 * Esta es la que deberías usar en la futura pantalla de chat.
 */
export function subscribeClientMessages(
    clientId: string,
    callback: (items: ClientMessageDoc[]) => void
): Unsubscribe {
    const cleanClientId = String(clientId ?? "").trim();

    if (!cleanClientId) {
        callback([]);
        return () => { };
    }

    const messagesCol = collection(db, "clients", cleanClientId, "messages");

    const q = query(
        messagesCol,
        orderBy("createdAt", "asc"),
        limit(300)
    );

    return onSnapshot(
        q,
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