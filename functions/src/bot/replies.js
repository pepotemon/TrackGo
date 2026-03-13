const { safeString, safeNumber } = require("../utils/text");
const {
    isCoverageQuestion,
    isHowItWorksQuestion,
    isUrgencyText,
} = require("./intents");

function buildIntroMessagePtBr() {
    return [
        "Olá 👋 Obrigado pelo contato.",
        "",
        "Trabalhamos com microcrédito comercial para lojistas e proprietários de comércios ativos, com pagamento diário e taxas de juros entre 10% e 20%, dependendo da análise.",
        "",
        "⚠️ No momento não trabalhamos com aposentados, pensionistas, assalariados, motoristas de aplicativo (Uber, moto-entrega, etc.) ou pessoas sem comércio ativo.",
        "",
        "Para continuar com a análise, por favor envie:",
        "",
        "1️⃣ Tipo de comércio",
        "2️⃣ Localização do comércio no Google Maps",
        "3️⃣ Nome completo (opcional, mas recomendado)",
        "",
        "Após receber essas informações, encaminharemos seu cadastro para o responsável da sua região, que fará a análise e entrará em contato.",
        "",
        "Obrigado pelo interesse.",
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
        "Para confirmar se atendemos sua região, preciso verificar a localização exata do comércio.",
        "",
        "Envie por favor:",
        "1️⃣ Tipo de comércio",
        "2️⃣ Localização do comércio no Google Maps",
        "3️⃣ Nome completo (opcional)",
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

        if (leadQuality === "not_suitable") {
            return {
                body: buildNotSuitableReplyPtBr(notSuitableReason),
                stage: "final:not_suitable",
                markIntroSent: introAlreadySent,
            };
        }

        if (!introAlreadySent) {
            return {
                body: buildIntroMessagePtBr(),
                stage: "intro",
                markIntroSent: true,
            };
        }

        if (howItWorksIntent && !(hasBusiness && hasMaps)) {
            const missing = [];
            if (!hasBusiness) missing.push("• Tipo de comércio");
            if (!hasMaps) missing.push("• Localização do comércio no Google Maps");

            return {
                body: [
                    buildHowItWorksSnippetPtBr(),
                    "",
                    "Para eu continuar sua análise agora, ainda preciso de:",
                    ...missing,
                    "",
                    !hasMaps
                        ? "Sem a localização do comércio no Google Maps, não consigo encaminhar seu cadastro."
                        : "Assim que eu receber isso, encaminharei seu cadastro.",
                ].join("\n"),
                stage: `how_it_works:${hasBusiness ? "ok" : "business"}:${hasMaps ? "ok" : "maps"}`,
                markIntroSent: false,
            };
        }

        if (coverageIntent && !hasMaps) {
            return {
                body: buildCoverageReplyPtBr(),
                stage: "coverage_check",
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
                    howItWorksIntent
                        ? "Ele também vai explicar valores, condições e próximos passos."
                        : "Muito obrigado.",
                ].join("\n"),
                stage: howItWorksIntent ? "final:how_it_works" : "final",
                markIntroSent: false,
            };
        }

        if (!hasBusiness && !hasMaps) {
            return {
                body: [
                    messageType === "location" ? "Recebi sua localização ✅" : "Recebi sua mensagem ✅",
                    "",
                    "Para continuar com a análise, ainda preciso destas informações obrigatórias:",
                    "",
                    "• Tipo de comércio",
                    "• Localização do comércio no Google Maps",
                    "",
                    "Seu nome completo é opcional, mas pode ser enviado também.",
                    "",
                    "Você pode enviar a localização de um destes jeitos:",
                    "• Compartilhando a localização fixa",
                    "• Mandando o link do Google Maps",
                    "• Mandando a localização do comércio pelo Google Maps",
                    "",
                    "Sem o tipo de comércio e sem a localização do Google Maps, não consigo encaminhar seu cadastro.",
                ].join("\n"),
                stage: "missing:business,maps",
                markIntroSent: false,
            };
        }

        if (!hasBusiness) {
            return {
                body: [
                    messageType === "location" ? "Recebi sua localização ✅" : "Recebi sua mensagem ✅",
                    "",
                    "Para continuar com a análise, ainda preciso de uma informação obrigatória:",
                    "",
                    "• Tipo de comércio",
                    "",
                    "Exemplo: mercadinho, loja de roupas, salão, barbearia, restaurante, oficina, farmácia, padaria, distribuidora, loja de variedades, studio, etc.",
                    "",
                    "Seu nome completo é opcional.",
                ].join("\n"),
                stage: "missing:business",
                markIntroSent: false,
            };
        }

        if (!hasMaps) {
            return {
                body: [
                    messageType === "location" ? "Recebi sua localização ✅" : "Recebi sua mensagem ✅",
                    "",
                    "Para continuar com a análise, ainda preciso da informação obrigatória abaixo:",
                    "",
                    "• Localização do comércio no Google Maps",
                    "",
                    "Você pode enviar de um destes jeitos:",
                    "• Compartilhando a localização fixa",
                    "• Mandando o link do Google Maps",
                    "• Mandando a localização do comércio pelo Google Maps",
                    "",
                    "Sem essa localização, não consigo encaminhar seu cadastro.",
                ].join("\n"),
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
    buildNotSuitableReplyPtBr,
    createBotReplyBuilder,
};