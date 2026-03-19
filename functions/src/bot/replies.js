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

function buildIntroMessagePtBr() {
    return [
        "Olá 👋 Obrigado pelo contato.",
        "",
        "Trabalhamos com microcrédito comercial para lojistas e donos de comércio ativo.",
        "",
        "Para continuar sua análise, envie por favor:",
        "1️⃣ Tipo de comércio",
        "2️⃣ Localização do comércio no Google Maps",
        "3️⃣ Nome completo (opcional)",
        "",
        "⚠️ No momento não atendemos aposentados, pensionistas, assalariados, motoristas de aplicativo ou pessoas sem comércio ativo.",
        "",
        "Assim que você enviar essas informações, encaminhamos para o responsável da sua região.",
    ].join("\n");
}

function buildHowItWorksSnippetPtBr() {
    return [
        "Funciona assim:",
        "1️⃣ Fazemos uma análise inicial do cadastro.",
        "2️⃣ Depois encaminhamos para o responsável da sua região.",
        "3️⃣ Ele entra em contato para explicar valores, condições e próximos passos.",
        "4️⃣ A liberação depende da análise e da visita ao comércio.",
    ].join("\n");
}

function buildCoverageReplyPtBr() {
    return [
        "Atendemos em várias regiões do Brasil.",
        "",
        "Mas para confirmar sua região, preciso verificar a localização exata do comércio.",
        "",
        "Envie por favor:",
        "1️⃣ Tipo de comércio",
        "2️⃣ Localização do comércio no Google Maps",
        "3️⃣ Nome completo (opcional)",
    ].join("\n");
}

function buildAmountReplyPtBr() {
    return [
        "O valor não é definido aqui no chat.",
        "",
        "Ele depende da análise do comércio, da localização e da visita do responsável da sua região.",
    ].join("\n");
}

function buildOfficeLocationReplyPtBr() {
    return [
        "Atendemos em várias regiões do Brasil.",
        "",
        "Para seguir com sua análise, precisamos da localização do seu comércio no Google Maps e do tipo de comércio.",
    ].join("\n");
}

function buildNotSuitableReplyPtBr(reason) {
    return [
        "Obrigado pelo contato.",
        "",
        "No momento trabalhamos apenas com lojistas e proprietários de comércio ativo.",
        reason ? `Motivo identificado: ${reason}.` : "",
        "",
        "Por isso, infelizmente não conseguimos seguir com a análise neste perfil.",
        "Agradecemos o interesse.",
    ]
        .filter(Boolean)
        .join("\n");
}

function buildShortAckPrefix(messageType) {
    if (messageType === "location") return "Perfeito, recebi sua localização ✅";
    return "Perfeito ✅";
}

function buildShortMissingBusinessReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Seu cadastro já pode seguir para análise inicial, mas ainda preciso do tipo de comércio.",
    ].join("\n");
}

function buildShortMissingMapsReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Agora só falta a localização do comércio no Google Maps.",
        "Pode ser a localização fixa da residência ou do ponto de trabalho.",
    ].join("\n");
}

function buildShortMissingBothReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Para continuar, ainda preciso do tipo de comércio e da localização no Google Maps.",
    ].join("\n");
}

function buildAutomaticStillMissingReply({ hasBusiness, hasMaps }) {
    if (!hasBusiness && !hasMaps) {
        return [
            "Desculpe, sou uma atendente automática.",
            "",
            "Para te passar com uma pessoa da equipe, ainda preciso de:",
            "• Tipo de comércio",
            "• Localização no Google Maps",
        ].join("\n");
    }

    if (!hasBusiness) {
        return [
            "Desculpe, sou uma atendente automática.",
            "",
            "Seu cadastro já pode seguir para análise inicial, mas ainda preciso do tipo de comércio.",
        ].join("\n");
    }

    if (!hasMaps) {
        return [
            "Desculpe, sou uma atendente automática.",
            "",
            "Para continuar, ainda preciso da localização no Google Maps.",
            "Pode ser a localização fixa da residência ou do ponto de trabalho.",
        ].join("\n");
    }

    return [
        "Desculpe, sou uma atendente automática.",
        "",
        "Seu cadastro já foi encaminhado para análise inicial.",
    ].join("\n");
}

