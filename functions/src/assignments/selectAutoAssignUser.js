const admin = require("firebase-admin");
const { matchUserToLead, sn } = require("./coverageMatcher");

async function countUserAssignmentsToday(dayKey, userId, coverageKey) {
    const snap = await admin
        .firestore()
        .collection("autoAssignLogs")
        .where("dayKey", "==", dayKey)
        .where("userId", "==", userId)
        .where("coverageKey", "==", coverageKey)
        .get();

    return snap.size || 0;
}

async function selectAutoAssignUser(lead) {
    const usersSnap = await admin.firestore().collection("users").get();

    const candidates = [];

    usersSnap.forEach((doc) => {
        const user = { id: doc.id, ...doc.data() };

        if (!user?.active) return;
        if (user?.role !== "user") return;
        if (!user?.autoAssignEnabled) return;

        const match = matchUserToLead(user, lead);
        if (!match.match) return;

        candidates.push({
            user,
            matchType: match.matchType,
            coverageKey: match.coverageKey,
            coverageItem: match.coverageItem,
        });
    });

    if (!candidates.length) return null;

    const grouped = new Map();

    for (const item of candidates) {
        const key = item.coverageKey;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(item);
    }

    const preferredKeys = Array.from(grouped.keys()).sort((a, b) => {
        const rank = (key) => {
            if (key.startsWith("city:")) return 1;
            if (key.startsWith("hub:")) return 2;
            if (key.startsWith("state:")) return 3;
            if (key.startsWith("country:")) return 4;
            return 99;
        };

        return rank(a) - rank(b);
    });

    const selectedCoverageKey = preferredKeys[0];
    const bucket = grouped.get(selectedCoverageKey) || [];

    if (!bucket.length) return null;

    const dayKey = new Date().toISOString().slice(0, 10);

    const enriched = [];
    for (const item of bucket) {
        const userDailyCount = await countUserAssignmentsToday(
            dayKey,
            item.user.id,
            selectedCoverageKey
        );

        const rawLimit = item.user?.autoAssignDailyLimit;
        const dailyLimit =
            typeof rawLimit === "number" && Number.isFinite(rawLimit)
                ? rawLimit
                : null;

        if (dailyLimit != null && userDailyCount >= dailyLimit) {
            continue;
        }

        enriched.push({
            ...item,
            userDailyCount,
            autoAssignPriority:
                typeof item.user?.autoAssignPriority === "number" &&
                    Number.isFinite(item.user.autoAssignPriority)
                    ? item.user.autoAssignPriority
                    : 999,
        });
    }

    if (!enriched.length) return null;

    const stateRef = admin
        .firestore()
        .collection("autoAssignState")
        .doc(`coverage__${selectedCoverageKey}`);

    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? stateSnap.data() || {} : {};
    const lastAssignedUserId = sn(state.lastAssignedUserId || "");

    enriched.sort((a, b) => {
        if (a.userDailyCount !== b.userDailyCount) {
            return a.userDailyCount - b.userDailyCount;
        }

        const aWasLast = sn(a.user.id) === lastAssignedUserId ? 1 : 0;
        const bWasLast = sn(b.user.id) === lastAssignedUserId ? 1 : 0;
        if (aWasLast !== bWasLast) {
            return aWasLast - bWasLast;
        }

        if (a.autoAssignPriority !== b.autoAssignPriority) {
            return a.autoAssignPriority - b.autoAssignPriority;
        }

        const aName = String(a.user?.name || a.user?.email || a.user?.id || "");
        const bName = String(b.user?.name || b.user?.email || b.user?.id || "");
        return aName.localeCompare(bName, "es", { sensitivity: "base" });
    });

    return {
        ...enriched[0],
        stateRef,
        dayKey,
    };
}

module.exports = {
    selectAutoAssignUser,
};