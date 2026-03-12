const { db } = require("../core/firebase");

async function sendExpoPush(expoPushToken, title, body, data) {
    const message = {
        to: expoPushToken,
        sound: "default",
        title,
        body,
        data: data || {},
    };

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

    const userSnap = await db.doc(`users/${afterUid}`).get();
    if (!userSnap.exists) return;

    const user = userSnap.data() || {};
    const token = user.expoPushToken;

    if (!token) {
        console.log("[PUSH] user has no expoPushToken", afterUid);
        return;
    }

    const name = (after.name || "Cliente").toString();
    const business = (after.business || after.businessRaw || "").toString().trim();
    const label = business ? `${name} · ${business}` : name;

    const title = "Novo cliente atribuído";
    const body = label;

    const result = await sendExpoPush(token, title, body, {
        type: "client_assigned",
        clientId,
    });

    console.log("[PUSH] sent:", result);
}

module.exports = {
    sendExpoPush,
    notifyAssignedUser,
};