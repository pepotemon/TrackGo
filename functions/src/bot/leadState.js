const { cleanupExtractedText, safeString, safeNumber } = require("../utils/text");
const { hasValidCoords } = require("../utils/geo");

function hasUsefulNameFactory({ isBadProfileName }) {
    return function hasUsefulName(client) {
        const v = cleanupExtractedText(client?.name || "");
        return !!v && !isBadProfileName(v);
    };
}

function hasUsefulBusiness(client) {
    const v = cleanupExtractedText(client?.business || "");
    const raw = cleanupExtractedText(client?.businessRaw || "");
    return !!v || !!raw;
}

function hasStoredMaps(client) {
    const mapsUrl = safeString(client?.mapsUrl || "");
    const lat = safeNumber(client?.lat, NaN);
    const lng = safeNumber(client?.lng, NaN);
    return !!mapsUrl || hasValidCoords(lat, lng);
}

function hasCurrentLeadMapsConfirmed(client) {
    return safeNumber(client?.currentLeadMapsConfirmedAt, 0) > 0;
}

function hasRequiredMapsForFlow(client) {
    return hasStoredMaps(client) && hasCurrentLeadMapsConfirmed(client);
}

function getMissingLeadFields(client) {
    const missing = [];

    if (!hasUsefulBusiness(client)) missing.push("business");
    if (!hasRequiredMapsForFlow(client)) missing.push("maps");

    return missing;
}

function getFinalParseStatusFactory({ hasUsefulName }) {
    return function getFinalParseStatus(client) {
        const marketCountry = safeString(client?.marketCountry || "").toUpperCase();
        const hasBusiness = hasUsefulBusiness(client);
        const hasMaps = hasRequiredMapsForFlow(client);
        const hasName = hasUsefulName(client);

        // Panama needs Maps + business type before assignment.
        if (marketCountry === "PA") {
            if (hasMaps && hasBusiness) return "ready";
            if (hasMaps || hasBusiness || hasName) return "partial";
            return "empty";
        }

        // Brazil stays permissive: Maps alone is enough for initial assignment.
        if (hasMaps) return "ready";
        if (hasBusiness || hasName) return "partial";
        return "empty";
    };
}

function getRandomHumanReplyDelayMs() {
    const min = 10_000;
    const max = 15_000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shouldSendBotReply(client) {
    const lastInbound = safeNumber(client?.lastInboundMessageAt, 0);
    if (!lastInbound) return false;

    const now = Date.now();
    const diff = now - lastInbound;

    if (diff < 0 || diff > 24 * 60 * 60 * 1000) {
        return false;
    }

    const lastBotReplyAt = safeNumber(client?.lastBotReplyAt, 0);
    const lastBotStage = safeString(client?.lastBotStage || "");
    const parseStatus = safeString(client?.parseStatus || "");
    const verificationStatus = safeString(client?.verificationStatus || "");
    const chatMode = safeString(client?.chatMode || "bot");

    if (chatMode === "human") {
        return false;
    }

    if (lastBotReplyAt > 0 && now - lastBotReplyAt < 8_000) {
        return false;
    }

    if (verificationStatus === "not_suitable" && lastBotStage === "final:not_suitable") {
        return false;
    }

    if (parseStatus === "ready" && lastBotStage.startsWith("final")) {
        return false;
    }

    return true;
}

module.exports = {
    hasUsefulNameFactory,
    hasUsefulBusiness,
    hasStoredMaps,
    hasCurrentLeadMapsConfirmed,
    hasRequiredMapsForFlow,
    getMissingLeadFields,
    getFinalParseStatusFactory,
    getRandomHumanReplyDelayMs,
    shouldSendBotReply,
};
