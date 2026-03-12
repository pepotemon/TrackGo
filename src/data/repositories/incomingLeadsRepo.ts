import {
    limit,
    onSnapshot,
    orderBy,
    query,
    where,
    type Unsubscribe,
} from "firebase/firestore";
import type { IncomingLeadDoc } from "../../types/models";
import { col } from "../firestore";

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