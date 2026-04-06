const admin = require("firebase-admin");

function s(v) {
    return String(v ?? "").trim();
}

async function logAutoAssign({
    lead,
    user,
    matchType,
    coverageKey,
    coverageItem,
}) {
    const now = Date.now();
    const dayKey = new Date(now).toISOString().slice(0, 10);

    await admin.firestore().collection("autoAssignLogs").add({
        leadId: s(lead?.id),
        leadName:
            s(lead?.name) ||
            s(lead?.profileName) ||
            s(lead?.phone) ||
            "Lead",
        leadPhone: s(lead?.phone),
        leadBusiness:
            s(lead?.business) ||
            s(lead?.businessRaw) ||
            null,

        leadGeoAdminDisplayLabel: s(lead?.geoAdminDisplayLabel) || null,
        leadGeoAdminCityLabel: s(lead?.geoAdminCityLabel) || null,
        leadGeoAdminStateLabel: s(lead?.geoAdminStateLabel) || null,
        leadGeoHubLabel:
            s(lead?.geoNearestHubLabel) ||
            s(lead?.geoCityLabel) ||
            null,

        userId: s(user?.id),
        userName: s(user?.name) || s(user?.email) || "Usuario",
        userCoverageLabel:
            s(user?.primaryGeoCoverageLabel) ||
            s(coverageItem?.displayLabel) ||
            s(coverageItem?.cityLabel) ||
            s(coverageItem?.stateLabel) ||
            s(coverageItem?.countryLabel) ||
            null,

        matchType: s(matchType),
        coverageKey: s(coverageKey),

        createdAt: now,
        dayKey,
        mode: "coverage_auto",
    });
}

module.exports = {
    logAutoAssign,
};