const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, admin } = require("../core/firebase");

function cleanString(v) {
    return String(v ?? "").trim();
}

function cleanPhone(v) {
    return String(v ?? "").replace(/\D+/g, "");
}

function cleanNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

async function assertAdmin(uid) {
    const snap = await db.doc(`users/${uid}`).get();
    const user = snap.exists ? snap.data() : null;

    if (!user || user.role !== "admin" || user.active !== true) {
        throw new HttpsError("permission-denied", "Solo un admin activo puede crear usuarios.");
    }
}

exports.createManagedUser = onCall(
    {
        region: "us-central1",
    },
    async (request) => {
        if (!request.auth?.uid) {
            throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
        }

        await assertAdmin(request.auth.uid);

        const data = request.data || {};

        const name = cleanString(data.name) || "Usuario";
        const email = cleanString(data.email).toLowerCase();
        const password = cleanString(data.password);
        const role = data.role === "admin" ? "admin" : "user";
        const now = Date.now();

        if (!email) {
            throw new HttpsError("invalid-argument", "Email requerido.");
        }

        if (password.length < 6) {
            throw new HttpsError("invalid-argument", "La contraseña debe tener mínimo 6 caracteres.");
        }

        const authUser = await admin.auth().createUser({
            email,
            password,
            displayName: name,
            disabled: false,
        });

        const geoCoverage = Array.isArray(data.geoCoverage) ? data.geoCoverage : [];

        await db.doc(`users/${authUser.uid}`).set(
            {
                id: authUser.uid,
                name,
                email,
                role,
                active: true,

                ratePerVisit: cleanNumber(data.ratePerVisit),

                billingMode:
                    data.billingMode === "weekly_subscription"
                        ? "weekly_subscription"
                        : "per_visit",
                weeklySubscriptionAmount: cleanNumber(data.weeklySubscriptionAmount),
                weeklySubscriptionCost: cleanNumber(data.weeklySubscriptionCost),
                weeklySubscriptionActive: data.weeklySubscriptionActive !== false,
                weeklySubscriptionWeeks: {},

                whatsappPhone: cleanPhone(data.whatsappPhone),

                geoCoverage,
                primaryGeoCoverageLabel: data.primaryGeoCoverageLabel || geoCoverage[0]?.displayLabel || null,

                autoAssignEnabled: data.autoAssignEnabled === true,
                autoAssignDailyLimit:
                    data.autoAssignEnabled === true && data.autoAssignDailyLimit != null
                        ? cleanNumber(data.autoAssignDailyLimit)
                        : null,
                autoAssignPriority: 1,
                assignmentMode: "round_robin",

                createdAt: now,
                updatedAt: now,
            },
            { merge: true }
        );

        return {
            uid: authUser.uid,
            email,
        };
    }
);