const { db } = require("../core/firebase");
const {
    cleanupExtractedText,
    safeString,
    safeNumber,
    stripUndefined,
} = require("../utils/text");
const {
    roundCoord,
    hasValidCoords,
    buildGoogleMapsUrlFromCoords,
    extractGoogleMapsUrlFromText,
} = require("../utils/geo");
const { detectInboundIntent, getVerificationStatusFromLead } = require("../bot/intents");
const { findClientByPhone, findClientByWaId } = require("./findClient");

function pickLeadQuality(prevQuality, nextQuality) {
    const rank = {
        not_suitable: 3,
        review: 2,
        valid: 1,
        unknown: 0,
        "": 0,
    };

    const prevRank = rank[prevQuality || ""] || 0;
    const nextRank = rank[nextQuality || ""] || 0;

    return nextRank >= prevRank
        ? (nextQuality || "unknown")
        : (prevQuality || "unknown");
}

function pickProfileType(prevType, nextType) {
    const locked = ["app_driver", "retired", "salary_worker", "mixed_restricted"];
    if (locked.includes(prevType)) return prevType;
    return nextType || prevType || "business";
}

function pickVerificationStatus(prevStatus, nextStatus, leadQuality, parseStatus) {
    const prev = String(prevStatus || "").trim().toLowerCase();
    const next = String(nextStatus || "").trim().toLowerCase();

    if (prev === "verified") return "verified";

    if (String(leadQuality || "").trim().toLowerCase() === "not_suitable") {
        return "not_suitable";
    }

    if (String(parseStatus || "").trim().toLowerCase() !== "ready") {
        return "incomplete";
    }

    return next || prev || "pending_review";
}

function pickBetterBusiness(prevBusiness, nextBusiness) {
    const prev = cleanupExtractedText(prevBusiness || "");
    const next = cleanupExtractedText(nextBusiness || "");

    if (!prev) return next;
    if (!next) return prev;

    if (prev.length >= next.length) return prev;
    return next;
}

function pickBetterAddress(prevAddress, nextAddress) {
    const prev = cleanupExtractedText(prevAddress || "");
    const next = cleanupExtractedText(nextAddress || "");

    if (!prev) return next;
    if (!next) return prev;

    if (next.length > prev.length + 4) return next;
    return prev;
}

