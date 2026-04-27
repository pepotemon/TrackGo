const {
    onDocumentCreated,
    onDocumentUpdated,
} = require("firebase-functions/v2/firestore");

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getAuth } = require("firebase-admin/auth");

const { db } = require("./src/core/firebase");
const { WHATSAPP_VERIFY_TOKEN } = require("./src/config/params");

const { createReminderMissingInfoJob } = require("./src/cron/reminderMissingInfo");

const { looksLikeSystemOrMetaMessage } = (() => {
    const { normalizeLooseText } = require("./src/utils/text");

    return {
        looksLikeSystemOrMetaMessage(text, profileName, waId) {
            const s = normalizeLooseText(text);
            const p = normalizeLooseText(profileName);

            if (!s) return true;

            if (p === "whatsapp business" || p === "meta") return true;
            if (waId === "16465894168") return true;

            const blockedPhrases = [
                "continue setting up your account",
                "setup guidance",
                "whatsapp manager",
                "you have a few steps left",
                "get detailed instructions",
                "track progress for your number",
                "new setup guidance",
                "learn more about",
                "saiba mais sobre",
                "configure sua conta",
                "configurar sua conta",
                "continue configurando",
                "test whatsapp business account",
            ];

            return blockedPhrases.some((x) => s.includes(normalizeLooseText(x)));
        },
    };
})();

const { looksLikeBrazilAddress } = require("./src/utils/geo");
const { sendWhatsAppText } = require("./src/whatsapp/sender");

const {
    appendClientMessage,
    isBotAllowedForClient,
    sendManualWhatsAppMessage,
    resumeBotForClient,
} = require("./src/whatsapp/manualReply");

const { notifyAssignedUser } = require("./src/push/expoPush");

const business = require("./src/bot/business");
const namesFactory = require("./src/bot/names");

const { createLeadParser } = require("./src/bot/parser");
const { createBotReplyBuilder } = require("./src/bot/replies");
const { createBotReplyBuilderEsPa } = require("./src/bot/repliesEsPa");
const leadState = require("./src/bot/leadState");

const { createUpsertLeadAsClient } = require("./src/whatsapp/upsertLead");
const { createProcessIncomingWhatsappMessage } = require("./src/whatsapp/processIncoming");
const { getWhatsappChannelFromClient } = require("./src/whatsapp/channels");

const isBadProfileName = namesFactory.isBadProfileNameFactory({
    isLikelyBusinessLine: business.isLikelyBusinessLine,
});

const sanitizeExplicitPersonName = namesFactory.sanitizeExplicitPersonNameFactory({
    isLikelyBusinessLine: business.isLikelyBusinessLine,
});

const sanitizeFallbackProfileName = namesFactory.sanitizeFallbackProfileNameFactory({
    isBadProfileName,
});

const looksLikePersonName = namesFactory.looksLikePersonNameFactory({
    isLikelyBusinessLine: business.isLikelyBusinessLine,
    looksLikeGreetingOrInterestText: business.looksLikeGreetingOrInterestText,
});

const resolveNextClientName = namesFactory.resolveNextClientNameFactory({
    isBadProfileName,
    sanitizeFallbackProfileName,
});

const isPossibleBusinessFallbackText = business.isPossibleBusinessFallbackTextFactory({
    looksLikePersonName,
});

function sanitizeAddress(address) {
    const { cleanupExtractedText, normalizeLooseText } = require("./src/utils/text");

    const v = cleanupExtractedText(address);
    if (!v) return "";

    const s = normalizeLooseText(v);

    if (
        s.includes("http://") ||
        s.includes("https://") ||
        s.includes("setup guidance") ||
        s.includes("whatsapp manager")
    ) {
        return "";
    }

    if (!looksLikeBrazilAddress(v) && v.length < 10) return "";

    return v;
}

