function sn(v) {
    return String(v ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[\s\-\/]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function s(v) {
    return String(v ?? "").trim();
}

function getLeadGeo(lead) {
    return {
        adminCity: sn(lead?.geoAdminCityNormalized),
        adminState: sn(lead?.geoAdminStateNormalized),
        adminCountry: sn(lead?.geoAdminCountryNormalized || "brasil"),
        hubCity: sn(lead?.geoCityNormalized),

        adminCityLabel: s(lead?.geoAdminCityLabel),
        adminStateLabel: s(lead?.geoAdminStateLabel),
        adminCountryLabel: s(lead?.geoAdminCountryLabel || "Brasil"),
        hubCityLabel: s(lead?.geoCityLabel),
        displayLabel:
            s(lead?.geoAdminDisplayLabel) ||
            s(lead?.geoNearestHubLabel) ||
            s(lead?.geoAdminCityLabel) ||
            s(lead?.geoCityLabel) ||
            "Sin cobertura detectada",
    };
}

function getUserCoverage(user) {
    const raw = Array.isArray(user?.geoCoverage) ? user.geoCoverage : [];

    return raw
        .filter((c) => c && typeof c === "object" && c.active !== false)
        .map((c) => ({
            ...c,
            type: sn(c.type),
            cityNormalized: sn(c.cityNormalized),
            stateNormalized: sn(c.stateNormalized),
            countryNormalized: sn(c.countryNormalized || "brasil"),
            cityLabel: s(c.cityLabel),
            stateLabel: s(c.stateLabel),
            countryLabel: s(c.countryLabel || "Brasil"),
            displayLabel: s(c.displayLabel),
        }));
}

function buildCoverageKey({
    matchType,
    cityNormalized = "",
    stateNormalized = "",
    countryNormalized = "brasil",
}) {
    const city = sn(cityNormalized);
    const state = sn(stateNormalized);
    const country = sn(countryNormalized || "brasil");

    if (matchType === "city") {
        return `city:${city}:${state || "na"}:${country || "brasil"}`;
    }

    if (matchType === "hub_city") {
        return `hub:${city}`;
    }

    if (matchType === "state") {
        return `state:${state}:${country || "brasil"}`;
    }

    if (matchType === "country") {
        return `country:${country || "brasil"}`;
    }

    return "";
}

function matchCoverageItemToLead(item, lead) {
    const geo = getLeadGeo(lead);

    if (item.type === "city") {
        if (
            geo.adminCity &&
            item.cityNormalized &&
            geo.adminCity === item.cityNormalized
        ) {
            return {
                match: true,
                matchType: "city",
                coverageKey: buildCoverageKey({
                    matchType: "city",
                    cityNormalized: geo.adminCity,
                    stateNormalized: geo.adminState || item.stateNormalized,
                    countryNormalized: geo.adminCountry || item.countryNormalized,
                }),
                matchedCityNormalized: geo.adminCity,
                matchedStateNormalized: geo.adminState || item.stateNormalized || "",
                matchedCountryNormalized: geo.adminCountry || item.countryNormalized || "brasil",
            };
        }

        if (
            geo.hubCity &&
            item.cityNormalized &&
            geo.hubCity === item.cityNormalized
        ) {
            return {
                match: true,
                matchType: "hub_city",
                coverageKey: buildCoverageKey({
                    matchType: "hub_city",
                    cityNormalized: geo.hubCity,
                }),
                matchedCityNormalized: geo.hubCity,
                matchedStateNormalized: geo.adminState || item.stateNormalized || "",
                matchedCountryNormalized: geo.adminCountry || item.countryNormalized || "brasil",
            };
        }

        return { match: false };
    }

    if (item.type === "state") {
        if (
            geo.adminState &&
            item.stateNormalized &&
            geo.adminState === item.stateNormalized
        ) {
            return {
                match: true,
                matchType: "state",
                coverageKey: buildCoverageKey({
                    matchType: "state",
                    stateNormalized: geo.adminState,
                    countryNormalized: geo.adminCountry || item.countryNormalized,
                }),
                matchedCityNormalized: geo.adminCity || geo.hubCity || "",
                matchedStateNormalized: geo.adminState,
                matchedCountryNormalized: geo.adminCountry || item.countryNormalized || "brasil",
            };
        }

        return { match: false };
    }

    if (item.type === "country") {
        if (
            geo.adminCountry &&
            item.countryNormalized &&
            geo.adminCountry === item.countryNormalized
        ) {
            return {
                match: true,
                matchType: "country",
                coverageKey: buildCoverageKey({
                    matchType: "country",
                    countryNormalized: geo.adminCountry,
                }),
                matchedCityNormalized: geo.adminCity || geo.hubCity || "",
                matchedStateNormalized: geo.adminState || "",
                matchedCountryNormalized: geo.adminCountry,
            };
        }

        return { match: false };
    }

    return { match: false };
}

function matchUserToLead(user, lead) {
    const coverage = getUserCoverage(user);

    if (!user?.active) return { match: false };
    if (user?.role !== "user") return { match: false };
    if (!coverage.length) return { match: false };

    for (const item of coverage) {
        const result = matchCoverageItemToLead(item, lead);
        if (!result.match) continue;

        return {
            match: true,
            matchType: result.matchType,
            coverageKey: result.coverageKey,
            coverageItem: item,
            matchedCityNormalized: result.matchedCityNormalized,
            matchedStateNormalized: result.matchedStateNormalized,
            matchedCountryNormalized: result.matchedCountryNormalized,
        };
    }

    return { match: false };
}

module.exports = {
    sn,
    s,
    getLeadGeo,
    getUserCoverage,
    buildCoverageKey,
    matchCoverageItemToLead,
    matchUserToLead,
};