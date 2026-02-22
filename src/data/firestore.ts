import { collection, doc } from "firebase/firestore";
import { db } from "../config/firebase";

export const col = {
    users: collection(db, "users"),
    clients: collection(db, "clients"),
    dailyEvents: collection(db, "dailyEvents"),
};

export const docRef = {
    user: (id: string) => doc(db, "users", id),
    client: (id: string) => doc(db, "clients", id),
};
