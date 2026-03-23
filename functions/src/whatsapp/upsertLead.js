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
const {
    buildEmptyTrackGoGeo,
    resolveTrackGoGeoFromCoords,
} = require("../utils/trackgoGeo");
const {
    buildEmptyReverseGeoBrazil,
    reverseGeoBrazil,
} = require("../utils/reverseGeoBrazil");
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
    const quality = String(leadQuality || "").trim().toLowerCase();
    const parse = String(parseStatus || "").trim().toLowerCase();

    if (prev === "verified") return "verified";

    /**
     * Regla clave fase 2:
     * si ya fue marcado como no apto, NO se reactiva automáticamente
     * por nuevos mensajes. Solo un humano lo cambia.
     */
    if (prev === "not_suitable") return "not_suitable";

    if (quality === "not_suitable") {
        return "not_suitable";
    }

    if (parse !== "ready") {
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

function pickBetterMapsUrl(prevMapsUrl, nextMapsUrl, hasMapsInThisMessage) {
    const prev = safeString(prevMapsUrl || "");
    const next = safeString(nextMapsUrl || "");

    if (hasMapsInThisMessage && next) return next;
    return prev || next || "";
}

function pickBetterCoords(prevLat, prevLng, nextLat, nextLng, hasMapsInThisMessage) {
    if (hasMapsInThisMessage) {
        if (hasValidCoords(nextLat, nextLng)) {
            return {
                lat: nextLat,
                lng: nextLng,
            };
        }

        return {
            lat: null,
            lng: null,
        };
    }

    if (hasValidCoords(prevLat, prevLng)) {
        return {
            lat: prevLat,
            lng: prevLng,
        };
    }

    return {
        lat: null,
        lng: null,
    };
}

function pickTrackGoGeoFields(prevClient, nextGeo, hasMapsInThisMessage) {
    if (hasMapsInThisMessage) {
        return nextGeo || buildEmptyTrackGoGeo();
    }

    return {
        geoCityLabel: prevClient?.geoCityLabel ?? null,
        geoCityNormalized: prevClient?.geoCityNormalized ?? null,
        geoCluster: prevClient?.geoCluster ?? null,
        geoSource: prevClient?.geoSource ?? null,
        geoResolvedAt: prevClient?.geoResolvedAt ?? null,
        geoDistanceToHubKm:
            prevClient?.geoDistanceToHubKm == null
                ? null
                : safeNumber(prevClient.geoDistanceToHubKm),
        geoOutOfCoverage:
            typeof prevClient?.geoOutOfCoverage === "boolean"
                ? prevClient.geoOutOfCoverage
                : null,
        geoConfidence: prevClient?.geoConfidence ?? null,
        geoNearestHubKey: prevClient?.geoNearestHubKey ?? null,
        geoNearestHubLabel: prevClient?.geoNearestHubLabel ?? null,
    };
}

function pickReverseGeoFields(prevClient, nextGeo, hasMapsInThisMessage) {
    if (hasMapsInThisMessage) {
        return nextGeo || buildEmptyReverseGeoBrazil();
    }

    return {
        geoAdminCityLabel: prevClient?.geoAdminCityLabel ?? null,
        geoAdminCityNormalized: prevClient?.geoAdminCityNormalized ?? null,
        geoAdminStateLabel: prevClient?.geoAdminStateLabel ?? null,
        geoAdminStateNormalized: prevClient?.geoAdminStateNormalized ?? null,
        geoAdminCountryLabel: prevClient?.geoAdminCountryLabel ?? null,
        geoAdminCountryNormalized: prevClient?.geoAdminCountryNormalized ?? null,
        geoAdminSource: prevClient?.geoAdminSource ?? null,
        geoAdminResolvedAt: prevClient?.geoAdminResolvedAt ?? null,
        geoAdminDisplayLabel: prevClient?.geoAdminDisplayLabel ?? null,
    };
}

function buildHistoryClearPatchForVerificationStatus(verificationStatus) {
    const status = safeString(verificationStatus || "");

    /**
     * Si sigue no apto, conservamos bucket/archivo persistido.
     * Si no lo es, limpiamos historial persistido para que vuelva a cola activa.
     */
    if (status === "not_suitable") {
        return {};
    }

    return {
        leadHistoryArchivedAt: null,
        leadHistoryBucket: null,
    };
}

function extractCoordsFromMapsUrl(url) {
    const raw = safeString(url);
    if (!raw) {
        return { lat: null, lng: null };
    }

    try {
        const decoded = decodeURIComponent(raw);

        const patterns = [
            /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
        ];

        for (const pattern of patterns) {
            const match = decoded.match(pattern);
            if (match?.[1] && match?.[2]) {
                const lat = roundCoord(match[1]);
                const lng = roundCoord(match[2]);

                if (hasValidCoords(lat, lng)) {
                    return { lat, lng };
                }
            }
        }

        return { lat: null, lng: null };
    } catch {
        return { lat: null, lng: null };
    }
}

function resolveEffectiveCoords(locationLat, locationLng, mapsUrl) {
    if (hasValidCoords(locationLat, locationLng)) {
        return {
            lat: locationLat,
            lng: locationLng,
            source: "location",
        };
    }

    const fromMaps = extractCoordsFromMapsUrl(mapsUrl);
    if (hasValidCoords(fromMaps.lat, fromMaps.lng)) {
        return {
            lat: fromMaps.lat,
            lng: fromMaps.lng,
            source: "maps_url",
        };
    }

    return {
        lat: null,
        lng: null,
        source: "",
    };
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

        const rawLocationLat = roundCoord(locationData?.lat);
        const rawLocationLng = roundCoord(locationData?.lng);
        const locationAddress = cleanupExtractedText(locationData?.address || "");

        const generatedMapsUrlFromCoords =
            hasValidCoords(rawLocationLat, rawLocationLng)
                ? buildGoogleMapsUrlFromCoords(rawLocationLat, rawLocationLng)
                : "";

        const generatedMapsUrlFromText = extractGoogleMapsUrlFromText(rawText);

        const generatedMapsUrl =
            generatedMapsUrlFromText || generatedMapsUrlFromCoords || "";

        const effectiveCoords = resolveEffectiveCoords(
            rawLocationLat,
            rawLocationLng,
            generatedMapsUrl
        );

        const lat = effectiveCoords.lat;
        const lng = effectiveCoords.lng;

        const hasMapsInThisMessage =
            !!generatedMapsUrl || hasValidCoords(lat, lng);

        const resolvedTrackGoGeo = hasValidCoords(lat, lng)
            ? resolveTrackGoGeoFromCoords(lat, lng, now)
            : buildEmptyTrackGoGeo();

        const resolvedReverseGeo = hasValidCoords(lat, lng)
            ? await reverseGeoBrazil(lat, lng, now)
            : buildEmptyReverseGeoBrazil();

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

            const draftCoords = pickBetterCoords(null, null, lat, lng, hasMapsInThisMessage);
            const trackGoGeoFields = pickTrackGoGeoFields(
                null,
                resolvedTrackGoGeo,
                hasMapsInThisMessage
            );
            const reverseGeoFields = pickReverseGeoFields(
                null,
                resolvedReverseGeo,
                hasMapsInThisMessage
            );

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
                mapsUrl: pickBetterMapsUrl("", generatedMapsUrl, hasMapsInThisMessage),
                address: pickBetterAddress(
                    "",
                    parsed.parsedAddress || locationAddress || ""
                ),
                lat: draftCoords.lat,
                lng: draftCoords.lng,
                currentLeadMapsConfirmedAt: hasMapsInThisMessage ? now : 0,
                ...trackGoGeoFields,
                ...reverseGeoFields,
            };

            const finalParseStatus = getFinalParseStatus(draftClient);

            const verificationStatus = pickVerificationStatus(
                "",
                parsed.verificationStatus ||
                getVerificationStatusFromLead({
                    parseStatus: finalParseStatus,
                    leadQuality,
                }),
                leadQuality,
                finalParseStatus
            );

            const payload = {
                ...draftClient,
                verificationStatus,
                verificationStatusChangedAt: now,
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
                rejectedReasonText: null,

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

                leadHistoryArchivedAt: null,
                leadHistoryBucket: null,
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

                    geoCityLabel: draftClient.geoCityLabel ?? null,
                    geoCityNormalized: draftClient.geoCityNormalized ?? null,
                    geoCluster: draftClient.geoCluster ?? null,
                    geoSource: draftClient.geoSource ?? null,
                    geoResolvedAt: draftClient.geoResolvedAt ?? null,
                    geoDistanceToHubKm: draftClient.geoDistanceToHubKm ?? null,
                    geoOutOfCoverage:
                        typeof draftClient.geoOutOfCoverage === "boolean"
                            ? draftClient.geoOutOfCoverage
                            : null,
                    geoConfidence: draftClient.geoConfidence ?? null,
                    geoNearestHubKey: draftClient.geoNearestHubKey ?? null,
                    geoNearestHubLabel: draftClient.geoNearestHubLabel ?? null,

                    geoAdminCityLabel: draftClient.geoAdminCityLabel ?? null,
                    geoAdminCityNormalized: draftClient.geoAdminCityNormalized ?? null,
                    geoAdminStateLabel: draftClient.geoAdminStateLabel ?? null,
                    geoAdminStateNormalized: draftClient.geoAdminStateNormalized ?? null,
                    geoAdminCountryLabel: draftClient.geoAdminCountryLabel ?? null,
                    geoAdminCountryNormalized: draftClient.geoAdminCountryNormalized ?? null,
                    geoAdminSource: draftClient.geoAdminSource ?? null,
                    geoAdminResolvedAt: draftClient.geoAdminResolvedAt ?? null,
                    geoAdminDisplayLabel: draftClient.geoAdminDisplayLabel ?? null,
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

        const mergedCoords = pickBetterCoords(
            prev.lat,
            prev.lng,
            lat,
            lng,
            hasMapsInThisMessage
        );

        const mergedLeadQuality = pickLeadQuality(prev.leadQuality, leadQuality);
        const mergedTrackGoGeoFields = pickTrackGoGeoFields(
            prev,
            resolvedTrackGoGeo,
            hasMapsInThisMessage
        );
        const mergedReverseGeoFields = pickReverseGeoFields(
            prev,
            resolvedReverseGeo,
            hasMapsInThisMessage
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
            leadQuality: mergedLeadQuality,

            notSuitableReason:
                mergedLeadQuality === "not_suitable"
                    ? (
                        safeString(prev.notSuitableReason || "") ||
                        safeString(notSuitableReason || "")
                    )
                    : "",

            address: pickBetterAddress(
                prev.address,
                parsed.parsedAddress || locationAddress
            ),

            mapsUrl: pickBetterMapsUrl(
                prev.mapsUrl,
                generatedMapsUrl,
                hasMapsInThisMessage
            ),

            lat: mergedCoords.lat,
            lng: mergedCoords.lng,

            currentLeadMapsConfirmedAt: hasMapsInThisMessage
                ? now
                : safeNumber(prev.currentLeadMapsConfirmedAt, 0),

            lastInboundIntent: inboundIntent,
            ...mergedTrackGoGeoFields,
            ...mergedReverseGeoFields,
        };

        const finalParseStatus = getFinalParseStatus(mergedClientBase);

        const computedVerificationStatus = getVerificationStatusFromLead({
            parseStatus: finalParseStatus,
            leadQuality: mergedClientBase.leadQuality,
        });

        const nextVerificationStatus = pickVerificationStatus(
            prev.verificationStatus,
            computedVerificationStatus,
            mergedClientBase.leadQuality,
            finalParseStatus
        );

        const prevVerificationStatus = safeString(prev.verificationStatus || "");
        const verificationStatusChangedAt =
            prevVerificationStatus !== safeString(nextVerificationStatus)
                ? now
                : safeNumber(prev.verificationStatusChangedAt, 0);

        const mergedClient = {
            ...mergedClientBase,
            verificationStatus: nextVerificationStatus,
            verificationStatusChangedAt,
        };

        const historyPatch = buildHistoryClearPatchForVerificationStatus(
            mergedClient.verificationStatus
        );

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
            verificationStatusChangedAt: mergedClient.verificationStatusChangedAt,

            address: mergedClient.address,
            mapsUrl: mergedClient.mapsUrl,
            lat: mergedClient.lat,
            lng: mergedClient.lng,
            currentLeadMapsConfirmedAt: mergedClient.currentLeadMapsConfirmedAt,
            parseStatus: finalParseStatus,

            geoCityLabel: mergedClient.geoCityLabel ?? null,
            geoCityNormalized: mergedClient.geoCityNormalized ?? null,
            geoCluster: mergedClient.geoCluster ?? null,
            geoSource: mergedClient.geoSource ?? null,
            geoResolvedAt: mergedClient.geoResolvedAt ?? null,
            geoDistanceToHubKm: mergedClient.geoDistanceToHubKm ?? null,
            geoOutOfCoverage:
                typeof mergedClient.geoOutOfCoverage === "boolean"
                    ? mergedClient.geoOutOfCoverage
                    : null,
            geoConfidence: mergedClient.geoConfidence ?? null,
            geoNearestHubKey: mergedClient.geoNearestHubKey ?? null,
            geoNearestHubLabel: mergedClient.geoNearestHubLabel ?? null,

            geoAdminCityLabel: mergedClient.geoAdminCityLabel ?? null,
            geoAdminCityNormalized: mergedClient.geoAdminCityNormalized ?? null,
            geoAdminStateLabel: mergedClient.geoAdminStateLabel ?? null,
            geoAdminStateNormalized: mergedClient.geoAdminStateNormalized ?? null,
            geoAdminCountryLabel: mergedClient.geoAdminCountryLabel ?? null,
            geoAdminCountryNormalized: mergedClient.geoAdminCountryNormalized ?? null,
            geoAdminSource: mergedClient.geoAdminSource ?? null,
            geoAdminResolvedAt: mergedClient.geoAdminResolvedAt ?? null,
            geoAdminDisplayLabel: mergedClient.geoAdminDisplayLabel ?? null,

            verifiedAt: prev.verifiedAt ?? null,
            verifiedBy: prev.verifiedBy ?? null,
            manualReviewNote: prev.manualReviewNote ?? null,

            initialIntroSentAt: safeNumber(prev.initialIntroSentAt, 0),
            lastBotReplyAt: safeNumber(prev.lastBotReplyAt, 0),
            lastBotReplyText: safeString(prev.lastBotReplyText || ""),
            lastBotStage: safeString(prev.lastBotStage || ""),
            lastOutboundAt: safeNumber(prev.lastOutboundAt, 0),

            chatMode: safeString(prev.chatMode || "bot"),
            botPausedAt: safeNumber(prev.botPausedAt, 0),
            botPausedBy: safeString(prev.botPausedBy || ""),
            humanTakeoverAt: safeNumber(prev.humanTakeoverAt, 0),
            humanTakeoverBy: safeString(prev.humanTakeoverBy || ""),
            resumeBotAt: safeNumber(prev.resumeBotAt, 0),
            resumeBotBy: safeString(prev.resumeBotBy || ""),
            lastManualReplyAt: safeNumber(prev.lastManualReplyAt, 0),
            lastManualReplyText: safeString(prev.lastManualReplyText || ""),
            lastManualReplyBy: safeString(prev.lastManualReplyBy || ""),

            ...historyPatch,
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

                geoCityLabel: mergedClient.geoCityLabel ?? null,
                geoCityNormalized: mergedClient.geoCityNormalized ?? null,
                geoCluster: mergedClient.geoCluster ?? null,
                geoSource: mergedClient.geoSource ?? null,
                geoResolvedAt: mergedClient.geoResolvedAt ?? null,
                geoDistanceToHubKm: mergedClient.geoDistanceToHubKm ?? null,
                geoOutOfCoverage:
                    typeof mergedClient.geoOutOfCoverage === "boolean"
                        ? mergedClient.geoOutOfCoverage
                        : null,
                geoConfidence: mergedClient.geoConfidence ?? null,
                geoNearestHubKey: mergedClient.geoNearestHubKey ?? null,
                geoNearestHubLabel: mergedClient.geoNearestHubLabel ?? null,

                geoAdminCityLabel: mergedClient.geoAdminCityLabel ?? null,
                geoAdminCityNormalized: mergedClient.geoAdminCityNormalized ?? null,
                geoAdminStateLabel: mergedClient.geoAdminStateLabel ?? null,
                geoAdminStateNormalized: mergedClient.geoAdminStateNormalized ?? null,
                geoAdminCountryLabel: mergedClient.geoAdminCountryLabel ?? null,
                geoAdminCountryNormalized: mergedClient.geoAdminCountryNormalized ?? null,
                geoAdminSource: mergedClient.geoAdminSource ?? null,
                geoAdminResolvedAt: mergedClient.geoAdminResolvedAt ?? null,
                geoAdminDisplayLabel: mergedClient.geoAdminDisplayLabel ?? null,
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