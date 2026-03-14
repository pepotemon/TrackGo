const {
    cleanupExtractedText,
    normalizeLooseText,
    onlyDigits,
} = require("../utils/text");
const {
    extractGoogleMapsUrlFromText,
    looksLikeBrazilAddress,
} = require("../utils/geo");

function isClearlyNotPersonText(text) {
    const s = normalizeLooseText(text);

    if (!s) return false;

    return (
        s.includes("venda de") ||
        s.includes("loja de") ||
        s.includes("comercio de") ||
        s.includes("comércio de") ||
        s.includes("casa de") ||
        s.includes("distribuidora de") ||
        s.includes("revenda de") ||
        s.includes("studio de") ||
        s.includes("atelier de") ||
        s.includes("motorista de aplicativo") ||
        s.includes("trabalho de aplicativo") ||
        s.includes("trabalha de aplicativo") ||
        s.includes("uber") ||
        s.includes("99pop") ||
        s.includes("ifood") ||
        s.includes("rappi") ||
        s.includes("loggi") ||
        s.includes("motoboy") ||
        s.includes("entregador") ||
        s.includes("aposentado") ||
        s.includes("aposentada") ||
        s.includes("pensionista") ||
        s.includes("assalariado") ||
        s.includes("assalariada") ||
        s.includes("carteira assinada") ||
        s.includes("clt") ||
        s.includes("como funciona") ||
        s.includes("tenho interesse") ||
        s.includes("quero saber") ||
        s.includes("quero informacoes") ||
        s.includes("quero informações") ||
        s.includes("tipo de comercio") ||
        s.includes("tipo de comércio") ||
        s.includes("tipo de negocio") ||
        s.includes("tipo de negócio") ||
        s.includes("negocio") ||
        s.includes("negócio") ||
        s.includes("endereco") ||
        s.includes("endereço") ||
        s.includes("localizacao") ||
        s.includes("localização") ||
        s.includes("google maps")
    );
}

function stripCommonNameLabels(value) {
    const raw = cleanupExtractedText(value || "");
    if (!raw) return "";

    return raw
        .replace(/^(nome completo|nome|meu nome)\s*[:\-]\s*/i, "")
        .replace(/^(me chamo|sou)\s+/i, "")
        .trim();
}

function hasTooManyWordsLikeSentence(value) {
    const words = cleanupExtractedText(value || "")
        .split(/\s+/)
        .filter(Boolean);

    return words.length > 5;
}

function hasSuspiciousSentenceMarkers(value) {
    const s = normalizeLooseText(value);
    if (!s) return false;

    return (
        s.includes(" e tenho ") ||
        s.includes(" e trabalho ") ||
        s.includes(" trabalho com ") ||
        s.includes(" moro ") ||
        s.includes(" fica ") ||
        s.includes(" estamos ") ||
        s.includes(" meu comercio ") ||
        s.includes(" meu comércio ") ||
        s.includes(" minha loja ") ||
        s.includes(" meu negocio ") ||
        s.includes(" meu negócio ")
    );
}

function isBadProfileNameFactory({ isLikelyBusinessLine }) {
    return function isBadProfileName(name) {
        const v = cleanupExtractedText(name);
        const s = normalizeLooseText(v);

        if (!v) return true;
        if (v.length <= 1) return true;
        if (v.length > 80) return true;
        if (/^[\.\-_]+$/i.test(v)) return true;
        if (/^\d+$/.test(v)) return true;
        if (/^[a-z0-9\.\-_]{1,3}$/i.test(v)) return true;

        if (
            s === "m" ||
            s === "-m" ||
            s === "." ||
            s === ".." ||
            s === "..." ||
            s === "-" ||
            s === "--"
        ) {
            return true;
        }

        if (
            looksLikeBrazilAddress(v) ||
            isLikelyBusinessLine(v) ||
            isClearlyNotPersonText(v) ||
            hasSuspiciousSentenceMarkers(v) ||
            extractGoogleMapsUrlFromText(v) ||
            s.includes("setup guidance") ||
            s.includes("continue setting up") ||
            s.includes("whatsapp business")
        ) {
            return true;
        }

        return false;
    };
}

function sanitizeExplicitPersonNameFactory({ isLikelyBusinessLine }) {
    return function sanitizeExplicitPersonName(name) {
        const explicit = stripCommonNameLabels(name || "");
        if (!explicit) return "";

        const s = normalizeLooseText(explicit);

        if (
            looksLikeBrazilAddress(explicit) ||
            isLikelyBusinessLine(explicit) ||
            isClearlyNotPersonText(explicit) ||
            hasSuspiciousSentenceMarkers(explicit) ||
            extractGoogleMapsUrlFromText(explicit) ||
            s.includes("http://") ||
            s.includes("https://") ||
            explicit.length > 80 ||
            explicit.length < 2 ||
            /^\d+$/.test(explicit) ||
            /^[\.\-_]+$/i.test(explicit) ||
            hasTooManyWordsLikeSentence(explicit)
        ) {
            return "";
        }

        return explicit;
    };
}

function sanitizeFallbackProfileNameFactory({ isBadProfileName }) {
    return function sanitizeFallbackProfileName(name) {
        const fallback = cleanupExtractedText(name || "");
        if (fallback && !isBadProfileName(fallback)) {
            return fallback;
        }
        return "";
    };
}

function looksLikePersonNameFactory({
    isLikelyBusinessLine,
    looksLikeGreetingOrInterestText,
}) {
    return function looksLikePersonName(line) {
        const v = stripCommonNameLabels(line);
        const s = normalizeLooseText(v);

        if (!v) return false;
        if (v.length < 2 || v.length > 60) return false;
        if (looksLikeBrazilAddress(v)) return false;
        if (isLikelyBusinessLine(v)) return false;
        if (isClearlyNotPersonText(v)) return false;
        if (hasSuspiciousSentenceMarkers(v)) return false;
        if (extractGoogleMapsUrlFromText(v)) return false;
        if (onlyDigits(v).length >= 8) return false;
        if (s.includes("http://") || s.includes("https://")) return false;
        if (s.includes("tipo de comercio") || s.includes("tipo de comércio")) return false;
        if (s.includes("tipo de negocio") || s.includes("tipo de negócio")) return false;
        if (s.includes("negocio") || s.includes("negócio")) return false;
        if (s.includes("endereco") || s.includes("endereço")) return false;
        if (s.includes("localizacao") || s.includes("localização")) return false;
        if (s.includes("google maps")) return false;
        if (s.includes("motorista")) return false;
        if (s.includes("aplicativo")) return false;
        if (s.includes("uber")) return false;
        if (s.includes("aposentado") || s.includes("aposentada")) return false;
        if (s.includes("pensionista")) return false;
        if (looksLikeGreetingOrInterestText(v)) return false;
        if (/[!?]/.test(v)) return false;
        if (v.split(" ").length > 5) return false;
        if (!/[a-zA-ZÀ-ÿ]/.test(v)) return false;

        return true;
    };
}

function resolveNextClientNameFactory({
    isBadProfileName,
    sanitizeFallbackProfileName,
}) {
    return function resolveNextClientName({ prevName, profileName }) {
        const prevClean = cleanupExtractedText(prevName || "");
        const prevIsUseful = !!prevClean && !isBadProfileName(prevClean);

        if (prevIsUseful) return prevClean;

        return sanitizeFallbackProfileName(profileName || "");
    };
}

module.exports = {
    isBadProfileNameFactory,
    sanitizeExplicitPersonNameFactory,
    sanitizeFallbackProfileNameFactory,
    looksLikePersonNameFactory,
    resolveNextClientNameFactory,
};