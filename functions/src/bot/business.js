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

function hasBusinessStarter(text) {
    return includesAnyNormalized(text, [
        "venda de",
        "vendas de",
        "vendo",
        "trabalho com",
        "trabalhamos com",
        "eu trabalho com",
        "a gente trabalha com",
        "meu trabalho e",
        "meu trabalho é",
        "tenho um box",
        "tenho uma loja",
        "tenho uma banca",
        "tenho uma barraca",
        "tenho um espetinho",
        "tenho um comercio",
        "tenho um comércio",
        "sou lojista",
        "somos lojistas",
        "sou dono de",
        "sou dona de",
        "meu comercio e",
        "meu comércio é",
        "meu negocio e",
        "meu negócio é",
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
        "atelier",
        "atelier de",
        "studio",
        "studio de",
        "bar e hotel",
        "boteco e hotel",
        "espetaria",
        "espetinho",
        "churrasquinho",
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
    ]);
}

function looksLikeGreetingOrInterestText(text) {
    const s = normalizeLooseText(text);
    if (!s) return false;

    const exactTokens = [
        "oi",
        "ola",
        "olá",
        "hola",
        "bom dia",
        "boa tarde",
        "boa noite",
        "tenho interesse",
        "quero informacoes",
        "quero informações",
        "quero mais informacoes",
        "quero mais informações",
        "quero saber",
        "quiero informacion",
        "quiero información",
        "quiero mas informacion",
        "quiero más información",
        "tenho interesse no emprestimo",
        "tenho interesse no empréstimo",
        "emprestimo",
        "empréstimo",
        "credito",
        "crédito",
        "financiamento",
        "mais informacoes",
        "mais informações",
        "mas informacoes",
        "más información",
        "informacao",
        "informação",
        "informacion",
        "información",
        "ok",
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
    ];

    if (exactTokens.some((k) => s === normalizeLooseText(k))) return true;

    const softPhrases = [
        "tenho interesse",
        "quero saber",
        "como funciona",
        "mais informacoes",
        "mais informações",
        "quero informacoes",
        "quero informações",
        "quiero informacion",
        "quiero información",
        "quiero mas informacion",
        "quiero más información",
        "hola quiero",
        "ola quero",
        "oi quero",
    ];

    return softPhrases.some((k) => s.includes(normalizeLooseText(k)));
}

function isLikelyBusinessLine(text) {
    const s = normalizeLooseText(text);
    if (!s) return false;

    if (looksLikeGreetingOrInterestText(text)) return false;
    if (s.includes("?")) return false;
    if (s.includes("como funciona")) return false;
    if (s.includes("quiero informacion")) return false;
    if (s.includes("quiero información")) return false;
    if (s.includes("quiero mas informacion")) return false;
    if (s.includes("quiero más información")) return false;
    if (s.includes("quero mais informacoes")) return false;
    if (s.includes("quero mais informações")) return false;

    if (hasBusinessStarter(text)) return true;

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
        "hotel",
        "boteco",
        "bar",
        "espetinho",
        "churrasquinho",
        "espetaria",
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
        "agua de coco",
        "água de coco",
        "lojista",
    ]);
}

function sanitizeBusiness(business) {
    const v = cleanupExtractedText(business);
    if (!v) return "";

    const s = normalizeLooseText(v);

    if (
        looksLikeBrazilAddress(v) ||
        s.includes("http://") ||
        s.includes("https://") ||
        s.includes("setup guidance") ||
        s.includes("whatsapp manager")
    ) {
        return "";
    }

    if (looksLikeGreetingOrInterestText(v)) return "";
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
    if (includesAnyNormalized(s, ["espetaria", "espetinho", "churrasquinho"])) return "Espetinho / churrasquinho";
    if (includesAnyNormalized(s, ["bar e hotel", "boteco e hotel"])) return "Bar / hotel";
    if (s.includes("boteco")) return "Boteco";
    if (s.includes("hotel")) return "Hotel";
    if (s.includes("bar")) return "Bar";
    if (s.includes("pizzaria")) return "Pizzaria";
    if (s.includes("sorveteria")) return "Sorveteria";
    if (s.includes("cafeteria")) return "Cafeteria";
    if (includesAnyNormalized(s, ["acai", "açaí"])) return "Loja de açaí";
    if (includesAnyNormalized(s, ["cozinha", "marmita", "marmitaria", "comida"])) return "Venda de comida";
    if (includesAnyNormalized(s, ["agua de coco", "água de coco"])) return "Venda de água de coco";
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
    if (s.includes("lojista")) return "Comércio / lojista";
    if (s.includes("studio")) return "Studio";
    if (s.includes("atelier")) return "Atelier";
    if (s.includes("loja")) return "Loja";
    if (includesAnyNormalized(s, [
        "comercio de",
        "comércio de",
        "casa de",
        "venda de",
        "vendas de",
        "trabalho com",
        "trabalhamos com",
        "revenda de",
    ])) {
        return raw;
    }

    return raw;
}

function getBusinessSignals(text) {
    const s = normalizeLooseText(text);
    if (!s) return [];

    const map = [
        ["salão", ["salao", "salão", "cabeleireira", "cabeleireiro"]],
        ["barbearia", ["barbearia", "barbeiro"]],
        ["lanchonete", ["lanchonete", "lanche"]],
        ["food truck", ["food truck", "truck", "ford truck"]],
        ["espetinho", ["espetinho", "churrasquinho", "espetaria"]],
        ["bar_hotel", ["bar e hotel", "boteco e hotel"]],
        ["bar", ["bar"]],
        ["hotel", ["hotel"]],
        ["boteco", ["boteco"]],
        ["pizzaria", ["pizzaria"]],
        ["sorveteria", ["sorveteria"]],
        ["cafeteria", ["cafeteria"]],
        ["açaí", ["acai", "açaí"]],
        ["comida", ["cozinha", "marmita", "marmitaria", "comida"]],
        ["agua de coco", ["agua de coco", "água de coco"]],
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
        ["comércio", ["comercio", "comércio", "lojista"]],
        ["cosméticos", ["cosmeticos", "cosméticos", "perfumaria"]],
        ["roupas", ["roupas", "confeccoes", "confecções"]],
        ["acessórios", ["acessorios", "acessórios"]],
        ["eletrônicos", ["eletronicos", "eletrônicos"]],
        ["utilidades", ["utilidades", "variedades"]],
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
        if (s.includes("?")) return false;
        if (s.includes("como funciona")) return false;
        if (s.includes("quiero informacion")) return false;
        if (s.includes("quiero información")) return false;
        if (s.includes("quiero mas informacion")) return false;
        if (s.includes("quiero más información")) return false;
        if (s.includes("quero mais informacoes")) return false;
        if (s.includes("quero mais informações")) return false;

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
            "lojista",
            "espetinho",
            "churrasquinho",
            "agua de coco",
            "água de coco",
            "hotel",
            "boteco",
            "bar",
        ])) {
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
        ["espetinho", "comida"],
        ["bar", "hotel"],
        ["boteco", "hotel"],
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

    if (includesAnyNormalized(joined, [
        "box",
        "ceasa",
        "banca",
        "barraca",
        "truck",
        "cozinha",
        "lanche",
        "espetinho",
        "churrasquinho",
    ])) {
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