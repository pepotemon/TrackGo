const admin = require("firebase-admin");
const { dayKeyFromMs } = require("../utils/geo");
const { selectAutoAssignUser } = require("./selectAutoAssignUser");
const { logAutoAssign } = require("./autoAssignLogger");

function s(v) {
    return String(v ?? "").trim();
}

async function autoAssignLead(lead) {
    try {
        if (!lead?.id) return;
        if (s(lead.assignedTo)) return;

        const parseStatus = s(lead.parseStatus);
        const verificationStatus = s(lead.verificationStatus);

        if (parseStatus !== "ready") return;

        if (
            verificationStatus !== "pending_review" &&
            verificationStatus !== "verified"
        ) {
            return;
        }

        const selected = await selectAutoAssignUser(lead);
        if (!selected) return;

        const {
            user,
            matchType,
            coverageKey,
            coverageItem,
            stateRef,
        } = selected;

        const now = Date.now();
        const dayKey = dayKeyFromMs(now);
        const clientRef = admin.firestore().collection("clients").doc(lead.id);

        await clientRef.update({
            assignedTo: user.id,
            assignedAt: now,
            assignedDayKey: dayKey,

            status: "pending",
            statusBy: null,
            statusAt: null,

            rejectedReason: null,
            rejectedReasonText: null,
            note: null,

            autoAssignedAt: now,
            autoAssignMatchType: matchType,
            autoAssignCoverageKey: coverageKey,
            assignmentMode: "coverage_auto",

            updatedAt: now,
        });

        await stateRef.set(
            {
                lastAssignedUserId: user.id,
                coverageKey,
                matchType,
                updatedAt: now,
                dayKey,
            },
            { merge: true }
        );

        await logAutoAssign({
            lead,
            user,
            matchType,
            coverageKey,
            coverageItem,
            createdAt: now,
            dayKey,
        });

        console.log("[AUTO ASSIGN] assigned:", {
            clientId: lead.id,
            userId: user.id,
            matchType,
            coverageKey,
            dayKey,
        });
    } catch (e) {
        console.error("[AUTO ASSIGN] autoAssignLead error:", e);
    }
}

module.exports = {
    autoAssignLead,
};