const {
    cleanupExtractedText,
    normalizeLooseText,
    includesAnyNormalized,
    onlyDigits,
} = require("../utils/text");
const {
    looksLikeBrazilAddress,
    extractGoogleMapsUrlFromText,
} = require("../utils/geo");
const { detectUnsupportedProfileSignals } = require("./intents");

function stripEdgePunctuation(text) {
    return String(text || "")
        .replace(/^[\s\.,;:!¡?¿"'`~^*_=+\-\\/|()[\]{}<>]+/g, "")
        .replace(/[\s\.,;:!¡?¿"'`~^*_=+\-\\/|()[\]{}<>]+$/g, "")
        .trim();
}

function normalizeForBusinessCheck(text) {
    return normalizeLooseText(stripEdgePunctuation(text));
}

function sanitizeBusinessCandidateText(text) {
    return cleanupExtractedText(stripEdgePunctuation(text || ""));
}

function isConversationalNonBusinessText(text) {
    const s = normalizeForBusinessCheck(text);
    if (!s) return true;

    const exactTokens = [
        "oi",
        "ola",
        "olá",
        "hello",
        "bom dia",
        "boa tarde",
        "boa noite",
        "ok",
        "okay",
        "ok tudo bem",
        "esta bem",
        "está bem",
        "certo",
        "ta bom",
        "tá bom",
        "entendi",
        "sim",
        "nao",
        "não",
        "blz",
        "beleza",
        "perfeito",
        "show",
        "joia",
        "jóia",
        "obrigado",
        "obrigada",
        "grato",
        "grata",
        "valeu",
        "como funciona",
        "tenho interesse",
        "quero saber",
        "quero informacoes",
        "quero informações",
        "mais informacoes",
        "mais informações",
        "preciso de informacoes",
        "preciso de informações",
        "quero mais informacoes",
        "quero mais informações",
        "emprestimo",
        "empréstimo",
        "credito",
        "crédito",
        "financiamento",
        "informacao",
        "informação",
        "informacoes",
        "informações",
    ];

    if (exactTokens.includes(s)) return true;

    const softPhrases = [
        "tenho interesse",
        "quero saber",
        "como funciona",
        "mais informacoes",
        "mais informações",
        "quero informacoes",
        "quero informações",
        "preciso de informacoes",
        "preciso de informações",
        "quero mais informacoes",
        "quero mais informações",
        "bom dia",
        "boa tarde",
        "boa noite",
    ];

    return softPhrases.some((k) => s.includes(normalizeLooseText(k)));
}

function hasBusinessStarter(text) {
    return includesAnyNormalized(normalizeForBusinessCheck(text), [
        "venda de",
        "loja de",
        "comercio de",
        "comércio de",
        "casa de",
        "distribuidora de",
        "distribuidor de",
        "revenda de",
        "box de",
        "box na",
        "box no",
        "box da",
        "mini box",
        "mini mercado",
        "mini-mercado",
        "ponto de",
        "banca de",
        "barraca de",
        "trabalho com",
        "eu trabalho com",
        "tenho um box",
        "tenho uma loja",
        "tenho uma banca",
        "tenho uma barraca",
        "sou dono de",
        "sou dona de",
        "meu comercio e",
        "meu comércio é",
        "meu negocio e",
        "meu negócio é",
        "atelier",
        "atelier de",
        "studio",
        "studio de",
        "espetaria",
        "hamburgueria",
        "pizzaria",
        "sorveteria",
        "cafeteria",
        "açaí",
        "acai",
        "mercearia",
        "quitanda",
        "armazem",
        "armazém",
        "confeitaria",
        "doceria",
        "peixaria",
        "frutaria",
        "tabacaria",
        "drogaria",
        "cosmeticos",
        "cosméticos",
        "perfumaria",
        "armarinho",
        "utilidades",
        "papelaria",
        "brecho",
        "brechó",
        "bazaar",
        "bazar",
        "vidracaria",
        "serralheria",
        "funilaria",
        "mecanica",
        "mecânica",
        "lava jato",
        "auto pecas",
        "auto peças",
        "autopeças",
        "assistencia tecnica",
        "assistência técnica",
        "conserto de",
        "manutencao de",
        "manutenção de",
        "clinica",
        "clínica",
        "consultorio",
        "consultório",
        "pet shop",
        "petshop",
        "agropecuaria",
        "agropecuária",
        "material de construcao",
        "material de construção",
        "madeireira",
        "marmoraria",
        "colchoaria",
        "loja",
        "comercio",
        "comércio",
    ]);
}

function looksLikeGreetingOrInterestText(text) {
    return isConversationalNonBusinessText(text);
}

function isLikelyBusinessLine(text) {
    const s = normalizeForBusinessCheck(text);
    if (!s) return false;

    if (isConversationalNonBusinessText(s)) return false;
    if (hasBusinessStarter(s)) return true;

    return includesAnyNormalized(s, [
        "mercado",
        "mercadinho",
        "mercantil",
        "barbearia",
        "barbeiro",
        "salao",
        "salão",
        "cabeleireira",
        "cabeleireiro",
        "lanchonete",
        "lanche",
        "cozinha",
        "marmita",
        "marmitaria",
        "restaurante",
        "oficina",
        "farmacia",
        "farmácia",
        "deposito",
        "depósito",
        "adega",
        "padaria",
        "distribuidora",
        "conveniencia",
        "conveniência",
        "studio",
        "estetica",
        "estética",
        "acougue",
        "açougue",
        "otica",
        "ótica",
        "hortifruti",
        "borracharia",
        "bijuteria",
        "bijuterias",
        "variedade",
        "variedades",
        "clinica",
        "clínica",
        "home care",
        "churrasco",
        "cosmeticos",
        "cosméticos",
        "roupas",
        "acessorios",
        "acessórios",
        "eletronicos",
        "eletrônicos",
        "utilidades",
        "presentes",
        "box",
        "ceasa",
        "banca",
        "barraca",
        "feira",
        "sacolao",
        "sacolão",
        "revenda",
        "atacado",
        "varejo",
        "comida",
        "food truck",
        "truck",
        "ford truck",
        "mecanico",
        "mecânico",
        "pecas",
        "peças",
        "serralheria",
        "vidracaria",
        "manutencao",
        "manutenção",
        "assistencia tecnica",
        "assistência técnica",
        "conserto",
        "frango assado",
        "esquina do lanche",
    ]);
}

function sanitizeBusiness(business) {
    const v = sanitizeBusinessCandidateText(business);
    if (!v) return "";

    const s = normalizeLooseText(v);

    if (
        looksLikeBrazilAddress(v) ||
        extractGoogleMapsUrlFromText(v) ||
        s.includes("http://") ||
        s.includes("https://") ||
        s.includes("setup guidance") ||
        s.includes("whatsapp manager") ||
        isConversationalNonBusinessText(v)
    ) {
        return "";
    }

    if (v.length > 120) return "";
    return v;
}

function normalizeBusinessLabel(text) {
    const raw = sanitizeBusiness(text);
    const s = normalizeLooseText(raw);

    if (!s) return "";

    if (includesAnyNormalized(s, ["cabeleireira", "cabeleireiro", "salao", "salão"])) return "Salão de beleza";
    if (includesAnyNormalized(s, ["barbearia", "barbeiro"])) return "Barbearia";
    if (includesAnyNormalized(s, ["lanchonete", "lanche"])) return "Lanchonete";
    if (includesAnyNormalized(s, ["hamburgueria", "food truck", "truck", "ford truck"])) return "Food truck";
    if (s.includes("espetaria")) return "Espetaria";
    if (s.includes("pizzaria")) return "Pizzaria";
    if (s.includes("sorveteria")) return "Sorveteria";
    if (s.includes("cafeteria")) return "Cafeteria";
    if (includesAnyNormalized(s, ["acai", "açaí"])) return "Loja de açaí";
    if (includesAnyNormalized(s, ["cozinha", "marmita", "marmitaria", "comida"])) return "Venda de comida";
    if (s.includes("restaurante")) return "Restaurante";
    if (s.includes("borracharia")) return "Borracharia";
    if (includesAnyNormalized(s, ["otica", "ótica"])) return "Ótica";
    if (s.includes("hortifruti")) return "Hortifruti";
    if (includesAnyNormalized(s, ["acougue", "açougue"])) return "Açougue";
    if (includesAnyNormalized(s, ["bijuteria", "bijuterias"])) return "Bijuterias e variedades";
    if (includesAnyNormalized(s, ["clinica", "clínica", "home care", "consultorio", "consultório"])) return "Clínica";
    if (includesAnyNormalized(s, ["loja de conveniencia", "loja de conveniência"])) return "Loja de conveniência";
    if (s.includes("mercadinho")) return "Mercadinho";
    if (includesAnyNormalized(s, ["mercado", "mercantil", "mercearia", "armazem", "armazém", "quitanda"])) return "Mercado";
    if (s.includes("padaria")) return "Padaria";
    if (includesAnyNormalized(s, ["farmacia", "farmácia", "drogaria"])) return "Farmácia";
    if (includesAnyNormalized(s, ["oficina", "mecanica", "mecânica", "mecanico", "mecânico"])) return "Oficina";
    if (s.includes("churrasco")) return "Venda de churrasco";
    if (includesAnyNormalized(s, ["pet shop", "petshop"])) return "Pet shop";
    if (s.includes("papelaria")) return "Papelaria";
    if (includesAnyNormalized(s, ["brecho", "brechó"])) return "Brechó";
    if (includesAnyNormalized(s, ["bazaar", "bazar"])) return "Bazar";
    if (s.includes("distribuidora")) return "Distribuidora";
    if (includesAnyNormalized(s, ["deposito", "depósito"])) return "Depósito";
    if (s.includes("madeireira")) return "Madeireira";
    if (includesAnyNormalized(s, ["material de construcao", "material de construção"])) return "Material de construção";
    if (includesAnyNormalized(s, ["cosmeticos", "cosméticos"])) return "Loja de cosméticos";
    if (s.includes("perfumaria")) return "Perfumaria";
    if (includesAnyNormalized(s, ["roupas", "confeccoes", "confecções"])) return "Loja de roupas";
    if (includesAnyNormalized(s, ["acessorios", "acessórios"])) return "Loja de acessórios";
    if (includesAnyNormalized(s, ["eletronicos", "eletrônicos"])) return "Loja de eletrônicos";
    if (s.includes("utilidades")) return "Loja de utilidades";
    if (s.includes("presentes")) return "Loja de presentes";
    if (includesAnyNormalized(s, ["box", "ceasa"])) return "Box / comércio na Ceasa";
    if (includesAnyNormalized(s, ["banca", "barraca", "feira"])) return "Banca / barraca";
    if (s.includes("studio")) return "Studio";
    if (s.includes("atelier")) return "Atelier";
    if (s.includes("loja")) return "Loja";
    if (includesAnyNormalized(s, ["comercio de", "comércio de", "casa de", "venda de", "trabalho com", "revenda de"])) return raw;

    return raw;
}

function getBusinessSignals(text) {
    const s = normalizeForBusinessCheck(text);
    if (!s) return [];

    const map = [
        ["salão", ["salao", "salão", "cabeleireira", "cabeleireiro"]],
        ["barbearia", ["barbearia", "barbeiro"]],
        ["lanchonete", ["lanchonete", "lanche"]],
        ["food truck", ["food truck", "truck", "ford truck"]],
        ["espetaria", ["espetaria"]],
        ["pizzaria", ["pizzaria"]],
        ["sorveteria", ["sorveteria"]],
        ["cafeteria", ["cafeteria"]],
        ["açaí", ["acai", "açaí"]],
        ["comida", ["cozinha", "marmita", "marmitaria", "comida"]],
        ["restaurante", ["restaurante"]],
        ["borracharia", ["borracharia"]],
        ["ótica", ["otica", "ótica"]],
        ["hortifruti", ["hortifruti"]],
        ["açougue", ["acougue", "açougue"]],
        ["bijuterias", ["bijuteria", "bijuterias"]],
        ["clínica", ["clinica", "clínica", "home care", "consultorio", "consultório"]],
        ["mercado", ["mercado", "mercadinho", "mercantil", "mercearia", "quitanda", "armazem", "armazém"]],
        ["farmácia", ["farmacia", "farmácia", "drogaria"]],
        ["padaria", ["padaria"]],
        ["oficina", ["oficina", "mecanica", "mecânica", "mecanico", "mecânico"]],
        ["churrasco", ["churrasco"]],
        ["studio", ["studio"]],
        ["atelier", ["atelier"]],
        ["papelaria", ["papelaria"]],
        ["petshop", ["petshop", "pet shop"]],
        ["bazar", ["bazar", "bazaar"]],
        ["brechó", ["brecho", "brechó"]],
        ["distribuidora", ["distribuidora"]],
        ["box", ["box", "ceasa"]],
        ["banca", ["banca", "barraca", "feira"]],
        ["loja", ["loja"]],
        ["comércio", ["comercio", "comércio"]],
        ["cosméticos", ["cosmeticos", "cosméticos", "perfumaria"]],
        ["roupas", ["roupas", "confeccoes", "confecções"]],
        ["acessórios", ["acessorios", "acessórios"]],
        ["eletrônicos", ["eletronicos", "eletrônicos"]],
        ["utilidades", ["utilidades", "variedades"]],
        ["tupperware", ["tupperware"]],
        ["jequiti", ["jequiti"]],
        ["romance", ["romance"]],
    ];

    return map
        .filter(([, patterns]) => patterns.some((p) => s.includes(normalizeLooseText(p))))
        .map(([label]) => label);
}

function isPossibleBusinessFallbackTextFactory({ looksLikePersonName }) {
    return function isPossibleBusinessFallbackText(text) {
        const v = sanitizeBusiness(text);
        const s = normalizeLooseText(v);

        if (!v) return false;
        if (v.length < 3 || v.length > 120) return false;
        if (looksLikeBrazilAddress(v)) return false;
        if (extractGoogleMapsUrlFromText(v)) return false;
        if (looksLikeGreetingOrInterestText(v)) return false;
        if (looksLikePersonName(v)) return false;
        if (onlyDigits(v).length >= 8) return false;
        if (!/[a-zA-ZÀ-ÿ]/.test(v)) return false;

        if (hasBusinessStarter(v)) return true;
        if (isLikelyBusinessLine(v)) return true;

        if (includesAnyNormalized(s, [
            "servicos",
            "serviços",
            "utilidades",
            "acessorios",
            "acessórios",
            "cosmeticos",
            "cosméticos",
            "roupas",
            "calcados",
            "calçados",
            "pecas",
            "peças",
            "presentes",
            "eletronicos",
            "eletrônicos",
            "confeccoes",
            "confecções",
            "variedades",
            "artigos",
            "produtos",
            "manutencao",
            "manutenção",
            "assistencia tecnica",
            "assistência técnica",
            "conserto",
            "revenda",
            "distribuicao",
            "distribuição",
            "ceasa",
            "box",
            "banca",
            "barraca",
            "cozinha",
            "lanche",
            "marmita",
            "truck",
            "feira",
            "mercadoria",
        ])) {
            return true;
        }

        const tokenCount = s.split(/\s+/).filter(Boolean).length;
        if (
            tokenCount >= 2 &&
            tokenCount <= 5 &&
            /[a-zA-ZÀ-ÿ]/.test(v) &&
            !s.includes("?") &&
            !isConversationalNonBusinessText(v)
        ) {
            return true;
        }

        return false;
    };
}

function classifyBusinessQuality(rawText, businessLabel, businessRaw) {
    const joined = `${rawText || ""} ${businessLabel || ""} ${businessRaw || ""}`.trim();
    const signals = getBusinessSignals(joined);
    const unsupportedFlags = detectUnsupportedProfileSignals(joined);

    if (unsupportedFlags.length > 0) return "review";
    if (!businessLabel && !businessRaw) return "unknown";
    if (signals.length === 0) return businessRaw ? "review" : "unknown";
    if (signals.length === 1) return "clear";

    const compatiblePairs = [
        ["roupas", "acessórios"],
        ["cosméticos", "acessórios"],
        ["loja", "acessórios"],
        ["loja", "roupas"],
        ["loja", "cosméticos"],
        ["mercado", "padaria"],
        ["studio", "clínica"],
        ["salão", "barbearia"],
        ["bijuterias", "acessórios"],
        ["box", "comércio"],
        ["banca", "comércio"],
        ["lanchonete", "comida"],
        ["food truck", "comida"],
    ];

    const labels = Array.from(new Set(signals));
    const isCompatible =
        labels.length === 2 &&
        compatiblePairs.some(
            ([a, b]) =>
                (labels.includes(a) && labels.includes(b)) ||
                (labels.includes(b) && labels.includes(a))
        );

    if (isCompatible) return "clear";
    if (labels.length >= 3) return "mixed";

    return "review";
}

function getBusinessFlags(rawText, businessLabel, businessRaw) {
    const joined = `${rawText || ""} ${businessLabel || ""} ${businessRaw || ""}`.trim();
    const flags = [];
    const signals = getBusinessSignals(joined);

    if (businessRaw && businessLabel && cleanupExtractedText(businessRaw) !== cleanupExtractedText(businessLabel)) {
        flags.push("normalized_business_label");
    }

    if (signals.length >= 2) {
        flags.push("multi_signal_business");
    }

    if (signals.length >= 3) {
        flags.push("mixed_business_signals");
    }

    if (businessRaw && signals.length === 0) {
        flags.push("fallback_business_detected");
    }

    if (includesAnyNormalized(joined, ["box", "ceasa", "banca", "barraca", "truck", "cozinha", "lanche"])) {
        flags.push("informal_business_text");
    }

    return Array.from(new Set(flags));
}

module.exports = {
    hasBusinessStarter,
    looksLikeGreetingOrInterestText,
    isLikelyBusinessLine,
    sanitizeBusiness,
    normalizeBusinessLabel,
    getBusinessSignals,
    getBusinessFlags,
    isPossibleBusinessFallbackTextFactory,
    classifyBusinessQuality,
};