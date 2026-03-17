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
        "atende em",
        "vocês atendem em",
        "voces atendem em",
        "trabalham em",
        "trabalha em",
        "onde fica o escritorio",
        "onde fica o escritório",
        "onde voces ficam",
        "onde vocês ficam",
        "onde estao localizados",
        "onde estão localizados",
        "onde trabalham",
        "qual endereco do escritorio",
        "qual endereço do escritório",
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

function isAmountQuestion(text) {
    return includesAnyNormalized(text, [
        "libera quanto",
        "quanto libera",
        "quanto voces liberam",
        "quanto vocês liberam",
        "qual valor libera",
        "qual valor voces liberam",
        "qual valor vocês liberam",
        "ate quanto libera",
        "até quanto libera",
        "quanto pode liberar",
        "qual valor do emprestimo",
        "qual valor do empréstimo",
        "quanto empresta",
        "quanto voces emprestam",
        "quanto vocês emprestam",
    ]);
}

function isGenericOutOfFlowQuestion(text) {
    const s = normalizeLooseText(text);
    if (!s) return false;

    if (
        isCoverageQuestion(s) ||
        isHowItWorksQuestion(s) ||
        isAmountQuestion(s) ||
        isUrgencyText(s)
    ) {
        return false;
    }

    const genericQuestionPhrases = [
        "quem e voce",
        "quem é você",
        "quem fala",
        "qual seu nome",
        "qual o seu nome",
        "você é robo",
        "voce é robo",
        "você é robô",
        "voce e robo",
        "voce é robô",
        "é robo",
        "e robo",
        "é robô",
        "e robô",
        "tem atendente",
        "tem pessoa real",
        "quero falar com atendente",
        "quero falar com uma pessoa",
        "quero falar com alguem",
        "quero falar com alguém",
        "nao entendi",
        "não entendi",
        "entendi nao",
        "entendi não",
        "como assim",
        "pode explicar melhor",
        "explica isso",
        "me chama no atendente",
        "tem loja fisica",
        "tem loja física",
        "onde voces ficam mesmo",
        "onde vocês ficam mesmo",
    ];

    if (genericQuestionPhrases.some((x) => s.includes(normalizeLooseText(x)))) {
        return true;
    }

    const questionWords = [
        "quem",
        "qual",
        "quais",
        "onde",
        "porque",
        "por que",
        "como assim",
    ];

    const hasQuestionWord = questionWords.some((w) =>
        s.includes(normalizeLooseText(w))
    );

    return s.includes("?") || hasQuestionWord;
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
            "motorista de app",
            "fazem pra motorista de app",
            "faz pra motorista de app",
            "serve pra motorista de app",
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
        (
            (hasWholeWordNormalized(s, "app") || hasWholeWordNormalized(s, "aplicativo")) &&
            (
                hasWholeWordNormalized(s, "motorista") ||
                hasWholeWordNormalized(s, "uber") ||
                hasWholeWordNormalized(s, "motoboy") ||
                hasWholeWordNormalized(s, "entregador")
            )
        ) ||
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
    if (isAmountQuestion(text)) return "amount";
    if (isUrgencyText(text)) return "urgency";
    if (isGenericOutOfFlowQuestion(text)) return "generic_question";
    return "default";
}

module.exports = {
    isCoverageQuestion,
    isHowItWorksQuestion,
    isUrgencyText,
    isAmountQuestion,
    isGenericOutOfFlowQuestion,
    detectUnsupportedProfileSignals,
    classifyProfileFromFlags,
    getVerificationStatusFromLead,
    detectInboundIntent,
};