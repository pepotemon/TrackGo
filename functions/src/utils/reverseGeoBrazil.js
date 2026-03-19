function safeString(value) {
    return String(value ?? "").trim();
}

function safeLower(value) {
    return safeString(value).toLowerCase();
}

function cleanupGeoLabel(value) {
    return safeString(value)
        .replace(/\s+/g, " ")
        .trim();
}

function pickFirstAddressValue(address, keys) {
    for (const key of keys) {
        const value = cleanupGeoLabel(address?.[key]);
        if (value) return value;
    }
    return "";
}

function normalizeGeoKey(value) {
    return safeLower(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || null;
}

function buildEmptyReverseGeoBrazil() {
    return {
        geoAdminCityLabel: null,
        geoAdminCityNormalized: null,
        geoAdminStateLabel: null,
        geoAdminStateNormalized: null,
        geoAdminCountryLabel: null,
        geoAdminCountryNormalized: null,
        geoAdminSource: null,
        geoAdminResolvedAt: null,
        geoAdminDisplayLabel: null,
    };
}

function buildDisplayLabel(city, state) {
    const c = cleanupGeoLabel(city);
    const s = cleanupGeoLabel(state);

    if (c && s) return `${c} · ${s}`;
    if (c) return c;
    if (s) return s;
    return null;
}

async function reverseGeoBrazil(lat, lng, now = Date.now()) {
    const numLat = Number(lat);
    const numLng = Number(lng);

    if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
        return buildEmptyReverseGeoBrazil();
    }

    const url =
        `https://nominatim.openstreetmap.org/reverse` +
        `?lat=${encodeURIComponent(numLat)}` +
        `&lon=${encodeURIComponent(numLng)}` +
        `&format=jsonv2` +
        `&addressdetails=1` +
        `&zoom=18` +
        `&accept-language=pt-BR`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": "TrackGo/1.0 (lead reverse geocoding)",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            return buildEmptyReverseGeoBrazil();
        }

        const data = await response.json();
        const address = data?.address || {};

        const city = pickFirstAddressValue(address, [
            "city",
            "town",
            "village",
            "municipality",
            "city_district",
            "suburb",
            "county",
        ]);

        const state = pickFirstAddressValue(address, [
            "state",
            "region",
        ]);

        const country = pickFirstAddressValue(address, [
            "country",
        ]);

        const result = {
            geoAdminCityLabel: city || null,
            geoAdminCityNormalized: normalizeGeoKey(city),
            geoAdminStateLabel: state || null,
            geoAdminStateNormalized: normalizeGeoKey(state),
            geoAdminCountryLabel: country || null,
            geoAdminCountryNormalized: normalizeGeoKey(country),
            geoAdminSource: "nominatim_reverse",
            geoAdminResolvedAt: now,
            geoAdminDisplayLabel: buildDisplayLabel(city, state),
        };

        return result;
    } catch (error) {
        console.log("[reverseGeoBrazil] error:", error?.message || error);
        return buildEmptyReverseGeoBrazil();
    }
}

module.exports = {
    buildEmptyReverseGeoBrazil,
    reverseGeoBrazil,
};