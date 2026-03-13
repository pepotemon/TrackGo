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
        s.includes("quero informações")
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
        const explicit = cleanupExtractedText(name || "");
        if (!explicit) return "";

        const s = normalizeLooseText(explicit);

        if (
            looksLikeBrazilAddress(explicit) ||
            isLikelyBusinessLine(explicit) ||
            isClearlyNotPersonText(explicit) ||
            s.includes("http://") ||
            s.includes("https://") ||
            explicit.length > 80 ||
            /^\d+$/.test(explicit) ||
            /^[\.\-_]+$/i.test(explicit)
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
        const v = cleanupExtractedText(line);
        const s = normalizeLooseText(v);

        if (!v) return false;
        if (v.length < 2 || v.length > 60) return false;
        if (looksLikeBrazilAddress(v)) return false;
        if (isLikelyBusinessLine(v)) return false;
        if (isClearlyNotPersonText(v)) return false;
        if (extractGoogleMapsUrlFromText(v)) return false;
        if (onlyDigits(v).length >= 8) return false;
        if (s.includes("http://") || s.includes("https://")) return false;
        if (s.includes("tipo de comercio") || s.includes("tipo de comércio")) return false;
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