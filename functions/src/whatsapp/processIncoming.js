const { db } = require("../core/firebase");
const {
    safeString,
    normalizePhone,
    cleanupExtractedText,
} = require("../utils/text");
const {
    dayKeyFromMs,
    roundCoord,
    hasValidCoords,
    buildGoogleMapsUrlFromCoords,
    extractGoogleMapsUrlFromText,
} = require("../utils/geo");

function createProcessIncomingWhatsappMessage({
    looksLikeSystemOrMetaMessage,
    looksLikeGreetingOrInterestText,
    looksLikeBrazilAddress,
    isLikelyBusinessLine,
    upsertLeadAsClient,
    maybeReplyToLead,
}) {
    return async function processIncomingWhatsappMessage(changeValue) {
        const contacts = Array.isArray(changeValue?.contacts) ? changeValue.contacts : [];
        const messages = Array.isArray(changeValue?.messages) ? changeValue.messages : [];

        for (const msg of messages) {
            const msgType = safeString(msg?.type);
            if (msgType !== "text" && msgType !== "location") continue;

            const messageId = safeString(msg?.id);
            const waId = normalizePhone(msg?.from || "");

            if (!waId || !messageId) continue;

            const inboxRef = db.collection("incomingLeads").doc(messageId);
            const existingInbox = await inboxRef.get();

            if (existingInbox.exists) {
                const existingData = existingInbox.data() || {};
                if (existingData.status === "processed") {
                    console.log("[WHATSAPP] duplicated inbound skipped:", messageId);
                    continue;
                }
            }

            const contact = contacts.find((c) => normalizePhone(c?.wa_id || "") === waId) || {};
            const profileName = safeString(contact?.profile?.name);

            let textBody = "";
            let locationData = null;

            if (msgType === "text") {
                textBody = safeString(msg?.text?.body);
                if (!textBody) continue;
            }

            if (msgType === "location") {
                const lat = roundCoord(msg?.location?.latitude);
                const lng = roundCoord(msg?.location?.longitude);
                const address = cleanupExtractedText(msg?.location?.address || "");
                const name = cleanupExtractedText(msg?.location?.name || "");
                const mapsUrl = hasValidCoords(lat, lng)
                    ? buildGoogleMapsUrlFromCoords(lat, lng)
                    : "";

                locationData = {
                    lat,
                    lng,
                    address,
                    name,
                    mapsUrl,
                };

                textBody = [
                    name ? `Local: ${name}` : "",
                    address ? `Endereço: ${address}` : "",
                    mapsUrl ? `Maps: ${mapsUrl}` : "",
                ]
                    .filter(Boolean)
                    .join(" | ");
            }

            const now = Date.now();

            await inboxRef.set({
                id: messageId,
                source: "whatsapp_meta",
                channel: "whatsapp",
                phone: waId,
                waId,
                profileName: profileName || "",
                rawText: textBody || "",
                messageType: msgType,
                createdAt: now,
                dayKey: dayKeyFromMs(now),
                parseStatus: "processing",
                status: "processing",
                mapsUrl: locationData?.mapsUrl || extractGoogleMapsUrlFromText(textBody) || "",
                lat: locationData?.lat ?? null,
                lng: locationData?.lng ?? null,
                locationAddress: locationData?.address || "",
                locationName: locationData?.name || "",
            }, { merge: true });

            try {
                if (msgType === "text") {
                    const isSystemMessage = looksLikeSystemOrMetaMessage(textBody, profileName, waId);

                    if (isSystemMessage) {
                        await inboxRef.set({
                            status: "processed",
                            result: "ignored",
                            ignored: true,
                            ignoreReason: "system_message",
                            processedAt: Date.now(),
                        }, { merge: true });

                        console.log("[WHATSAPP] ignored system message:", {
                            messageId,
                            waId,
                            profileName,
                        });
                        continue;
                    }
                }

                const isGreetingOnly =
                    msgType === "text" &&
                    !looksLikeBrazilAddress(textBody) &&
                    !isLikelyBusinessLine(textBody) &&
                    !extractGoogleMapsUrlFromText(textBody) &&
                    looksLikeGreetingOrInterestText(textBody);

                const result = await upsertLeadAsClient({
                    phone: waId,
                    profileName,
                    rawText: textBody,
                    inboxRef,
                    messageId,
                    contactWaId: waId,
                    locationData,
                });

                await inboxRef.set({
                    status: "processed",
                    result: result.result,
                    clientId: result.clientId,
                    parseStatus: result.parseStatus,
                    processedAt: Date.now(),
                    greetingDetected: isGreetingOnly,

                    parsedName: cleanupExtractedText(result?.mergedClient?.name || ""),
                    parsedAddress: cleanupExtractedText(result?.mergedClient?.address || ""),
                    parsedBusiness: cleanupExtractedText(result?.mergedClient?.business || ""),
                    parsedBusinessRaw: cleanupExtractedText(result?.mergedClient?.businessRaw || ""),
                    businessQuality: safeString(result?.mergedClient?.businessQuality || ""),
                    businessFlags: Array.isArray(result?.mergedClient?.businessFlags)
                        ? result.mergedClient.businessFlags
                        : [],
                    profileFlags: Array.isArray(result?.mergedClient?.profileFlags)
                        ? result.mergedClient.profileFlags
                        : [],
                    profileType: safeString(result?.mergedClient?.profileType || ""),
                    leadQuality: safeString(result?.mergedClient?.leadQuality || ""),
                    notSuitableReason: safeString(result?.mergedClient?.notSuitableReason || ""),
                    mapsUrl: safeString(result?.mergedClient?.mapsUrl || ""),
                    lat: result?.mergedClient?.lat ?? null,
                    lng: result?.mergedClient?.lng ?? null,
                }, { merge: true });

                try {
                    await maybeReplyToLead({
                        clientId: result.clientId,
                        waId,
                        messageType: msgType,
                        inboxRef,
                    });
                } catch (botError) {
                    console.error("[WHATSAPP BOT] reply error:", botError);

                    await inboxRef.set({
                        botReplyStatus: "error",
                        botReplyError: String(botError?.message || botError || "unknown_bot_error"),
                        botReplyAt: Date.now(),
                    }, { merge: true });
                }

                console.log("[WHATSAPP] processed message:", {
                    messageId,
                    waId,
                    messageType: msgType,
                    result: result.result,
                    clientId: result.clientId,
                });
            } catch (error) {
                console.error("[WHATSAPP] process error:", error);

                await inboxRef.set({
                    status: "error",
                    error: String(error?.message || error || "unknown_error"),
                    processedAt: Date.now(),
                }, { merge: true });
            }
        }
    };
}

module.exports = {
    createProcessIncomingWhatsappMessage,
};