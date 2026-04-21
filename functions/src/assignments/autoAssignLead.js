const admin = require("firebase-admin");
const { dayKeyFromMs } = require("../utils/geo");
const { selectAutoAssignUser } = require("./selectAutoAssignUser");
const { logAutoAssign } = require("./autoAssignLogger");

function s(v) {
    return String(v ?? "").trim();
}

async function autoAssignLead(lead) {
    try {
        if (!lead?.id) {
            console.log("[AUTO ASSIGN] skipped: missing lead.id");
            return;
        }

        if (s(lead.assignedTo)) {
            console.log("[AUTO ASSIGN] skipped: already assigned", {
                clientId: lead.id,
                assignedTo: lead.assignedTo,
            });
            return;
        }

        const parseStatus = s(lead.parseStatus);
        const verificationStatus = s(lead.verificationStatus);

        if (parseStatus !== "ready") {
            console.log("[AUTO ASSIGN] skipped: parseStatus not ready", {
                clientId: lead.id,
                parseStatus,
            });
            return;
        }

        if (
            verificationStatus !== "pending_review" &&
            verificationStatus !== "verified"
        ) {
            console.log("[AUTO ASSIGN] skipped: invalid verificationStatus", {
                clientId: lead.id,
                verificationStatus,
            });
            return;
        }

        const selected = await selectAutoAssignUser(lead);

        if (!selected) {
            console.log("[AUTO ASSIGN] skipped: no user matched", {
                clientId: lead.id,
                geoAdminCityLabel: lead?.geoAdminCityLabel || "",
                geoCityLabel: lead?.geoCityLabel || "",
                geoAdminStateLabel: lead?.geoAdminStateLabel || "",
            });
            return;
        }

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