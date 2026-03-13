function safeString(v) {
    return typeof v === "string" ? v.trim() : "";
}

function safeLower(v) {
    return safeString(v).toLowerCase();
}

function safeNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function normalizePhone(raw) {
    const digits = String(raw || "").replace(/\D+/g, "");
    return digits || "";
}

function stripUndefined(obj) {
    const out = {};
    for (const k of Object.keys(obj || {})) {
        const v = obj[k];
        if (v !== undefined) out[k] = v;
    }
    return out;
}

function cleanupExtractedText(v) {
    return safeString(v)
        .replace(/\s+/g, " ")
        .replace(/^[\-\:\,\.\;\|\s]+/, "")
        .replace(/[\s\|\-\,\.\;]+$/, "")
        .trim();
}

function normalizeLooseText(v) {
    return safeLower(v)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function onlyDigits(v) {
    return String(v || "").replace(/\D+/g, "");
}

function includesAnyNormalized(text, patterns) {
    const s = normalizeLooseText(text);
    if (!s) return false;
    return (patterns || []).some((p) => s.includes(normalizeLooseText(p)));
}

function escapeRegex(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWholeWordNormalized(text, word) {
    const s = normalizeLooseText(text);
    const w = normalizeLooseText(word);

    if (!s || !w) return false;

    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(w)}([^a-z0-9]|$)`, "i");
    return re.test(s);
}

function extractLabeledValue(text, labels) {
    const source = safeString(text);

    for (const label of labels || []) {
        const safeLabel = escapeRegex(label);
        const re = new RegExp(
            `(?:^|\\n|\\r)\\s*${safeLabel}\\s*[:\\-]?\\s*(.+)`,
            "i"
        );
        const m = source.match(re);
        if (m && m[1]) {
            const val = cleanupExtractedText(m[1]);
            if (val) return val;
        }
    }

    return "";
}

module.exports = {
    safeString,
    safeLower,
    safeNumber,
    normalizePhone,
    stripUndefined,
    cleanupExtractedText,
    normalizeLooseText,
    onlyDigits,
    includesAnyNormalized,
    escapeRegex,
    hasWholeWordNormalized,
    extractLabeledValue,
};