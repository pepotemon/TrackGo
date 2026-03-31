const {
    safeString,
    cleanupExtractedText,
    normalizeLooseText,
} = require("./text");
const {
    roundCoord,
    hasValidCoords,
    looksLikeMapsUrl,
} = require("./geo");

function tryDecode(value) {
    const source = safeString(value);
    if (!source) return "";

    try {
        return decodeURIComponent(source);
    } catch {
        return source;
    }
}

function extractCoordsFromAnyText(text) {
    const source = safeString(text);
    if (!source) {
        return { lat: null, lng: null };
    }

    const decoded = tryDecode(source);

    const patterns = [
        /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]destination=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]origin=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]saddr=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]daddr=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]ll=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]center=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
        /place\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /(?:^|[^0-9-])(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)(?:[^0-9]|$)/i,
    ];

    for (const pattern of patterns) {
        const match = decoded.match(pattern);
        if (!match?.[1] || !match?.[2]) continue;

        const lat = roundCoord(match[1]);
        const lng = roundCoord(match[2]);

        if (hasValidCoords(lat, lng)) {
            return { lat, lng };
        }
    }

    return { lat: null, lng: null };
}

function extractMapsUrlsFromHtml(html) {
    const source = safeString(html);
    if (!source) return [];

    const matches = source.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
    const cleaned = matches
        .map((raw) =>
            cleanupExtractedText(raw).replace(/[)\],.;"'<>\\]+$/g, "")
        )
        .filter((url) => looksLikeMapsUrl(url));

    return Array.from(new Set(cleaned));
}

function extractCoordsFromHtmlMeta(html) {
    const source = safeString(html);
    if (!source) {
        return { lat: null, lng: null };
    }

    const decoded = tryDecode(source);

    const hints = [
        /"center":\s*\{\s*"lat":\s*(-?\d+(?:\.\d+)?),\s*"lng":\s*(-?\d+(?:\.\d+)?)\s*\}/i,
        /"latitude":\s*(-?\d+(?:\.\d+)?).*?"longitude":\s*(-?\d+(?:\.\d+)?)/i,
        /"lat":\s*(-?\d+(?:\.\d+)?).*?"lng":\s*(-?\d+(?:\.\d+)?)/i,
        /"mapcenter":\s*"(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)"/i,
    ];

    for (const pattern of hints) {
        const match = decoded.match(pattern);
        if (!match?.[1] || !match?.[2]) continue;

        const lat = roundCoord(match[1]);
        const lng = roundCoord(match[2]);

        if (hasValidCoords(lat, lng)) {
            return { lat, lng };
        }
    }

    return { lat: null, lng: null };
}

function cleanupCandidateText(value) {
    const v = cleanupExtractedText(tryDecode(value))
        .replace(/\+/g, " ")
        .replace(/[_|]+/g, " ")
        .replace(/[-]{2,}/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!v) return "";
    if (v.length < 4) return "";

    return v;
}