function createUpsertLeadAsClient({
    parseLeadText,
    resolveNextClientName,
    getFinalParseStatus,
}) {
    return async function upsertLeadAsClient({
        phone,
        profileName,
        rawText,
        inboxRef,
        messageId,
        contactWaId,
        locationData,
    }) {
        const now = Date.now();
        const parsed = parseLeadText(rawText, profileName);

        const lat = roundCoord(locationData?.lat);
        const lng = roundCoord(locationData?.lng);
        const locationAddress = cleanupExtractedText(locationData?.address || "");

        const generatedMapsUrlFromCoords =
            hasValidCoords(lat, lng) ? buildGoogleMapsUrlFromCoords(lat, lng) : "";
        const generatedMapsUrlFromText = extractGoogleMapsUrlFromText(rawText);
        const generatedMapsUrl =
            generatedMapsUrlFromText || generatedMapsUrlFromCoords || "";

        const hasMapsInThisMessage = !!generatedMapsUrl || hasValidCoords(lat, lng);

        const inboundIntent = detectInboundIntent(rawText);
        const businessFlags = Array.isArray(parsed.businessFlags)
            ? parsed.businessFlags
            : [];
        const businessQuality = parsed.businessQuality || "unknown";
        const profileFlags = Array.isArray(parsed.profileFlags)
            ? parsed.profileFlags
            : [];
        const profileType = parsed.profileType || "business";
        const leadQuality = parsed.leadQuality || "unknown";
        const notSuitableReason = parsed.notSuitableReason || "";

        let found = await findClientByPhone(phone);
        if (!found && contactWaId) {
            found = await findClientByWaId(contactWaId);
        }

        if (!found) {
            const newClientRef = db.collection("clients").doc();

            const resolvedName = resolveNextClientName({
                prevName: "",
                profileName,
            });

            const draftClient = {
                name: resolvedName || "",
                business: pickBetterBusiness("", parsed.parsedBusiness || ""),
                businessRaw: pickBetterBusiness(
                    "",
                    parsed.parsedBusinessRaw || parsed.parsedBusiness || ""
                ),
                businessQuality,
                businessFlags,
                profileFlags,
                profileType,
                leadQuality,
                notSuitableReason,
                phone,
                mapsUrl: generatedMapsUrl || "",
                address: pickBetterAddress(
                    "",
                    parsed.parsedAddress || locationAddress || ""
                ),
                lat: hasValidCoords(lat, lng) ? lat : null,
                lng: hasValidCoords(lat, lng) ? lng : null,
                currentLeadMapsConfirmedAt: hasMapsInThisMessage ? now : 0,
            };

            const finalParseStatus = getFinalParseStatus(draftClient);
            const verificationStatus =
                parsed.verificationStatus ||
                getVerificationStatusFromLead({
                    parseStatus: finalParseStatus,
                    leadQuality,
                });

            const payload = {
                ...draftClient,
                verificationStatus,
                verifiedAt: null,
                verifiedBy: null,
                manualReviewNote: null,

                assignedTo: "",
                assignedAt: 0,
                assignedDayKey: "",
                status: "pending",
                statusBy: null,
                statusAt: null,

                createdAt: now,
                updatedAt: now,
                note: null,
                rejectedReason: null,

                source: "whatsapp_meta",
                sourceRef: inboxRef.path,
                parseStatus: finalParseStatus,
                autoCapturedAt: now,
                lastInboundMessageAt: now,
                lastInboundText: rawText || "",
                lastInboundIntent: inboundIntent,
                waId: contactWaId || phone,
                lastMessageId: messageId || "",

                initialIntroSentAt: 0,
                lastBotReplyAt: 0,
                lastBotReplyText: "",
                lastBotStage: "",
                lastOutboundAt: 0,

                chatMode: "bot",
                botPausedAt: 0,
                botPausedBy: "",
                humanTakeoverAt: 0,
                humanTakeoverBy: "",
                resumeBotAt: 0,
                resumeBotBy: "",
                lastManualReplyAt: 0,
                lastManualReplyText: "",
                lastManualReplyBy: "",
            };

            await newClientRef.set(stripUndefined(payload));

            await inboxRef.set(
                {
                    clientId: newClientRef.id,
                    result: "created",
                    parsedName: draftClient.name || "",
                    parsedAddress: draftClient.address || "",
                    parsedBusiness: draftClient.business || "",
                    parsedBusinessRaw: draftClient.businessRaw || "",
                    businessQuality: draftClient.businessQuality,
                    businessFlags: draftClient.businessFlags,
                    profileFlags: draftClient.profileFlags,
                    profileType: draftClient.profileType,
                    leadQuality: draftClient.leadQuality,
                    notSuitableReason: draftClient.notSuitableReason,
                    verificationStatus,
                    parseStatus: finalParseStatus,
                    processedAt: now,
                    mapsUrl: draftClient.mapsUrl || "",
                    lat: draftClient.lat,
                    lng: draftClient.lng,
                    locationCaptured: !!locationData,
                },
                { merge: true }
            );

            return {
                clientId: newClientRef.id,
                result: "created",
                parseStatus: finalParseStatus,
                mergedClient: payload,
            };
        }

        const prev = found.data || {};

        const mergedProfileFlags = Array.from(
            new Set([
                ...(Array.isArray(prev.profileFlags) ? prev.profileFlags : []),
                ...profileFlags,
            ])
        );

        const mergedBusinessFlags = Array.from(
            new Set([
                ...(Array.isArray(prev.businessFlags) ? prev.businessFlags : []),
                ...businessFlags,
            ])
        );

        const mergedClientBase = {
            ...prev,

            name: resolveNextClientName({
                prevName: prev.name,
                profileName,
            }),

            business: pickBetterBusiness(prev.business, parsed.parsedBusiness || ""),
            businessRaw: pickBetterBusiness(
                prev.businessRaw,
                parsed.parsedBusinessRaw || parsed.parsedBusiness || ""
            ),

            businessQuality:
                prev.businessQuality && prev.businessQuality !== "unknown"
                    ? prev.businessQuality
                    : businessQuality,

            businessFlags: mergedBusinessFlags,
            profileFlags: mergedProfileFlags,
            profileType: pickProfileType(prev.profileType, profileType),
            leadQuality: pickLeadQuality(prev.leadQuality, leadQuality),
            notSuitableReason:
                safeString(prev.notSuitableReason || "") ||
                safeString(notSuitableReason || ""),

            address: pickBetterAddress(
                prev.address,
                parsed.parsedAddress || locationAddress
            ),

            mapsUrl: hasMapsInThisMessage
                ? (generatedMapsUrl || safeString(prev.mapsUrl || ""))
                : safeString(prev.mapsUrl || ""),

            lat: hasMapsInThisMessage
                ? (hasValidCoords(lat, lng) ? lat : null)
                : (prev.lat !== undefined && prev.lat !== null ? prev.lat : null),

            lng: hasMapsInThisMessage
                ? (hasValidCoords(lat, lng) ? lng : null)
                : (prev.lng !== undefined && prev.lng !== null ? prev.lng : null),

            currentLeadMapsConfirmedAt: hasMapsInThisMessage
                ? now
                : safeNumber(prev.currentLeadMapsConfirmedAt, 0),

            lastInboundIntent: inboundIntent,
        };

        const finalParseStatus = getFinalParseStatus(mergedClientBase);

        const computedVerificationStatus = getVerificationStatusFromLead({
            parseStatus: finalParseStatus,
            leadQuality: mergedClientBase.leadQuality,
        });

        const mergedClient = {
            ...mergedClientBase,
            verificationStatus: pickVerificationStatus(
                prev.verificationStatus,
                computedVerificationStatus,
                mergedClientBase.leadQuality,
                finalParseStatus
            ),
        };

        const patch = {
            updatedAt: now,
            lastInboundMessageAt: now,
            lastInboundText: rawText || "",
            lastInboundIntent: inboundIntent,
            lastMessageId: messageId || "",

            source: prev.source || "whatsapp_meta",
            sourceRef: prev.sourceRef || inboxRef.path,
            waId: contactWaId || phone,

            name: mergedClient.name,
            business: mergedClient.business,
            businessRaw: mergedClient.businessRaw,
            businessQuality: mergedClient.businessQuality,
            businessFlags: mergedClient.businessFlags,
            profileFlags: mergedClient.profileFlags,
            profileType: mergedClient.profileType,
            leadQuality: mergedClient.leadQuality,
            notSuitableReason: mergedClient.notSuitableReason,
            verificationStatus: mergedClient.verificationStatus,

            address: mergedClient.address,
            mapsUrl: mergedClient.mapsUrl,
            lat: mergedClient.lat,
            lng: mergedClient.lng,
            currentLeadMapsConfirmedAt: mergedClient.currentLeadMapsConfirmedAt,
            parseStatus: finalParseStatus,

            verifiedAt: prev.verifiedAt ?? null,
            verifiedBy: prev.verifiedBy ?? null,
            manualReviewNote: prev.manualReviewNote ?? null,

            initialIntroSentAt: safeNumber(prev.initialIntroSentAt, 0),
            lastBotReplyAt: safeNumber(prev.lastBotReplyAt, 0),
            lastBotReplyText: safeString(prev.lastBotReplyText || ""),
            lastBotStage: safeString(prev.lastBotStage || ""),
        };

        await found.ref.set(stripUndefined(patch), { merge: true });

        await inboxRef.set(
            {
                clientId: found.id,
                result: "updated_existing",
                parsedName: mergedClient.name || "",
                parsedAddress: mergedClient.address || "",
                parsedBusiness: mergedClient.business || "",
                parsedBusinessRaw: mergedClient.businessRaw || "",
                businessQuality: mergedClient.businessQuality,
                businessFlags: mergedClient.businessFlags,
                profileFlags: mergedClient.profileFlags,
                profileType: mergedClient.profileType,
                leadQuality: mergedClient.leadQuality,
                notSuitableReason: mergedClient.notSuitableReason,
                verificationStatus: mergedClient.verificationStatus,
                parseStatus: finalParseStatus,
                processedAt: now,
                mapsUrl: mergedClient.mapsUrl || "",
                lat: mergedClient.lat ?? null,
                lng: mergedClient.lng ?? null,
                locationCaptured: !!locationData,
            },
            { merge: true }
        );

        return {
            clientId: found.id,
            result: "updated_existing",
            parseStatus: finalParseStatus,
            mergedClient,
        };
    };
}

module.exports = {
    createUpsertLeadAsClient,
};