const parseLeadText = createLeadParser({
    sanitizeExplicitPersonName,
    sanitizeFallbackProfileName,
    looksLikePersonName,
    sanitizeAddress,
    isLikelyBusinessLine: business.isLikelyBusinessLine,
    normalizeBusinessLabel: business.normalizeBusinessLabel,
    sanitizeBusiness: business.sanitizeBusiness,
    isPossibleBusinessFallbackText,
    classifyBusinessQuality: business.classifyBusinessQuality,
    getBusinessFlags: business.getBusinessFlags,
});

const hasUsefulName = leadState.hasUsefulNameFactory({ isBadProfileName });
const getFinalParseStatus = leadState.getFinalParseStatusFactory({ hasUsefulName });

const buildBotReplyPtBr = createBotReplyBuilder({
    hasUsefulBusiness: leadState.hasUsefulBusiness,
    hasRequiredMapsForFlow: leadState.hasRequiredMapsForFlow,
});

const buildBotReplyEsPa = createBotReplyBuilderEsPa({
    hasUsefulBusiness: leadState.hasUsefulBusiness,
    hasRequiredMapsForFlow: leadState.hasRequiredMapsForFlow,
});

async function requireAdminUser(req) {
    const authHeader = String(req.headers.authorization || "");
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match?.[1]) {
        const err = new Error("missing_authorization_token");
        err.statusCode = 401;
        throw err;
    }

    const decoded = await getAuth().verifyIdToken(match[1]);
    const uid = String(decoded?.uid || "").trim();

    if (!uid) {
        const err = new Error("invalid_auth_user");
        err.statusCode = 401;
        throw err;
    }

    const userSnap = await db.doc(`users/${uid}`).get();

    if (!userSnap.exists) {
        const err = new Error("admin_user_not_found");
        err.statusCode = 403;
        throw err;
    }

    const user = userSnap.data() || {};

    if (user.role !== "admin" || user.active !== true) {
        const err = new Error("admin_required");
        err.statusCode = 403;
        throw err;
    }

    return { uid, user };
}