function stripGoogleMapsNoise(value) {
    const v = cleanupCandidateText(value);
    if (!v) return "";

    return v
        .replace(/\bgoogle maps\b/gi, "")
        .replace(/\bmaps\b/gi, "")
        .replace(/\bdirections?\b/gi, "")
        .replace(/\broute\b/gi, "")
        .replace(/\bshare\b/gi, "")
        .replace(/\bplace\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function extractMetaContent(html, propertyOrName) {
    const source = safeString(html);
    if (!source) return "";

    const patterns = [
        new RegExp(
            `<meta[^>]+property=["']${propertyOrName}["'][^>]+content=["']([^"']+)["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${propertyOrName}["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+name=["']${propertyOrName}["'][^>]+content=["']([^"']+)["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${propertyOrName}["']`,
            "i"
        ),
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.[1]) {
            return cleanupCandidateText(match[1]);
        }
    }

    return "";
}

function extractTitleText(html) {
    const source = safeString(html);
    if (!source) return "";

    const match = source.match(/<title[^>]*>([^<]+)<\/title>/i);
    return cleanupCandidateText(match?.[1] || "");
}

function extractPlaceTextFromUrl(url) {
    const source = safeString(url);
    if (!source) return [];

    const decoded = tryDecode(source);
    const out = [];

    const patterns = [
        /[?&]q=([^&]+)/i,
        /[?&]query=([^&]+)/i,
        /\/place\/([^/?#]+)/i,
        /\/search\/([^/?#]+)/i,
    ];

    for (const pattern of patterns) {
        const match = decoded.match(pattern);
        const raw = cleanupCandidateText(match?.[1] || "");
        if (!raw) continue;

        const cleaned = stripGoogleMapsNoise(raw);
        if (cleaned) out.push(cleaned);
    }

    return Array.from(new Set(out));
}

function extractTextCandidatesFromHtml(html) {
    const source = safeString(html);
    if (!source) return [];

    const candidates = [];

    const ogTitle = extractMetaContent(source, "og:title");
    const ogDescription = extractMetaContent(source, "og:description");
    const twitterTitle = extractMetaContent(source, "twitter:title");
    const title = extractTitleText(source);

    if (ogTitle) candidates.push(stripGoogleMapsNoise(ogTitle));
    if (ogDescription) candidates.push(stripGoogleMapsNoise(ogDescription));
    if (twitterTitle) candidates.push(stripGoogleMapsNoise(twitterTitle));
    if (title) candidates.push(stripGoogleMapsNoise(title));

    const jsonLdMatches = source.match(
        /"address"\s*:\s*\{[\s\S]*?"streetAddress"\s*:\s*"([^"]+)"[\s\S]*?"addressLocality"\s*:\s*"([^"]+)"[\s\S]*?"addressRegion"\s*:\s*"([^"]+)"/i
    );

    if (jsonLdMatches?.[1]) {
        const street = cleanupCandidateText(jsonLdMatches[1]);
        const city = cleanupCandidateText(jsonLdMatches[2]);
        const state = cleanupCandidateText(jsonLdMatches[3]);
        const combined = [street, city, state].filter(Boolean).join(", ");
        if (combined) candidates.push(combined);
    }

    return Array.from(new Set(candidates.filter(Boolean)));
}

function buildGeocodeQueries(finalUrl, html) {
    const queries = [];
    const fromUrl = extractPlaceTextFromUrl(finalUrl);
    const fromHtml = extractTextCandidatesFromHtml(html);

    for (const item of [...fromUrl, ...fromHtml]) {
        const cleaned = stripGoogleMapsNoise(item);
        if (!cleaned) continue;
        queries.push(cleaned);
    }

    const unique = Array.from(new Set(queries.filter(Boolean)));

    const expanded = [];
    for (const q of unique) {
        expanded.push(q);

        const normalized = normalizeLooseText(q);
        if (
            normalized &&
            !normalized.includes("brasil") &&
            !normalized.includes("brazil") &&
            !normalized.includes("goias") &&
            !normalized.includes("goiás") &&
            !normalized.includes("para") &&
            !normalized.includes("pará") &&
            !normalized.includes("amazonas") &&
            !normalized.includes("minas gerais") &&
            !normalized.includes("parana") &&
            !normalized.includes("paraná") &&
            !normalized.includes("pernambuco") &&
            !normalized.includes("rio grande do norte") &&
            !normalized.includes("maranhao") &&
            !normalized.includes("maranhão")
        ) {
            expanded.push(`${q}, Brasil`);
        }
    }

    return Array.from(new Set(expanded.filter(Boolean)));
}

function looksSpecificEnoughForBrazilGeocode(query) {
    const q = normalizeLooseText(query);
    if (!q) return false;

    const hasNumber = /\b\d{1,6}\b/.test(q);

    const hasStreetWord =
        q.includes("rua ") ||
        q.includes("avenida") ||
        q.includes("av ") ||
        q.includes("av. ") ||
        q.includes("travessa") ||
        q.includes("alameda") ||
        q.includes("estrada") ||
        q.includes("rodovia") ||
        q.includes("bairro");

    const hasBrazilPlaceHint =
        q.includes("belem") ||
        q.includes("belém") ||
        q.includes("ananindeua") ||
        q.includes("marituba") ||
        q.includes("castanhal") ||
        q.includes("para") ||
        q.includes("pará") ||
        q.includes("/pa") ||
        q.includes(" - pa") ||
        q.includes("goiania") ||
        q.includes("goiânia") ||
        q.includes("manaus") ||
        q.includes("natal") ||
        q.includes("recife") ||
        q.includes("curitiba") ||
        q.includes("belo horizonte") ||
        q.includes("sao luis") ||
        q.includes("são luís") ||
        q.includes("brasil");

    return (hasStreetWord && hasNumber) || hasBrazilPlaceHint;
}

async function geocodeTextInBrazil(query) {
    const q = cleanupCandidateText(query);
    if (!q) {
        return { lat: null, lng: null, label: "" };
    }

    const url =
        `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(q)}` +
        `&format=jsonv2` +
        `&limit=3` +
        `&countrycodes=br` +
        `&addressdetails=1` +
        `&accept-language=pt-BR` +
        `&viewbox=-73.99,5.27,-34.79,-33.75`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": "TrackGo/1.0 (maps text geocoder)",
                Accept: "application/json",
            },
        });

        if (!response.ok) {
            return { lat: null, lng: null, label: q };
        }

        const data = await response.json();
        const results = Array.isArray(data) ? data : [];

        for (const item of results) {
            const lat = roundCoord(item?.lat);
            const lng = roundCoord(item?.lon);
            const countryCode = safeString(item?.address?.country_code || "").toLowerCase();
            const displayName = safeString(item?.display_name || "");

            if (!hasValidCoords(lat, lng)) continue;
            if (countryCode !== "br") continue;
            if (!displayName) continue;

            return {
                lat,
                lng,
                label: q,
            };
        }

        return { lat: null, lng: null, label: q };
    } catch {
        return { lat: null, lng: null, label: q };
    }
}

