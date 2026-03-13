import { collection, doc } from "firebase/firestore";
import { db } from "../config/firebase";

export { db };

export const col = {
    users: collection(db, "users"),
    clients: collection(db, "clients"),
    dailyEvents: collection(db, "dailyEvents"),
    incomingLeads: collection(db, "incomingLeads"),
    weeklyInvestments: collection(db, "weeklyInvestments"),
};

export const docRef = {
    user: (id: string) => doc(db, "users", id),
    client: (id: string) => doc(db, "clients", id),
    dailyEvent: (id: string) => doc(db, "dailyEvents", id),
    incomingLead: (id: string) => doc(db, "incomingLeads", id),
    weeklyInvestment: (id: string) => doc(db, "weeklyInvestments", id),

    /**
     * ✅ Nuevo: mensajes del chat por cliente
     */
    clientMessage: (clientId: string, messageId: string) =>
        doc(db, "clients", clientId, "messages", messageId),
};

export const subcol = {
    /**
     * ✅ Nuevo: subcolección de mensajes por cliente
     */
    clientMessages: (clientId: string) =>
        collection(db, "clients", clientId, "messages"),
};