async function maybeReplyToLead({
    clientId,
    waId,
    messageType,
    inboxRef,
}) {
    if (!clientId || !waId) return;

    const clientRef = db.doc(`clients/${clientId}`);
    const snap = await clientRef.get();

    if (!snap.exists) return;

    const client = snap.data() || {};
    const { safeString, safeNumber } = require("./src/utils/text");

    if (!isBotAllowedForClient(client)) {
        console.log("[WHATSAPP BOT] skipped:", {
            clientId,
            waId,
            reason: "human_takeover_active",
            chatMode: safeString(client?.chatMode || ""),
            assignedTo: safeString(client?.assignedTo || ""),
        });

        await inboxRef.set(
            {
                botReplyStatus: "skipped",
                botReplyReason: "human_takeover_active",
                botReplyAt: Date.now(),
            },
            { merge: true }
        );
        return;
    }

    if (!leadState.shouldSendBotReply(client)) {
        console.log("[WHATSAPP BOT] skipped:", {
            clientId,
            waId,
            reason: "reply_rules_blocked",
            parseStatus: safeString(client?.parseStatus || ""),
            verificationStatus: safeString(client?.verificationStatus || ""),
            lastBotStage: safeString(client?.lastBotStage || ""),
            chatMode: safeString(client?.chatMode || ""),
        });

        await inboxRef.set(
            {
                botReplyStatus: "skipped",
                botReplyReason: "reply_rules_blocked",
                botReplyAt: Date.now(),
            },
            { merge: true }
        );
        return;
    }

    const channel = getWhatsappChannelFromClient(client);
    const reply =
        channel.language === "es-PA"
            ? buildBotReplyEsPa({ client, messageType })
            : buildBotReplyPtBr({ client, messageType });

    const body = safeString(reply?.body || "");
    const currentBotStage = safeString(reply?.stage || "");
    const markIntroSent = !!reply?.markIntroSent;

    if (!body || !currentBotStage) {
        console.log("[WHATSAPP BOT] skipped:", {
            clientId,
            waId,
            reason: "empty_reply",
            language: channel.language,
            marketCountry: channel.marketCountry,
        });

        await inboxRef.set(
            {
                botReplyStatus: "skipped",
                botReplyReason: "empty_reply",
                botReplyAt: Date.now(),
            },
            { merge: true }
        );
        return;
    }

    const lastBotReplyText = safeString(client?.lastBotReplyText || "");
    const lastBotStage = safeString(client?.lastBotStage || "");

    if (lastBotReplyText === body && lastBotStage === currentBotStage) {
        console.log("[WHATSAPP BOT] skipped:", {
            clientId,
            waId,
            reason: "same_reply_as_previous",
            stage: currentBotStage,
            language: channel.language,
            marketCountry: channel.marketCountry,
        });

        await inboxRef.set(
            {
                botReplyStatus: "skipped",
                botReplyReason: "same_reply_as_previous",
                botReplyAt: Date.now(),
            },
            { merge: true }
        );
        return;
    }

    const sendResult = await sendWhatsAppText(waId, body, {
        phoneNumberId: channel.phoneNumberId,
    });
    const now = Date.now();
    const whatsappMessageId = safeString(sendResult?.messages?.[0]?.id || "");

    await appendClientMessage({
        clientId,
        direction: "outbound",
        senderType: "bot",
        senderId: "system_bot",
        text: body,
        messageType: "text",
        whatsappMessageId,
        status: "sent",
        meta: {
            source: "bot_auto",
            stage: currentBotStage,
            whatsappPhoneNumberId: channel.phoneNumberId,
            language: channel.language,
            marketCountry: channel.marketCountry,
        },
    });

    const clientPatch = {
        lastBotReplyAt: now,
        lastBotReplyText: body,
        lastBotStage: currentBotStage,
        lastOutboundAt: now,
    };

    if (markIntroSent && !safeNumber(client?.initialIntroSentAt, 0)) {
        clientPatch.initialIntroSentAt = now;
        clientPatch.currentLeadMapsConfirmedAt = 0;
    }

    await clientRef.set(clientPatch, { merge: true });

    await inboxRef.set(
        {
            botReplyStatus: "sent",
            botReplyText: body,
            botReplyAt: now,
            botReplyStage: currentBotStage,
            botReplyMessageId: whatsappMessageId,
        },
        { merge: true }
    );

    console.log("[WHATSAPP BOT] sent:", {
        clientId,
        waId,
        stage: currentBotStage,
        language: channel.language,
        marketCountry: channel.marketCountry,
        phoneNumberId: channel.phoneNumberId,
        whatsappMessageId,
    });
}

const upsertLeadAsClient = createUpsertLeadAsClient({
    parseLeadText,
    resolveNextClientName,
    getFinalParseStatus,
});

const processIncomingWhatsappMessage = createProcessIncomingWhatsappMessage({
    looksLikeSystemOrMetaMessage,
    looksLikeGreetingOrInterestText: business.looksLikeGreetingOrInterestText,
    looksLikeBrazilAddress,
    isLikelyBusinessLine: business.isLikelyBusinessLine,
    upsertLeadAsClient,
    maybeReplyToLead,
    getRandomHumanReplyDelayMs: leadState.getRandomHumanReplyDelayMs,
});

exports.onClientCreatedAssigned = onDocumentCreated("clients/{clientId}", async (event) => {
    const clientId = event.params.clientId;
    const after = event.data?.data() || {};

    if (!after.assignedTo) return;

    try {
        await notifyAssignedUser({ clientId, after });
    } catch (e) {
        console.log("[PUSH] create error:", e);
    }
});

exports.onClientReassigned = onDocumentUpdated("clients/{clientId}", async (event) => {
    const clientId = event.params.clientId;

    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};

    const beforeUid = before.assignedTo || null;
    const afterUid = after.assignedTo || null;

    if (!afterUid || beforeUid === afterUid) return;

    try {
        await notifyAssignedUser({ clientId, after });
    } catch (e) {
        console.log("[PUSH] update error:", e);
    }
});

