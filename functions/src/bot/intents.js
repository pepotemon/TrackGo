const { includesAnyNormalized, normalizeLooseText } = require("../utils/text");

function isCoverageQuestion(text) {
    return includesAnyNormalized(text, [
        "sou do",
        "sou de",
        "aqui e de",
        "aqui é de",
        "vocês faz",
        "vcs faz",
        "trabalha com a regiao",
        "trabalha com a região",
        "atende minha regiao",
        "atende minha região",
        "atende goias",
        "atende goiás",
        "atende maranhao",
        "atende maranhão",
        "atende pernambuco",
        "atende manaus",
        "atende natal",
        "atende belem",
        "atende belém",
        "trabalha com",
        "faz em goias",
        "faz em goiás",
        "faz no maranhao",
        "faz no maranhão",
        "faz em pernambuco",
        "faz aqui",
    ]);
}

function isHowItWorksQuestion(text) {
    return includesAnyNormalized(text, [
        "como funciona",
        "como e",
        "como é",
        "como funciona o credito",
        "como funciona o empréstimo",
        "como funciona o emprestimo",
        "como funciona ai",
        "como funciona aí",
        "quais sao as condicoes",
        "quais são as condições",
        "quais as condicoes",
        "quais as condições",
        "me explica",
        "explica melhor",
    ]);
}

function isUrgencyText(text) {
    return includesAnyNormalized(text, [
        "pra ontem",
        "para ontem",
        "urgente",
        "preciso logo",
        "preciso rapido",
        "preciso rápido",
        "o quanto antes",
        "hoje ainda",
        "ainda hoje",
    ]);
}

function detectUnsupportedProfileSignals(text) {
    const s = normalizeLooseText(text);
    const flags = [];

    if (!s) return flags;

    // aposentado / pensionista / INSS
    if (
        s.includes("aposentado") ||
        s.includes("aposentada") ||
        s.includes("pensionista") ||
        s.includes("pensão") ||
        s.includes("pensao") ||
        s.includes("inss") ||
        s.includes("beneficio") ||
        s.includes("benefício")
    ) {
        flags.push("retirement_profile");
    }

    // assalariado / CLT / empregado
    if (
        s.includes("assalariado") ||
        s.includes("assalariada") ||
        s.includes("clt") ||
        s.includes("carteira assinada") ||
        s.includes("trabalho registrado") ||
        s.includes("empregado") ||
        s.includes("empregada") ||
        s.includes("funcionario") ||
        s.includes("funcionário")
    ) {
        flags.push("salary_profile");
    }

    // aplicativo / uber / motoboy / entregador
    if (
        s.includes("uber") ||
        s.includes("99pop") ||
        s.includes("99") ||
        s.includes("motorista de aplicativo") ||
        s.includes("trabalho de aplicativo") ||
        s.includes("trabalha de aplicativo") ||
        s.includes("trabalho com aplicativo") ||
        s.includes("trabalho no aplicativo") ||
        s.includes("aplicativo") ||
        s.includes("moto entrega") ||
        s.includes("moto-entrega") ||
        s.includes("motoboy") ||
        s.includes("entregador") ||
        s.includes("entregador de aplicativo") ||
        s.includes("ifood") ||
        s.includes("rappi") ||
        s.includes("loggi")
    ) {
        flags.push("app_driver_profile");
    }

    return Array.from(new Set(flags));
}

function classifyProfileFromFlags(flags) {
    const list = Array.isArray(flags) ? flags : [];

    // si mezcla varios perfiles no aptos, igual queda como review manual
    if (list.length > 1) {
        return {
            profileType: "mixed_restricted",
            leadQuality: "not_suitable",
            notSuitableReason: "Perfil incompatível com crédito comercial",
        };
    }

    if (list.includes("app_driver_profile")) {
        return {
            profileType: "app_driver",
            leadQuality: "not_suitable",
            notSuitableReason: "Motorista / trabalho de aplicativo",
        };
    }

    if (list.includes("retirement_profile")) {
        return {
            profileType: "retired",
            leadQuality: "not_suitable",
            notSuitableReason: "Aposentado / pensionista",
        };
    }

    if (list.includes("salary_profile")) {
        return {
            profileType: "salary_worker",
            leadQuality: "not_suitable",
            notSuitableReason: "Assalariado / CLT",
        };
    }

    return {
        profileType: "business",
        leadQuality: "valid",
        notSuitableReason: "",
    };
}

function getVerificationStatusFromLead({
    parseStatus,
    leadQuality,
}) {
    const p = String(parseStatus || "").trim().toLowerCase();
    const q = String(leadQuality || "").trim().toLowerCase();

    if (q === "not_suitable") return "not_suitable";
    if (p !== "ready") return "incomplete";
    return "pending_review";
}

function detectInboundIntent(text) {
    if (isHowItWorksQuestion(text)) return "how_it_works";
    if (isCoverageQuestion(text)) return "coverage";
    if (isUrgencyText(text)) return "urgency";
    return "default";
}

module.exports = {
    isCoverageQuestion,
    isHowItWorksQuestion,
    isUrgencyText,
    detectUnsupportedProfileSignals,
    classifyProfileFromFlags,
    getVerificationStatusFromLead,
    detectInboundIntent,
};