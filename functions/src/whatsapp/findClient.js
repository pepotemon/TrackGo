const { db } = require("../core/firebase");

function s(v) {
    return String(v ?? "").trim();
}

function pickClientForChannel(docs, channel = {}) {
    const phoneNumberId = s(channel?.phoneNumberId);
    const marketCountry = s(channel?.marketCountry);

    if (!docs.length) return null;

    if (phoneNumberId) {
        const exactPhoneNumber = docs.find((doc) => {
            const data = doc.data() || {};
            return s(data.whatsappPhoneNumberId) === phoneNumberId;
        });

        if (exactPhoneNumber) return exactPhoneNumber;
    }

    if (marketCountry) {
        const exactMarket = docs.find((doc) => {
            const data = doc.data() || {};
            return s(data.marketCountry) === marketCountry;
        });

        if (exactMarket) return exactMarket;

        // Legacy Brazil leads were created before market fields existed.
        if (marketCountry === "BR") {
            const legacyBrazil = docs.find((doc) => {
                const data = doc.data() || {};
                return !s(data.marketCountry) && !s(data.whatsappPhoneNumberId);
            });

            if (legacyBrazil) return legacyBrazil;
        }

        return null;
    }

    return docs[0];
}

function toFound(doc) {
    if (!doc) return null;

    return {
        id: doc.id,
        ref: doc.ref,
        data: doc.data() || {},
    };
}

async function findClientByPhone(phone, channel) {
    const snap = await db
        .collection("clients")
        .where("phone", "==", phone)
        .limit(20)
        .get();

    if (snap.empty) return null;

    return toFound(pickClientForChannel(snap.docs, channel));
}

async function findClientByWaId(waId, channel) {
    if (!waId) return null;

    const snap = await db
        .collection("clients")
        .where("waId", "==", waId)
        .limit(20)
        .get();

    if (snap.empty) return null;

    return toFound(pickClientForChannel(snap.docs, channel));
}

module.exports = {
    findClientByPhone,
    findClientByWaId,
};