/*
MANUAL CHAT
*/

exports.sendManualLeadMessage = onRequest(
    {
        region: "us-central1",
        cors: true,
    },
    async (req, res) => {
        try {
            if (req.method !== "POST") {
                res.status(405).json({ ok: false, error: "method_not_allowed" });
                return;
            }

            const { uid } = await requireAdminUser(req);

            const body = req.body || {};
            const clientId = String(body?.clientId || "").trim();
            const text = String(body?.text || "").trim();
            const markHumanTakeover = body?.markHumanTakeover !== false;

            if (!clientId) {
                res.status(400).json({ ok: false, error: "missing_client_id" });
                return;
            }

            if (!text) {
                res.status(400).json({ ok: false, error: "missing_text" });
                return;
            }

            const result = await sendManualWhatsAppMessage({
                clientId,
                adminUserId: uid,
                body: text,
                markHumanTakeover,
            });

            res.status(200).json(result);
        } catch (error) {
            const status = Number(error?.statusCode) || 500;
            console.error("[WHATSAPP MANUAL] send error:", error);
            res.status(status).json({
                ok: false,
                error: String(error?.message || "manual_send_failed"),
            });
        }
    }
);

exports.resumeBotLead = onRequest(
    {
        region: "us-central1",
        cors: true,
    },
    async (req, res) => {
        try {
            if (req.method !== "POST") {
                res.status(405).json({ ok: false, error: "method_not_allowed" });
                return;
            }

            const { uid } = await requireAdminUser(req);

            const body = req.body || {};
            const clientId = String(body?.clientId || "").trim();

            if (!clientId) {
                res.status(400).json({ ok: false, error: "missing_client_id" });
                return;
            }

            const result = await resumeBotForClient({
                clientId,
                adminUserId: uid,
            });

            res.status(200).json(result);
        } catch (error) {
            const status = Number(error?.statusCode) || 500;
            console.error("[WHATSAPP MANUAL] resume bot error:", error);
            res.status(status).json({
                ok: false,
                error: String(error?.message || "resume_bot_failed"),
            });
        }
    }
);

/*
REMINDER AUTOMÁTICO
Revisa leads incompletos antes de que cierre la ventana de 24h
*/

exports.reminderMissingInfo = onSchedule(
    {
        schedule: "every 30 minutes",
        region: "us-central1",
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    createReminderMissingInfoJob({
        hoursBeforeDeadline: 5,
        maxClientsPerRun: 300,
        maxRemindersPerClient: 2,
    })
);

exports.whatsappWebhook = onRequest(
    {
        region: "us-central1",
        cors: true,
    },
    async (req, res) => {
        try {
            if (req.method === "GET") {
                const mode = req.query["hub.mode"];
                const token = req.query["hub.verify_token"];
                const challenge = req.query["hub.challenge"];

                const expectedToken = WHATSAPP_VERIFY_TOKEN.value();

                if (mode === "subscribe" && token === expectedToken) {
                    console.log("[WHATSAPP] webhook verified");
                    res.status(200).send(challenge);
                    return;
                }

                console.log("[WHATSAPP] verification failed");
                res.status(403).send("Forbidden");
                return;
            }

            if (req.method !== "POST") {
                res.status(405).send("Method Not Allowed");
                return;
            }

            const { safeString } = require("./src/utils/text");

            const body = req.body || {};
            const entries = Array.isArray(body?.entry) ? body.entry : [];

            for (const entry of entries) {
                const changes = Array.isArray(entry?.changes) ? entry.changes : [];

                for (const change of changes) {
                    const field = safeString(change?.field);
                    const value = change?.value || {};

                    if (field !== "messages") continue;

                    await processIncomingWhatsappMessage(value);
                }
            }

            res.status(200).send("EVENT_RECEIVED");
        } catch (error) {
            console.error("[WHATSAPP] webhook fatal error:", error);
            res.status(500).send("internal_error");
        }
    }
);
