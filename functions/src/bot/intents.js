const {
    includesAnyNormalized,
    normalizeLooseText,
    hasWholeWordNormalized,
} = require("../utils/text");

function isCoverageQuestion(text) {
    return includesAnyNormalized(text, [
        "sou do",
        "sou de",
        "aqui e de",
        "aqui é de",
        "voces faz",
        "vocês faz",
        "vcs faz",
        "trabalha com a regiao",
        "trabalha com a região",
        "atende minha regiao",
        "atende minha região",
        "atende aqui",
        "faz aqui",
        "faz na minha cidade",
        "faz na minha regiao",
        "faz na minha região",
        "tem cobertura aqui",
        "atende goias",
        "atende goiás",
        "atende maranhao",
        "atende maranhão",
        "atende pernambuco",
        "atende manaus",
        "atende natal",
        "atende belem",
        "atende belém",
        "faz em goias",
        "faz em goiás",
        "faz no maranhao",
        "faz no maranhão",
        "faz em pernambuco",
    ]);
}

function isHowItWorksQuestion(text) {
    return includesAnyNormalized(text, [
        "como funciona",
        "como e",
        "como é",
        "como funciona o credito",
        "como funciona o crédito",
        "como funciona o emprestimo",
        "como funciona o empréstimo",
        "como funciona ai",
        "como funciona aí",
        "quais sao as condicoes",
        "quais são as condições",
        "quais as condicoes",
        "quais as condições",
        "me explica",
        "explica melhor",
        "como voces trabalham",
        "como vocês trabalham",
        "como funciona ai com voces",
        "como funciona aí com vocês",
    ]);
}

function isOfficeLocationQuestion(text) {
    return includesAnyNormalized(text, [
        "onde fica o escritorio",
        "onde fica o escritório",
        "onde voces ficam",
        "onde vocês ficam",
        "onde voces trabalham",
        "onde vocês trabalham",
        "onde fica a empresa",
        "onde e o escritorio",
        "onde é o escritório",
        "qual endereco do escritorio",
        "qual endereço do escritório",
        "onde e a loja",
        "onde vocês estao",
        "onde vocês estão",
        "onde vcs ficam",
        "aonde fica o escritorio",
        "aonde fica o escritório",
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
        "com urgencia",
        "com urgência",
    ]);
}

function detectUnsupportedProfileSignals(text) {
    const s = normalizeLooseText(text);
    const flags = [];

    if (!s) return flags;

    const hasRetirementSignal =
        includesAnyNormalized(s, [
            "sou aposentado",
            "sou aposentada",
            "aposentado",
            "aposentada",
            "sou pensionista",
            "pensionista",
            "beneficio do inss",
            "benefício do inss",
            "recebo inss",
            "recebo beneficio",
            "recebo benefício",
            "sou do inss",
        ]) ||
        (hasWholeWordNormalized(s, "inss") &&
            (hasWholeWordNormalized(s, "aposentado") ||
                hasWholeWordNormalized(s, "aposentada") ||
                hasWholeWordNormalized(s, "pensionista") ||
                hasWholeWordNormalized(s, "beneficio") ||
                hasWholeWordNormalized(s, "benefício")));

    if (hasRetirementSignal) {
        flags.push("retirement_profile");
    }

    const hasSalarySignal = includesAnyNormalized(s, [
        "sou assalariado",
        "sou assalariada",
        "assalariado",
        "assalariada",
        "sou clt",
        "trabalho de clt",
        "carteira assinada",
        "trabalho registrado",
        "sou empregado",
        "sou empregada",
        "sou funcionario",
        "sou funcionário",
    ]);

    if (hasSalarySignal) {
        flags.push("salary_profile");
    }

    const hasAppDriverSignal =
        includesAnyNormalized(s, [
            "uber",
            "99pop",
            "motorista de aplicativo",
            "trabalho de aplicativo",
            "trabalho com aplicativo",
            "trabalho no aplicativo",
            "trabalha de aplicativo",
            "sou motoboy",
            "motoboy",
            "moto entrega",
            "moto-entrega",
            "entregador de aplicativo",
            "ifood",
            "rappi",
            "loggi",
        ]) ||
        (hasWholeWordNormalized(s, "99") &&
            (hasWholeWordNormalized(s, "motorista") ||
                hasWholeWordNormalized(s, "app") ||
                hasWholeWordNormalized(s, "aplicativo")));

    if (hasAppDriverSignal) {
        flags.push("app_driver_profile");
    }

    return Array.from(new Set(flags));
}

function classifyProfileFromFlags(flags) {
    const list = Array.isArray(flags) ? flags : [];

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
    if (isOfficeLocationQuestion(text)) return "office_location";
    if (isUrgencyText(text)) return "urgency";
    return "default";
}

module.exports = {
    isCoverageQuestion,
    isHowItWorksQuestion,
    isOfficeLocationQuestion,
    isUrgencyText,
    detectUnsupportedProfileSignals,
    classifyProfileFromFlags,
    getVerificationStatusFromLead,
    detectInboundIntent,
};