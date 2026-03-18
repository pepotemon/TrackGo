const { db } = require("../core/firebase");
const { sendWhatsAppText } = require("./sender");
const {
    safeString,
    safeNumber,
    stripUndefined,
} = require("../utils/text");

async function appendClientMessage({
    clientId,
    direction,
    senderType,
    senderId,
    text,
    messageType = "text",
    whatsappMessageId = "",
    status = "sent",
    meta = {},
}) {
    const cleanClientId = safeString(clientId);
    const cleanDirection = safeString(direction);
    const cleanSenderType = safeString(senderType);
    const cleanSenderId = safeString(senderId);
    const cleanText = safeString(text);
    const cleanMessageType = safeString(messageType) || "text";
    const cleanWhatsappMessageId = safeString(whatsappMessageId);

    if (!cleanClientId || !cleanDirection || !cleanSenderType || !cleanText) {
        return null;
    }

    const now = Date.now();
    const ref = db.collection("clients").doc(cleanClientId).collection("messages").doc();

    const payload = stripUndefined({
        id: ref.id,
        clientId: cleanClientId,
        direction: cleanDirection,
        senderType: cleanSenderType,
        senderId: cleanSenderId || "",
        text: cleanText,
        messageType: cleanMessageType,
        whatsappMessageId: cleanWhatsappMessageId,
        status: safeString(status || "sent"),
        createdAt: now,
        ...((meta && typeof meta === "object") ? meta : {}),
    });

    await ref.set(payload, { merge: true });
    return { id: ref.id, ref, data: payload };
}

function isBotAllowedForClient(client) {
    const chatMode = safeString(client?.chatMode || "bot");
    const assignedTo = safeString(client?.assignedTo || "");

    if (chatMode === "human") return false;

    // si luego quieres que asignar a alguien pause automáticamente el bot:
    // if (assignedTo) return false;

    return true;
}

function shouldClearLeadHistoryOnManualActivity(client) {
    const verificationStatus = safeString(client?.verificationStatus || "");

    /**
     * Si es no apto, no lo reactivamos automáticamente por actividad manual.
     * Si no lo es, sí limpiamos historial persistido.
     */
    return verificationStatus !== "not_suitable";
}

async function sendManualWhatsAppMessage({
    clientId,
    adminUserId,
    body,
    markHumanTakeover = true,
}) {
    const cleanClientId = safeString(clientId);
    const cleanAdminUserId = safeString(adminUserId);
    const cleanBody = safeString(body);

    if (!cleanClientId) {
        throw new Error("missing_client_id");
    }

    if (!cleanAdminUserId) {
        throw new Error("missing_admin_user_id");
    }

    if (!cleanBody) {
        throw new Error("missing_body");
    }

    const clientRef = db.doc(`clients/${cleanClientId}`);
    const snap = await clientRef.get();

    if (!snap.exists) {
        throw new Error("client_not_found");
    }

    const client = snap.data() || {};
    const waId = safeString(client?.waId || client?.phone || "");

    if (!waId) {
        throw new Error("client_missing_waid");
    }

    const sendResult = await sendWhatsAppText(waId, cleanBody);
    const now = Date.now();
    const whatsappMessageId = safeString(sendResult?.messages?.[0]?.id || "");

    await appendClientMessage({
        clientId: cleanClientId,
        direction: "outbound",
        senderType: "admin",
        senderId: cleanAdminUserId,
        text: cleanBody,
        messageType: "text",
        whatsappMessageId,
        status: "sent",
        meta: {
            source: "admin_manual",
        },
    });

    const patch = {
        updatedAt: now,
        lastOutboundAt: now,
        lastManualReplyAt: now,
        lastManualReplyText: cleanBody,
        lastManualReplyBy: cleanAdminUserId,
        lastBotStage: safeString(client?.lastBotStage || ""),
    };

    if (markHumanTakeover) {
        patch.chatMode = "human";
        patch.botPausedAt = now;
        patch.botPausedBy = cleanAdminUserId;
        patch.humanTakeoverAt = now;
        patch.humanTakeoverBy = cleanAdminUserId;
    }

    if (shouldClearLeadHistoryOnManualActivity(client)) {
        patch.leadHistoryArchivedAt = null;
        patch.leadHistoryBucket = null;
    }

    await clientRef.set(stripUndefined(patch), { merge: true });

    return {
        ok: true,
        clientId: cleanClientId,
        waId,
        whatsappMessageId,
        sentAt: now,
    };
}

async function resumeBotForClient({
    clientId,
    adminUserId,
}) {
    const cleanClientId = safeString(clientId);
    const cleanAdminUserId = safeString(adminUserId);

    if (!cleanClientId) {
        throw new Error("missing_client_id");
    }

    if (!cleanAdminUserId) {
        throw new Error("missing_admin_user_id");
    }

    const clientRef = db.doc(`clients/${cleanClientId}`);
    const snap = await clientRef.get();

    if (!snap.exists) {
        throw new Error("client_not_found");
    }

    const now = Date.now();

    await clientRef.set(
        {
            chatMode: "bot",
            resumeBotAt: now,
            resumeBotBy: cleanAdminUserId,
        },
        { merge: true }
    );

    return {
        ok: true,
        clientId: cleanClientId,
        resumedAt: now,
    };
}

module.exports = {
    appendClientMessage,
    isBotAllowedForClient,
    sendManualWhatsAppMessage,
    resumeBotForClient,
};