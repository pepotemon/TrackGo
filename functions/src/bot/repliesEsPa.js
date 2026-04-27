const { safeString, safeNumber, normalizeLooseText } = require("../utils/text");
const {
    extractGoogleMapsUrlFromText,
    looksLikeBrazilAddress,
} = require("../utils/geo");
const {
    isCoverageQuestion,
    isHowItWorksQuestion,
    isUrgencyText,
    isAmountQuestion,
    isGenericOutOfFlowQuestion,
} = require("./intents");

function buildIntroMessageEsPa() {
    return [
        "Hola, gracias por contactarnos.",
        "",
        "Trabajamos con microcredito comercial para duenos de negocios activos.",
        "",
        "Para continuar tu analisis, enviame por favor:",
        "1. Tipo de negocio",
        "2. Ubicacion del negocio en Google Maps",
        "3. Nombre completo (opcional)",
        "",
        "Por ahora no atendemos jubilados, pensionados, asalariados, conductores de app o personas sin negocio activo.",
        "",
        "Cuando envies esos datos, los pasamos al responsable de tu region.",
    ].join("\n");
}

function buildHowItWorksSnippetEsPa() {
    return [
        "Funciona asi:",
        "1. Hacemos un analisis inicial del registro.",
        "2. Luego lo pasamos al responsable de tu region.",
        "3. Esa persona te contacta para explicar valores, condiciones y proximos pasos.",
        "4. La aprobacion depende del analisis y de la visita al negocio.",
    ].join("\n");
}

function buildCoverageReplyEsPa() {
    return [
        "Atendemos por region.",
        "",
        "Para confirmar cobertura necesito verificar la ubicacion exacta del negocio.",
        "",
        "Enviame por favor:",
        "1. Tipo de negocio",
        "2. Ubicacion del negocio en Google Maps",
        "3. Nombre completo (opcional)",
    ].join("\n");
}

function buildAmountReplyEsPa() {
    return [
        "El monto no se define aqui en el chat.",
        "",
        "Depende del analisis del negocio, la ubicacion y la visita del responsable de tu region.",
    ].join("\n");
}

function buildNotSuitableReplyEsPa(reason) {
    return [
        "Gracias por contactarnos.",
        "",
        "Por ahora trabajamos solo con duenos de negocios activos.",
        reason ? `Motivo identificado: ${reason}.` : "",
        "",
        "Por eso no podemos continuar el analisis con este perfil.",
        "Gracias por tu interes.",
    ].filter(Boolean).join("\n");
}

function buildShortAckPrefix(messageType) {
    if (messageType === "location") return "Perfecto, recibi tu ubicacion.";
    return "Perfecto.";
}

function buildShortMissingBusinessReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Ahora solo falta el tipo de negocio para completar tu registro.",
        "Por ejemplo: tienda, restaurante, salon de belleza, taller, ferreteria u otro negocio activo.",
    ].join("\n");
}

function buildShortMissingMapsReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Ahora solo falta la ubicacion del negocio en Google Maps.",
        "Puede ser la ubicacion fija de la residencia o del punto de trabajo.",
    ].join("\n");
}

function buildShortMissingBothReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Para continuar, todavia necesito el tipo de negocio y la ubicacion en Google Maps.",
    ].join("\n");
}

function buildAutomaticStillMissingReply({ hasBusiness, hasMaps }) {
    if (!hasBusiness && !hasMaps) {
        return [
            "Disculpa, soy una asistente automatica.",
            "",
            "Para pasarte con una persona del equipo, todavia necesito:",
            "- Tipo de negocio",
            "- Ubicacion en Google Maps",
        ].join("\n");
    }

    if (!hasBusiness) {
        return [
            "Disculpa, soy una asistente automatica.",
            "",
            "Para completar tu registro, todavia necesito el tipo de negocio.",
        ].join("\n");
    }

    if (!hasMaps) {
        return [
            "Disculpa, soy una asistente automatica.",
            "",
            "Para continuar, todavia necesito la ubicacion en Google Maps.",
        ].join("\n");
    }

    return [
        "Disculpa, soy una asistente automatica.",
        "",
        "Tu registro ya fue enviado a analisis inicial.",
    ].join("\n");
}

function looksLikeManualAddressWithoutGoogleMaps(text) {
    const raw = safeString(text);
    if (!raw) return false;

    if (extractGoogleMapsUrlFromText(raw)) return false;
    if (looksLikeBrazilAddress(raw)) return true;

    const s = normalizeLooseText(raw);

    return (
        s.includes("direccion") ||
        s.includes("ubicacion") ||
        s.includes("barrio") ||
        s.includes("calle ") ||
        s.includes("avenida") ||
        s.includes("localizacion")
    );
}

function buildMapsMustBeGoogleMapsReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Pero la ubicacion debe ser enviada desde Google Maps.",
        "Una direccion escrita sola no confirma la ubicacion exacta.",
        "",
        "Por favor abre Google Maps, busca tu negocio, toca Compartir y enviame el enlace aqui.",
    ].join("\n");
}