async function fetchUrlFollowingRedirects(url) {
    const source = safeString(url);
    if (!source) {
        return {
            finalUrl: "",
            html: "",
            ok: false,
            status: 0,
        };
    }

    try {
        const response = await fetch(source, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "TrackGo/1.0 (google maps resolver)",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        });

        const finalUrl = safeString(response?.url || source);
        let html = "";

        try {
            html = await response.text();
        } catch {
            html = "";
        }

        return {
            finalUrl,
            html,
            ok: !!response?.ok,
            status: Number(response?.status || 0),
        };
    } catch {
        return {
            finalUrl: source,
            html: "",
            ok: false,
            status: 0,
        };
    }
}

async function resolveCoordsFromGoogleMapsUrl(url) {
    const originalUrl = safeString(url);

    if (!originalUrl || !looksLikeMapsUrl(originalUrl)) {
        return {
            lat: null,
            lng: null,
            source: "",
            resolvedUrl: originalUrl,
            geocodeQuery: "",
        };
    }

    const direct = extractCoordsFromAnyText(originalUrl);
    if (hasValidCoords(direct.lat, direct.lng)) {
        return {
            lat: direct.lat,
            lng: direct.lng,
            source: "maps_url_direct",
            resolvedUrl: originalUrl,
            geocodeQuery: "",
        };
    }

    const fetched = await fetchUrlFollowingRedirects(originalUrl);

    const fromFinalUrl = extractCoordsFromAnyText(fetched.finalUrl);
    if (hasValidCoords(fromFinalUrl.lat, fromFinalUrl.lng)) {
        return {
            lat: fromFinalUrl.lat,
            lng: fromFinalUrl.lng,
            source: "maps_url_redirect",
            resolvedUrl: fetched.finalUrl || originalUrl,
            geocodeQuery: "",
        };
    }

    const fromHtml = extractCoordsFromAnyText(fetched.html);
    if (hasValidCoords(fromHtml.lat, fromHtml.lng)) {
        return {
            lat: fromHtml.lat,
            lng: fromHtml.lng,
            source: "maps_html_text",
            resolvedUrl: fetched.finalUrl || originalUrl,
            geocodeQuery: "",
        };
    }

    const fromHtmlMeta = extractCoordsFromHtmlMeta(fetched.html);
    if (hasValidCoords(fromHtmlMeta.lat, fromHtmlMeta.lng)) {
        return {
            lat: fromHtmlMeta.lat,
            lng: fromHtmlMeta.lng,
            source: "maps_html_meta",
            resolvedUrl: fetched.finalUrl || originalUrl,
            geocodeQuery: "",
        };
    }

    const htmlUrls = extractMapsUrlsFromHtml(fetched.html);
    for (const nestedUrl of htmlUrls) {
        const nestedCoords = extractCoordsFromAnyText(nestedUrl);
        if (hasValidCoords(nestedCoords.lat, nestedCoords.lng)) {
            return {
                lat: nestedCoords.lat,
                lng: nestedCoords.lng,
                source: "maps_nested_url",
                resolvedUrl: nestedUrl,
                geocodeQuery: "",
            };
        }
    }

    const geocodeQueries = buildGeocodeQueries(
        fetched.finalUrl || originalUrl,
        fetched.html
    );

    for (const query of geocodeQueries) {
        if (!looksSpecificEnoughForBrazilGeocode(query)) {
            continue;
        }

        const geocoded = await geocodeTextInBrazil(query);
        if (hasValidCoords(geocoded.lat, geocoded.lng)) {
            return {
                lat: geocoded.lat,
                lng: geocoded.lng,
                source: "maps_text_geocode",
                resolvedUrl: fetched.finalUrl || originalUrl,
                geocodeQuery: geocoded.label || query,
            };
        }
    }

    return {
        lat: null,
        lng: null,
        source: "maps_unresolved",
        resolvedUrl: fetched.finalUrl || originalUrl,
        geocodeQuery: "",
    };
}

module.exports = {
    extractCoordsFromAnyText,
    resolveCoordsFromGoogleMapsUrl,
};