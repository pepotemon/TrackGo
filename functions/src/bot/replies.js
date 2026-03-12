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
        "2️⃣ Nome completo",
        "3️⃣ Localização do comércio no Google Maps",
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
        "2️⃣ Nome completo",
        "3️⃣ Localização do comércio no Google Maps",
    ].join("\n");
}

function createBotReplyBuilder({
    hasUsefulBusiness,
    hasRequiredMapsForFlow,
}) {
    return function buildBotReplyPtBr({ client, messageType }) {
        const hasBusiness = hasUsefulBusiness(client);
        const hasMaps = hasRequiredMapsForFlow(client);
        const introAlreadySent = safeNumber(client?.initialIntroSentAt, 0) > 0;

        const lastText = safeString(client?.lastInboundText || "");
        const coverageIntent = isCoverageQuestion(lastText);
        const howItWorksIntent = isHowItWorksQuestion(lastText);
        const urgencyIntent = isUrgencyText(lastText);

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
                    "O retorno normalmente acontece entre 24 e 48 horas, e em alguns casos pode acontecer antes.",
                    "",
                    howItWorksIntent
                        ? "Ele também vai explicar valores, condições e próximos passos."
                        : "Muito obrigado.",
                    urgencyIntent ? "" : "",
                ].filter(Boolean).join("\n"),
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
                    "Você também pode enviar seu nome completo, mas isso é opcional.",
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
                    "Se quiser, você também pode enviar seu nome completo.",
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
    createBotReplyBuilder,
};