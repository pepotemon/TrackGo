const admin = require("firebase-admin");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");

admin.initializeApp();

async function sendExpoPush(expoPushToken, title, body, data) {
    const message = {
        to: expoPushToken,
        sound: "default",
        title,
        body,
        data: data || {},
    };

    // Node 22+ trae fetch nativo ✅
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Accept-encoding": "gzip, deflate",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
    });

    const json = await res.json();
    return json;
}

async function notifyAssignedUser({ clientId, after }) {
    const afterUid = after.assignedTo || null;
    if (!afterUid) return;

    const userSnap = await admin.firestore().doc(`users/${afterUid}`).get();
    if (!userSnap.exists) return;

    const user = userSnap.data() || {};
    const token = user.expoPushToken;

    if (!token) {
        console.log("[PUSH] user has no expoPushToken", afterUid);
        return;
    }

    const name = (after.name || "Cliente").toString();
    const business = (after.business || "").toString().trim();
    const label = business ? `${name} · ${business}` : name;

    const title = "Nuevo cliente asignado";
    const body = label;

    const result = await sendExpoPush(token, title, body, {
        type: "client_assigned",
        clientId,
    });

    console.log("[PUSH] sent:", result);
}

// ✅ 1) Cliente NUEVO creado ya con assignedTo
exports.onClientCreatedAssigned = onDocumentCreated("clients/{clientId}", async (event) => {
    const clientId = event.params.clientId;
    const after = event.data?.data() || {};

    // Solo si se crea ya asignado
    if (!after.assignedTo) return;

    try {
        await notifyAssignedUser({ clientId, after });
    } catch (e) {
        console.log("[PUSH] create error:", e);
    }
});

// ✅ 2) Cliente REASIGNADO (cambió assignedTo)
exports.onClientReassigned = onDocumentUpdated("clients/{clientId}", async (event) => {
    const clientId = event.params.clientId;

    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};

    const beforeUid = before.assignedTo || null;
    const afterUid = after.assignedTo || null;

    // Solo cuando realmente cambió
    if (!afterUid || beforeUid === afterUid) return;

    try {
        await notifyAssignedUser({ clientId, after });
    } catch (e) {
        console.log("[PUSH] update error:", e);
    }
});