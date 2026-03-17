const { safeString, safeNumber } = require("../utils/text");
const {
    isCoverageQuestion,
    isHowItWorksQuestion,
    isUrgencyText,
    isAmountQuestion,
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
        "1️⃣ Fazemos uma análise inicial do tipo de comércio e da localização.",
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
        "Agora só falta o tipo de comércio para eu continuar.",
    ].join("\n");
}

function buildShortMissingMapsReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Agora só falta a localização do comércio no Google Maps.",
    ].join("\n");
}

function buildShortMissingBothReply(messageType) {
    return [
        buildShortAckPrefix(messageType),
        "",
        "Para continuar, ainda preciso do tipo de comércio e da localização no Google Maps.",
    ].join("\n");
}

function buildContextualMissingFooter({ hasBusiness, hasMaps }) {
    if (!hasBusiness && !hasMaps) {
        return "Para continuar, ainda preciso do tipo de comércio e da localização no Google Maps.";
    }
    if (!hasBusiness) {
        return "Para continuar, ainda preciso do tipo de comércio.";
    }
    if (!hasMaps) {
        return "Para continuar, ainda preciso da localização do comércio no Google Maps.";
    }
    return "";
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

            return {
                body: buildIntroMessagePtBr(),
                stage: "intro",
                markIntroSent: true,
            };
        }

        if (howItWorksIntent && !(hasBusiness && hasMaps)) {
            const footer = buildContextualMissingFooter({ hasBusiness, hasMaps });

            return {
                body: [
                    buildHowItWorksSnippetPtBr(),
                    "",
                    footer,
                ].filter(Boolean).join("\n"),
                stage: `how_it_works:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}`,
                markIntroSent: false,
            };
        }

        if (coverageIntent && !(hasBusiness && hasMaps)) {
            const footer = buildContextualMissingFooter({ hasBusiness, hasMaps });

            return {
                body: [
                    buildCoverageReplyPtBr(),
                    "",
                    footer,
                ].filter(Boolean).join("\n"),
                stage: `coverage_check:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}`,
                markIntroSent: false,
            };
        }

        if (amountIntent && !(hasBusiness && hasMaps)) {
            const footer = buildContextualMissingFooter({ hasBusiness, hasMaps });

            return {
                body: [
                    buildAmountReplyPtBr(),
                    "",
                    footer,
                ].filter(Boolean).join("\n"),
                stage: `amount_check:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}`,
                markIntroSent: false,
            };
        }

        if (coverageIntent && hasBusiness && !hasMaps) {
            return {
                body: [
                    buildOfficeLocationReplyPtBr(),
                    "",
                    "Agora só falta a localização do comércio no Google Maps.",
                ].join("\n"),
                stage: "coverage_check:maps",
                markIntroSent: false,
            };
        }

        if (hasBusiness && hasMaps) {
            return {
                body: [
                    amountIntent
                        ? buildAmountReplyPtBr()
                        : "Ok, muito obrigado.",
                    "",
                    "Vou encaminhar as informações para o responsável da sua região.",
                    urgencyIntent
                        ? "Como você informou urgência, o responsável vai analisar assim que possível."
                        : "O retorno normalmente acontece entre 24 e 48 horas, e em alguns casos pode acontecer antes.",
                    "",
                    howItWorksIntent
                        ? "Ele também vai explicar valores, condições e próximos passos."
                        : "Muito obrigado.",
                ].join("\n"),
                stage: howItWorksIntent ? "final:how_it_works" : amountIntent ? "final:amount" : "final",
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
            body: "",
            stage: "",
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