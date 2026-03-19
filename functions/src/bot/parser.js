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

        const nonEmptyLines = lines.filter(Boolean);
        const extractedMapsUrl = extractGoogleMapsUrlFromText(text);
        const hasMapsCandidate = !!extractedMapsUrl;

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
            "local do comercio",
            "local do comércio",
            "maps",
            "google maps",
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
            "trabalho com",
            "trabalhamos com",
            "vendo",
            "venda de",
            "vendas de",
            "tenho um",
            "tenho uma",
            "tenho",
            "trabalho com",
            "trabalhamos com",
            "vendo",
            "vendas de",
            "trabalho vendendo",
            "tenho um box",
            "tenho uma loja",
            "tenho uma banca",
            "tenho uma barraca",
            "tenho um espetinho",
            "sou lojista",
            "meu comercio",
            "meu comércio",
            "meu negocio",
            "meu negócio",
        ]);

        let explicitName = sanitizeExplicitPersonName(parsedNameLabeled);
        let finalAddress = sanitizeAddress(parsedAddressLabeled);
        let businessRaw = sanitizeBusiness(parsedBusinessLabeled);
        let finalBusiness = normalizeBusinessLabel(parsedBusinessLabeled);

        if (!finalAddress) {
            const addrLine = nonEmptyLines.find((line) => {
                if (!line) return false;
                return looksLikeBrazilAddress(line);
            });

            if (addrLine) {
                finalAddress = sanitizeAddress(addrLine);
            }
        }

        if (!businessRaw) {
            const businessLine = nonEmptyLines.find((line) => {
                if (!line) return false;
                if (looksLikeBrazilAddress(line)) return false;
                if (extractGoogleMapsUrlFromText(line)) return false;
                return isLikelyBusinessLine(line);
            });

            if (businessLine) {
                businessRaw = sanitizeBusiness(businessLine);
                finalBusiness = normalizeBusinessLabel(businessLine) || businessRaw;
            }
        }

        if (!businessRaw) {
            const fallbackBusinessLine = nonEmptyLines.find((line) => {
                if (!line) return false;
                if (looksLikeBrazilAddress(line)) return false;
                if (extractGoogleMapsUrlFromText(line)) return false;
                return isPossibleBusinessFallbackText(line);
            });

            if (fallbackBusinessLine) {
                businessRaw = sanitizeBusiness(fallbackBusinessLine);
                finalBusiness = normalizeBusinessLabel(fallbackBusinessLine) || businessRaw;
            }
        }

        if (!explicitName) {
            const possibleName = nonEmptyLines.find((line) => {
                if (!line) return false;
                if (looksLikeBrazilAddress(line)) return false;
                if (extractGoogleMapsUrlFromText(line)) return false;
                if (isLikelyBusinessLine(line)) return false;
                if (isPossibleBusinessFallbackText(line)) return false;
                return looksLikePersonName(line);
            });

            if (possibleName) {
                explicitName = sanitizeExplicitPersonName(possibleName);
            }
        }

        const fallbackName = sanitizeFallbackProfileName(fallbackProfileName);
        const finalName = explicitName || fallbackName || "";
        const hasBusiness = !!(finalBusiness || businessRaw);
        const hasAddressCandidate = !!finalAddress;
        const hasWrittenAddressWithoutMaps = hasAddressCandidate && !hasMapsCandidate;

        const profileFlags = detectUnsupportedProfileSignals(text);
        const {
            profileType,
            leadQuality,
            notSuitableReason,
        } = classifyProfileFromFlags(profileFlags);

        const businessQuality = classifyBusinessQuality(text, finalBusiness, businessRaw);
        const businessFlags =
            typeof getBusinessFlags === "function"
                ? getBusinessFlags(text, finalBusiness, businessRaw)
                : [];

        const messageParseStatus =
            hasMapsCandidate
                ? "ready"
                : hasBusiness || hasAddressCandidate || !!finalName
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
            extractedMapsUrl: extractedMapsUrl || "",
            hasMapsCandidate,
            hasAddressCandidate,
            hasWrittenAddressWithoutMaps,
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