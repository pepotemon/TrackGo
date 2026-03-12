const { db } = require("../core/firebase");

async function findClientByPhone(phone) {
    const snap = await db
        .collection("clients")
        .where("phone", "==", phone)
        .limit(1)
        .get();

    if (snap.empty) return null;

    const doc = snap.docs[0];
    return {
        id: doc.id,
        ref: doc.ref,
        data: doc.data() || {},
    };
}

async function findClientByWaId(waId) {
    if (!waId) return null;

    const snap = await db
        .collection("clients")
        .where("waId", "==", waId)
        .limit(1)
        .get();

    if (snap.empty) return null;

    const doc = snap.docs[0];
    return {
        id: doc.id,
        ref: doc.ref,
        data: doc.data() || {},
    };
}

module.exports = {
    findClientByPhone,
    findClientByWaId,
};