const {
    cleanupExtractedText,
    normalizeLooseText,
    includesAnyNormalized,
    onlyDigits,
} = require("../utils/text");
const { looksLikeBrazilAddress, extractGoogleMapsUrlFromText } = require("../utils/geo");
const { detectUnsupportedProfileSignals } = require("./intents");

function hasBusinessStarter(text) {
    return includesAnyNormalized(text, [
        "venda de",
        "loja de",
        "comercio de",
        "comércio de",
        "casa de",
        "distribuidora de",
        "distribuidor de",
        "revenda de",
        "box de",
        "mini box",
        "mini mercado",
        "mini-mercado",
        "ponto de",
        "banca de",
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
        "autopeças",
        "auto peças",
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
    const s = normalizeLooseText(text);
    if (!s) return false;

    const tokens = [
        "oi",
        "ola",
        "olá",
        "bom dia",
        "boa tarde",
        "boa noite",
        "tenho interesse",
        "quero informacoes",
        "quero informações",
        "quero saber",
        "tenho interesse no emprestimo",
        "tenho interesse no empréstimo",
        "emprestimo",
        "empréstimo",
        "credito",
        "crédito",
        "financiamento",
        "como funciona",
        "mais informacoes",
        "mais informações",
        "ok",
        "ok tudo bem",
        "esta bem",
        "está bem",
        "certo",
        "ta bom",
        "tá bom",
    ];

    return tokens.some((k) => s.includes(normalizeLooseText(k)));
}

function isLikelyBusinessLine(text) {
    const s = normalizeLooseText(text);
    if (!s) return false;

    return (
        hasBusinessStarter(text) ||
        s.includes("mercado") ||
        s.includes("mercadinho") ||
        s.includes("mercantil") ||
        s.includes("barbearia") ||
        s.includes("barbeiro") ||
        s.includes("salao") ||
        s.includes("salão") ||
        s.includes("cabeleireira") ||
        s.includes("cabeleireiro") ||
        s.includes("lanchonete") ||
        s.includes("restaurante") ||
        s.includes("oficina") ||
        s.includes("farmacia") ||
        s.includes("farmácia") ||
        s.includes("deposito") ||
        s.includes("depósito") ||
        s.includes("adega") ||
        s.includes("padaria") ||
        s.includes("distribuidora") ||
        s.includes("conveniencia") ||
        s.includes("conveniência") ||
        s.includes("studio") ||
        s.includes("estetica") ||
        s.includes("estética") ||
        s.includes("acougue") ||
        s.includes("açougue") ||
        s.includes("otica") ||
        s.includes("ótica") ||
        s.includes("hortifruti") ||
        s.includes("borracharia") ||
        s.includes("bijuteria") ||
        s.includes("bijuterias") ||
        s.includes("variedade") ||
        s.includes("clinica") ||
        s.includes("clínica") ||
        s.includes("home care") ||
        s.includes("churrasco") ||
        s.includes("cosmeticos") ||
        s.includes("cosméticos") ||
        s.includes("roupas") ||
        s.includes("acessorios") ||
        s.includes("acessórios") ||
        s.includes("eletronicos") ||
        s.includes("eletrônicos") ||
        s.includes("utilidades") ||
        s.includes("presentes")
    );
}

function sanitizeBusiness(business) {
    let v = cleanupExtractedText(business);
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

    if (v.length > 120) return "";
    return v;
}

function normalizeBusinessLabel(text) {
    const raw = sanitizeBusiness(text);
    const s = normalizeLooseText(raw);

    if (!s) return "";

    if (s.includes("cabeleireira") || s.includes("cabeleireiro") || s.includes("salao") || s.includes("salão")) return "Salão de beleza";
    if (s.includes("barbearia") || s.includes("barbeiro")) return "Barbearia";
    if (s.includes("lanchonete")) return "Lanchonete";
    if (s.includes("hamburgueria")) return "Hamburgueria";
    if (s.includes("espetaria")) return "Espetaria";
    if (s.includes("pizzaria")) return "Pizzaria";
    if (s.includes("sorveteria")) return "Sorveteria";
    if (s.includes("cafeteria")) return "Cafeteria";
    if (s.includes("acai") || s.includes("açaí")) return "Loja de açaí";
    if (s.includes("restaurante")) return "Restaurante";
    if (s.includes("borracharia")) return "Borracharia";
    if (s.includes("otica") || s.includes("ótica")) return "Ótica";
    if (s.includes("hortifruti")) return "Hortifruti";
    if (s.includes("acougue") || s.includes("açougue")) return "Açougue";
    if (s.includes("bijuteria") || s.includes("bijuterias")) return "Bijuterias e variedades";
    if (s.includes("clinica") || s.includes("clínica") || s.includes("home care") || s.includes("consultorio") || s.includes("consultório")) return "Clínica";
    if (s.includes("loja de conveniencia") || s.includes("loja de conveniência")) return "Loja de conveniência";
    if (s.includes("mercadinho")) return "Mercadinho";
    if (s.includes("mercado") || s.includes("mercantil") || s.includes("mercearia") || s.includes("armazem") || s.includes("armazém") || s.includes("quitanda")) return "Mercado";
    if (s.includes("padaria")) return "Padaria";
    if (s.includes("farmacia") || s.includes("farmácia") || s.includes("drogaria")) return "Farmácia";
    if (s.includes("oficina") || s.includes("mecanica") || s.includes("mecânica")) return "Oficina";
    if (s.includes("churrasco")) return "Venda de churrasco";
    if (s.includes("pet shop") || s.includes("petshop")) return "Pet shop";
    if (s.includes("papelaria")) return "Papelaria";
    if (s.includes("brecho") || s.includes("brechó")) return "Brechó";
    if (s.includes("bazaar") || s.includes("bazar")) return "Bazar";
    if (s.includes("distribuidora")) return "Distribuidora";
    if (s.includes("deposito") || s.includes("depósito")) return "Depósito";
    if (s.includes("madeireira")) return "Madeireira";
    if (s.includes("material de construcao") || s.includes("material de construção")) return "Material de construção";
    if (s.includes("cosmeticos") || s.includes("cosméticos")) return "Loja de cosméticos";
    if (s.includes("perfumaria")) return "Perfumaria";
    if (s.includes("roupas") || s.includes("confeccoes") || s.includes("confecções")) return "Loja de roupas";
    if (s.includes("acessorios") || s.includes("acessórios")) return "Loja de acessórios";
    if (s.includes("eletronicos") || s.includes("eletrônicos")) return "Loja de eletrônicos";
    if (s.includes("utilidades")) return "Loja de utilidades";
    if (s.includes("presentes")) return "Loja de presentes";
    if (s.includes("studio")) return "Studio";
    if (s.includes("atelier")) return "Atelier";
    if (s.includes("loja")) return "Loja";
    if (s.includes("comercio de") || s.includes("comércio de")) return raw;
    if (s.includes("casa de")) return raw;
    if (s.includes("venda de")) return raw;

    return raw;
}

function getBusinessSignals(text) {
    const s = normalizeLooseText(text);
    if (!s) return [];

    const map = [
        ["salão", ["salao", "salão", "cabeleireira", "cabeleireiro"]],
        ["barbearia", ["barbearia", "barbeiro"]],
        ["lanchonete", ["lanchonete"]],
        ["hamburgueria", ["hamburgueria"]],
        ["espetaria", ["espetaria"]],
        ["pizzaria", ["pizzaria"]],
        ["sorveteria", ["sorveteria"]],
        ["cafeteria", ["cafeteria"]],
        ["açaí", ["acai", "açaí"]],
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
        ["oficina", ["oficina", "mecanica", "mecânica"]],
        ["churrasco", ["churrasco"]],
        ["studio", ["studio"]],
        ["atelier", ["atelier"]],
        ["papelaria", ["papelaria"]],
        ["petshop", ["petshop", "pet shop"]],
        ["bazar", ["bazar", "bazaar"]],
        ["brechó", ["brecho", "brechó"]],
        ["distribuidora", ["distribuidora"]],
        ["loja", ["loja"]],
        ["comércio", ["comercio", "comércio"]],
        ["cosméticos", ["cosmeticos", "cosméticos", "perfumaria"]],
        ["roupas", ["roupas", "confeccoes", "confecções"]],
        ["acessórios", ["acessorios", "acessórios"]],
        ["eletrônicos", ["eletronicos", "eletrônicos"]],
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
        if (v.length < 4 || v.length > 120) return false;
        if (looksLikeBrazilAddress(v)) return false;
        if (extractGoogleMapsUrlFromText(v)) return false;
        if (looksLikeGreetingOrInterestText(v)) return false;
        if (looksLikePersonName(v)) return false;
        if (onlyDigits(v).length >= 8) return false;
        if (!/[a-zA-ZÀ-ÿ]/.test(v)) return false;

        if (hasBusinessStarter(v)) return true;

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
        ])) {
            return true;
        }

        return false;
    };
}

function classifyBusinessQuality(rawText, businessLabel, businessRaw) {
    const joined = `${rawText || ""} ${businessLabel || ""} ${businessRaw || ""}`;
    const signals = getBusinessSignals(joined);
    const unsupportedFlags = detectUnsupportedProfileSignals(joined);

    if (unsupportedFlags.length > 0) return "review";
    if (signals.length >= 3) return "mixed";
    if (signals.length >= 2) return "mixed";
    if (signals.length === 1) return "clear";
    if (businessRaw && !signals.length) return "review";
    return businessLabel ? "clear" : "unknown";
}

module.exports = {
    hasBusinessStarter,
    looksLikeGreetingOrInterestText,
    isLikelyBusinessLine,
    sanitizeBusiness,
    normalizeBusinessLabel,
    getBusinessSignals,
    isPossibleBusinessFallbackTextFactory,
    classifyBusinessQuality,
};