function looksLikeManualAddressWithoutGoogleMaps(text) {
    const raw = safeString(text);
    if (!raw) return false;

    if (extractGoogleMapsUrlFromText(raw)) return false;
    if (looksLikeBrazilAddress(raw)) return true;

    const s = normalizeLooseText(raw);

    return (
        s.includes("endereco") ||
        s.includes("endereço") ||
        s.includes("localizacao") ||
        s.includes("localização") ||
        s.includes("bairro") ||
        s.includes("rua ") ||
        s.includes("avenida") ||
        s.includes("av ") ||
        s.includes("av. ") ||
        s.includes("travessa") ||
        s.includes("rodovia") ||
        s.includes("cep ")
    );
}

function buildMapsMustBeGoogleMapsReply(messageType) {
    const ack = buildShortAckPrefix(messageType);

    return [
        ack,
        "",
        "Mas a localização precisa ser enviada pelo Google Maps.",
        "Endereço escrito sozinho não consegue confirmar a localização exata.",
        "",
        "Por favor, abra o Google Maps, encontre seu comércio e toque em “Compartilhar”.",
        "Depois me envie o link aqui no chat.",
    ].join("\n");
}

function buildMapsMustBeGoogleMapsReplyWithBusiness(messageType) {
    const ack = buildShortAckPrefix(messageType);

    return [
        ack,
        "",
        "Já recebi o tipo de comércio, mas a localização precisa ser enviada pelo Google Maps.",
        "Endereço escrito sozinho não consegue confirmar a localização exata.",
        "",
        "Por favor, abra o Google Maps, encontre seu comércio e toque em “Compartilhar”.",
        "Depois me envie o link aqui no chat.",
    ].join("\n");
}

function buildHowItWorksFollowup({ hasBusiness, hasMaps, sentWrittenAddressInsteadOfMaps }) {
    if (!hasBusiness && !hasMaps) {
        return "Para eu continuar agora, ainda preciso do tipo de comércio e da localização no Google Maps.";
    }

    if (!hasBusiness) {
        return "Seu cadastro já pode seguir para análise inicial, mas ainda preciso do tipo de comércio.";
    }

    if (!hasMaps && sentWrittenAddressInsteadOfMaps) {
        return "Recebi o endereço, mas preciso da localização compartilhada pelo Google Maps.";
    }

    if (!hasMaps) {
        return "Para continuar, ainda preciso da localização do comércio no Google Maps.";
    }

    return "Seu cadastro já foi encaminhado para análise inicial.";
}

function buildCoverageFollowup({ hasBusiness, hasMaps, sentWrittenAddressInsteadOfMaps }) {
    if (!hasBusiness && !hasMaps) {
        return "Ainda preciso do tipo de comércio e da localização no Google Maps.";
    }

    if (!hasBusiness) {
        return "Com a localização já consigo verificar a região, mas ainda preciso do tipo de comércio.";
    }

    if (!hasMaps && sentWrittenAddressInsteadOfMaps) {
        return "Recebi o endereço, mas para confirmar a região preciso do link ou da localização compartilhada pelo Google Maps.";
    }

    if (!hasMaps) {
        return "Agora só falta a localização do comércio no Google Maps.";
    }

    return "Com essa localização conseguimos seguir com a análise inicial.";
}

function buildAmountFollowup({ hasBusiness, hasMaps, sentWrittenAddressInsteadOfMaps }) {
    if (!hasBusiness && !hasMaps) {
        return "Para continuar, ainda preciso do tipo de comércio e da localização no Google Maps.";
    }

    if (!hasBusiness) {
        return "Seu cadastro já pode seguir para análise inicial, mas ainda preciso do tipo de comércio.";
    }

    if (!hasMaps && sentWrittenAddressInsteadOfMaps) {
        return "Recebi o endereço, mas ainda preciso da localização compartilhada pelo Google Maps.";
    }

    if (!hasMaps) {
        return "Agora só falta a localização do comércio no Google Maps.";
    }

    return "Assim que a equipe analisar, ela explica melhor os próximos passos.";
}

