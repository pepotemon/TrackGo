const { safeString, extractLabeledValue } = require("../utils/text");
const {
    extractGoogleMapsUrlFromText,
    looksLikeBrazilAddress,
} = require("../utils/geo");
const {
    detectUnsupportedProfileSignals,
    classifyProfileFromFlags,
    getVerificationStatusFromLead,
} = require("./intents");

function createLeadParser({
    sanitizeExplicitPersonName,
    sanitizeFallbackProfileName,
    looksLikePersonName,
    sanitizeAddress,
    isLikelyBusinessLine,
    normalizeBusinessLabel,
    sanitizeBusiness,
    isPossibleBusinessFallbackText,
    classifyBusinessQuality,
    getBusinessFlags,
}) {
    return function parseLeadText(rawText, fallbackProfileName) {
        const text = safeString(rawText);

        const lines = text
            .split(/\r?\n|\|/)
            .map((x) => x.trim())
            .filter(Boolean);

        const parsedNameLabeled = extractLabeledValue(text, [
            "nome completo",
            "nome",
            "meu nome",
            "me chamo",
            "sou",
        ]);

        const parsedAddressLabeled = extractLabeledValue(text, [
            "endereco",
            "endereço",
            "localizacao",
            "localização",
            "bairro",
            "rua",
            "endereco do comercio",
            "endereço do comércio",
            "endereco da loja",
            "endereço da loja",
        ]);

        const parsedBusinessLabeled = extractLabeledValue(text, [
            "tipo de negocio",
            "tipo de negócio",
            "negocio",
            "negócio",
            "comercio",
            "comércio",
            "empresa",
            "loja",
            "ramo",
            "atividade",
        ]);

        let explicitName = sanitizeExplicitPersonName(parsedNameLabeled);
        let finalAddress = sanitizeAddress(parsedAddressLabeled);
        let businessRaw = sanitizeBusiness(parsedBusinessLabeled);
        let finalBusiness = normalizeBusinessLabel(parsedBusinessLabeled);

        const nonEmptyLines = lines.filter(Boolean);

        if (!finalAddress) {
            const addrLine = nonEmptyLines.find((line) => looksLikeBrazilAddress(line));
            if (addrLine) finalAddress = sanitizeAddress(addrLine);
        }

        if (!businessRaw) {
            const businessLine = nonEmptyLines.find((line) => isLikelyBusinessLine(line));
            if (businessLine) {
                businessRaw = sanitizeBusiness(businessLine);
                finalBusiness = normalizeBusinessLabel(businessLine);
            }
        }

        if (!businessRaw) {
            const fallbackBusinessLine = nonEmptyLines.find((line) => isPossibleBusinessFallbackText(line));
            if (fallbackBusinessLine) {
                businessRaw = sanitizeBusiness(fallbackBusinessLine);
                finalBusiness = normalizeBusinessLabel(fallbackBusinessLine) || businessRaw;
            }
        }

        if (!explicitName) {
            const possibleName = nonEmptyLines.find((line) => looksLikePersonName(line));
            if (possibleName) {
                explicitName = sanitizeExplicitPersonName(possibleName);
            }
        }

        const fallbackName = sanitizeFallbackProfileName(fallbackProfileName);
        const finalName = fallbackName || explicitName || "";
        const hasBusiness = !!finalBusiness || !!businessRaw;
        const hasMapsCandidate = !!extractGoogleMapsUrlFromText(text);

        const profileFlags = detectUnsupportedProfileSignals(text);
        const {
            profileType,
            leadQuality,
            notSuitableReason,
        } = classifyProfileFromFlags(profileFlags);

        const businessQuality = classifyBusinessQuality(text, finalBusiness, businessRaw);
        const businessFlags = typeof getBusinessFlags === "function"
            ? getBusinessFlags(text, finalBusiness, businessRaw)
            : [];

        const messageParseStatus =
            hasBusiness && hasMapsCandidate
                ? "ready"
                : hasBusiness || hasMapsCandidate || !!finalName
                    ? "partial"
                    : "empty";

        const verificationStatus = getVerificationStatusFromLead({
            parseStatus: messageParseStatus,
            leadQuality,
        });

        return {
            rawText: text,
            parsedName: finalName,
            parsedNameExplicit: explicitName || "",
            parsedAddress: finalAddress || "",
            parsedBusiness: finalBusiness || businessRaw || "",
            parsedBusinessRaw: businessRaw || finalBusiness || "",
            businessQuality,
            businessFlags,
            profileFlags,
            profileType,
            leadQuality,
            notSuitableReason,
            verificationStatus,
            parseStatus: messageParseStatus,
            messageParseStatus,
            lines,
        };
    };
}

module.exports = {
    createLeadParser,
};