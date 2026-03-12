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
        const hasBusiness = hasUsefulBusiness(client);
        const hasMaps = hasRequiredMapsForFlow(client);
        const hasName = hasUsefulName(client);

        if (hasBusiness && hasMaps) return "ready";
        if (hasBusiness || hasMaps || hasName) return "partial";
        return "empty";
    };
}

function shouldSendBotReply(client) {
    const lastInbound = safeNumber(client?.lastInboundMessageAt, 0);
    if (!lastInbound) return false;

    const now = Date.now();
    const diff = now - lastInbound;
    return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
}

module.exports = {
    hasUsefulNameFactory,
    hasUsefulBusiness,
    hasStoredMaps,
    hasCurrentLeadMapsConfirmed,
    hasRequiredMapsForFlow,
    getMissingLeadFields,
    getFinalParseStatusFactory,
    shouldSendBotReply,
};