function createBotReplyBuilder({
    hasUsefulBusiness,
    hasRequiredMapsForFlow,
}) {
    return function buildBotReplyPtBr({ client, messageType }) {
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
                body: buildNotSuitableReplyPtBr(notSuitableReason),
                stage: "final:not_suitable",
                markIntroSent: introAlreadySent,
            };
        }

        if (!introAlreadySent) {
            if (howItWorksIntent) {
                return {
                    body: [
                        buildIntroMessagePtBr(),
                        "",
                        buildHowItWorksSnippetPtBr(),
                    ].join("\n"),
                    stage: "intro:how_it_works",
                    markIntroSent: true,
                };
            }

            if (coverageIntent) {
                return {
                    body: [
                        buildIntroMessagePtBr(),
                        "",
                        buildCoverageReplyPtBr(),
                    ].join("\n"),
                    stage: "intro:coverage",
                    markIntroSent: true,
                };
            }

            if (amountIntent) {
                return {
                    body: [
                        buildIntroMessagePtBr(),
                        "",
                        buildAmountReplyPtBr(),
                    ].join("\n"),
                    stage: "intro:amount",
                    markIntroSent: true,
                };
            }

            if (genericQuestionIntent) {
                return {
                    body: [
                        buildIntroMessagePtBr(),
                        "",
                        "Sou uma atendente automática.",
                        "Para te encaminhar para uma pessoa real, preciso desses dados acima.",
                    ].join("\n"),
                    stage: "intro:generic_question",
                    markIntroSent: true,
                };
            }

            return {
                body: buildIntroMessagePtBr(),
                stage: "intro",
                markIntroSent: true,
            };
        }

        if (howItWorksIntent) {
            return {
                body: [
                    buildHowItWorksSnippetPtBr(),
                    "",
                    buildHowItWorksFollowup({
                        hasBusiness,
                        hasMaps,
                        sentWrittenAddressInsteadOfMaps,
                    }),
                ].join("\n"),
                stage: `how_it_works:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}:${sentWrittenAddressInsteadOfMaps ? "written_address" : "normal"}`,
                markIntroSent: false,
            };
        }

        if (coverageIntent) {
            const baseCoverageReply = hasBusiness && !hasMaps
                ? buildOfficeLocationReplyPtBr()
                : buildCoverageReplyPtBr();

            return {
                body: [
                    baseCoverageReply,
                    "",
                    buildCoverageFollowup({
                        hasBusiness,
                        hasMaps,
                        sentWrittenAddressInsteadOfMaps,
                    }),
                ].join("\n"),
                stage: `coverage_check:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}:${sentWrittenAddressInsteadOfMaps ? "written_address" : "normal"}`,
                markIntroSent: false,
            };
        }

        if (amountIntent) {
            return {
                body: [
                    buildAmountReplyPtBr(),
                    "",
                    buildAmountFollowup({
                        hasBusiness,
                        hasMaps,
                        sentWrittenAddressInsteadOfMaps,
                    }),
                ].join("\n"),
                stage: `amount_check:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}:${sentWrittenAddressInsteadOfMaps ? "written_address" : "normal"}`,
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

        if (!hasMaps && sentWrittenAddressInsteadOfMaps && hasBusiness) {
            return {
                body: buildMapsMustBeGoogleMapsReplyWithBusiness(messageType),
                stage: "missing:maps:written_address",
                markIntroSent: false,
            };
        }

        if (!hasMaps && sentWrittenAddressInsteadOfMaps && !hasBusiness) {
            return {
                body: buildMapsMustBeGoogleMapsReply(messageType),
                stage: "missing:business,maps:written_address",
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
                    "Ok, muito obrigado.",
                    "",
                    "Vou encaminhar as informações para o responsável da sua região.",
                    urgencyIntent
                        ? "Como você informou urgência, o responsável vai analisar assim que possível."
                        : "O retorno normalmente acontece entre 24 e 48 horas, e em alguns casos pode acontecer antes.",
                    "",
                    "Muito obrigado.",
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

        if (!hasMaps) {
            return {
                body: buildShortMissingMapsReply(messageType),
                stage: "missing:maps",
                markIntroSent: false,
            };
        }

        return {
            body: buildAutomaticStillMissingReply({ hasBusiness, hasMaps }),
            stage: "fallback:missing_info",
            markIntroSent: false,
        };
    };
}

module.exports = {
    buildIntroMessagePtBr,
    buildHowItWorksSnippetPtBr,
    buildCoverageReplyPtBr,
    buildAmountReplyPtBr,
    buildOfficeLocationReplyPtBr,
    buildNotSuitableReplyPtBr,
    createBotReplyBuilder,
};