function createBotReplyBuilderEsPa({
    hasUsefulBusiness,
    hasRequiredMapsForFlow,
}) {
    return function buildBotReplyEsPa({ client, messageType }) {
        const hasBusiness = hasUsefulBusiness(client);
        const hasMaps = hasRequiredMapsForFlow(client);
        const introAlreadySent = safeNumber(client?.initialIntroSentAt, 0) > 0;

        const leadQuality = safeString(client?.leadQuality || "");
        const notSuitableReason = safeString(client?.notSuitableReason || "");
        const lastText = safeString(client?.lastInboundText || "");

        const coverageIntent = isCoverageQuestion(lastText);
        const howItWorksIntent = isHowItWorksQuestion(lastText);
        const urgencyIntent = isUrgencyText(lastText);
        const amountIntent = isAmountQuestion(lastText);
        const genericQuestionIntent = isGenericOutOfFlowQuestion(lastText);

        const inboundHasGoogleMapsLink = !!extractGoogleMapsUrlFromText(lastText);
        const inboundLooksLikeWrittenAddress = looksLikeManualAddressWithoutGoogleMaps(lastText);
        const sentWrittenAddressInsteadOfMaps =
            !hasMaps && !inboundHasGoogleMapsLink && inboundLooksLikeWrittenAddress;

        if (leadQuality === "not_suitable") {
            return {
                body: buildNotSuitableReplyEsPa(notSuitableReason),
                stage: "final:not_suitable",
                markIntroSent: introAlreadySent,
            };
        }

        if (!introAlreadySent) {
            if (howItWorksIntent) {
                return {
                    body: [buildIntroMessageEsPa(), "", buildHowItWorksSnippetEsPa()].join("\n"),
                    stage: "intro:how_it_works",
                    markIntroSent: true,
                };
            }

            if (coverageIntent) {
                return {
                    body: [buildIntroMessageEsPa(), "", buildCoverageReplyEsPa()].join("\n"),
                    stage: "intro:coverage",
                    markIntroSent: true,
                };
            }

            if (amountIntent) {
                return {
                    body: [buildIntroMessageEsPa(), "", buildAmountReplyEsPa()].join("\n"),
                    stage: "intro:amount",
                    markIntroSent: true,
                };
            }

            return {
                body: buildIntroMessageEsPa(),
                stage: genericQuestionIntent ? "intro:generic_question" : "intro",
                markIntroSent: true,
            };
        }

        if (howItWorksIntent) {
            return {
                body: [
                    buildHowItWorksSnippetEsPa(),
                    "",
                    hasBusiness && hasMaps
                        ? "Tu registro ya fue enviado a analisis inicial."
                        : "Para continuar, necesito completar los datos del negocio.",
                ].join("\n"),
                stage: `how_it_works:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}`,
                markIntroSent: false,
            };
        }

        if (coverageIntent) {
            return {
                body: [
                    buildCoverageReplyEsPa(),
                    "",
                    hasMaps
                        ? "Con esa ubicacion podemos seguir con el analisis inicial."
                        : "Ahora necesito la ubicacion del negocio en Google Maps.",
                ].join("\n"),
                stage: `coverage_check:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}`,
                markIntroSent: false,
            };
        }

        if (amountIntent) {
            return {
                body: [
                    buildAmountReplyEsPa(),
                    "",
                    hasBusiness && hasMaps
                        ? "Cuando el equipo analice tu registro, te explica los proximos pasos."
                        : "Para continuar, necesito completar los datos del negocio.",
                ].join("\n"),
                stage: `amount_check:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}`,
                markIntroSent: false,
            };
        }

        if (genericQuestionIntent && !(hasBusiness && hasMaps)) {
            return {
                body: buildAutomaticStillMissingReply({ hasBusiness, hasMaps }),
                stage: `fallback:auto:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}`,
                markIntroSent: false,
            };
        }

        if (!hasMaps && sentWrittenAddressInsteadOfMaps) {
            return {
                body: buildMapsMustBeGoogleMapsReply(messageType),
                stage: hasBusiness
                    ? "missing:maps:written_address"
                    : "missing:business,maps:written_address",
                markIntroSent: false,
            };
        }

        if (hasMaps && !hasBusiness) {
            return {
                body: buildShortMissingBusinessReply(messageType),
                stage: "ready:missing_business",
                markIntroSent: false,
            };
        }

        if (hasBusiness && hasMaps) {
            return {
                body: [
                    "Ok, muchas gracias.",
                    "",
                    "Voy a enviar la informacion al responsable de tu region.",
                    urgencyIntent
                        ? "Como indicaste urgencia, el responsable lo revisara lo antes posible."
                        : "La respuesta normalmente toma entre 24 y 48 horas, y a veces puede ser antes.",
                    "",
                    "Muchas gracias.",
                ].join("\n"),
                stage: "final",
                markIntroSent: false,
            };
        }

        if (!hasBusiness && !hasMaps) {
            return {
                body: buildShortMissingBothReply(messageType),
                stage: "missing:business,maps",
                markIntroSent: false,
            };
        }

        if (!hasBusiness) {
            return {
                body: buildShortMissingBusinessReply(messageType),
                stage: "missing:business",
                markIntroSent: false,
            };
        }

        return {
            body: buildShortMissingMapsReply(messageType),
            stage: "missing:maps",
            markIntroSent: false,
        };
    };
}

module.exports = {
    buildIntroMessageEsPa,
    createBotReplyBuilderEsPa,
};
