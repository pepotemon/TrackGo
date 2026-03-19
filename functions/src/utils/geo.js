const {
    safeString,
    safeLower,
    safeNumber,
    cleanupExtractedText,
    normalizeLooseText,
} = require("./text");

function dayKeyFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function dayKeyFromMs(ms) {
    return dayKeyFromDate(new Date(ms));
}

function isLikelyCep(text) {
    return /\b\d{5}\-?\d{3}\b/.test(text || "");
}

function roundCoord(v) {
    const n = safeNumber(v, NaN);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 1000000) / 1000000;
}

function hasValidCoords(lat, lng) {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
    );
}

function buildGoogleMapsUrlFromCoords(lat, lng) {
    if (!hasValidCoords(lat, lng)) return "";
    return `https://www.google.com/maps?q=${lat},${lng}`;
}

function looksLikeMapsUrl(url) {
    const u = safeLower(url);
    return (
        u.includes("google.com/maps") ||
        u.includes("maps.app.goo.gl") ||
        u.includes("goo.gl/maps") ||
        u.includes("maps.google.com") ||
        u.includes("share.google/")
    );
}

function extractGoogleMapsUrlFromText(text) {
    const source = safeString(text);
    if (!source) return "";

    const matches = source.match(/(https?:\/\/[^\s]+)/gi) || [];

    for (const raw of matches) {
        const cleaned = cleanupExtractedText(raw).replace(/[)\],.;]+$/g, "");
        if (looksLikeMapsUrl(cleaned)) return cleaned;
    }

    return "";
}

function looksLikeAddressPattern(text) {
    const s = normalizeLooseText(text);
    if (!s) return false;

    return (
        s.includes("rua ") ||
        s.includes("av ") ||
        s.includes("av. ") ||
        s.includes("avenida") ||
        s.includes("travessa") ||
        s.includes("tv ") ||
        s.includes("rod ") ||
        s.includes("rod.") ||
        s.includes("rodovia") ||
        s.includes("alameda") ||
        s.includes("estrada") ||
        s.includes("bairro") ||
        s.includes("numero ") ||
        s.includes("número ") ||
        s.includes("nº") ||
        s.includes("cep ") ||
        isLikelyCep(s)
    );
}

function looksLikeKnownRegionMention(text) {
    const s = normalizeLooseText(text);
    if (!s) return false;

    return (
        s.includes("goias") ||
        s.includes("goiás") ||
        s.includes("goiania") ||
        s.includes("goiânia") ||
        s.includes("belem") ||
        s.includes("belém") ||
        s.includes("ananindeua") ||
        s.includes("marituba") ||
        s.includes("castanhal") ||
        s.includes("parque verde") ||
        s.includes("coqueiro") ||
        s.includes("cidade nova") ||
        s.includes("manaus") ||
        s.includes("macaiba") ||
        s.includes("macaíba") ||
        s.includes("zona norte") ||
        s.includes("belo horizonte") ||
        s.includes("curitiba") ||
        s.includes("recife") ||
        s.includes("natal") ||
        s.includes("sao luis") ||
        s.includes("são luís") ||
        s.includes("brasilia") ||
        s.includes("brasília") ||
        s.includes(" - pa") ||
        s.includes("/pa") ||
        s.includes(" - go") ||
        s.includes("/go") ||
        s.includes(" - rn") ||
        s.includes("/rn") ||
        s.includes(" - am") ||
        s.includes("/am") ||
        s.includes(" - ma") ||
        s.includes("/ma") ||
        s.includes(" - mg") ||
        s.includes("/mg") ||
        s.includes(" - pr") ||
        s.includes("/pr") ||
        s.includes(" - pe") ||
        s.includes("/pe") ||
        s.includes(" - df") ||
        s.includes("/df")
    );
}

function looksLikeBrazilAddress(text) {
    const s = normalizeLooseText(text);
    if (!s) return false;

    if (looksLikeAddressPattern(s)) return true;

    const hasNumber = /\b\d{1,6}\b/.test(s);
    if (looksLikeKnownRegionMention(s) && hasNumber) return true;

    return false;
}

module.exports = {
    dayKeyFromDate,
    dayKeyFromMs,
    isLikelyCep,
    roundCoord,
    hasValidCoords,
    buildGoogleMapsUrlFromCoords,
    looksLikeMapsUrl,
    extractGoogleMapsUrlFromText,
    looksLikeAddressPattern,
    looksLikeKnownRegionMention,
    looksLikeBrazilAddress,
};