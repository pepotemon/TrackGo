const { safeString } = require("../utils/text");
const {
    WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID,
} = require("../config/params");

async function sendWhatsAppText(to, body) {
    const accessToken = safeString(WHATSAPP_ACCESS_TOKEN.value());
    const phoneNumberId = safeString(WHATSAPP_PHONE_NUMBER_ID.value());

    if (!accessToken || !phoneNumberId || !to || !body) {
        console.log("[WHATSAPP BOT] missing config or payload", {
            hasAccessToken: !!accessToken,
            hasPhoneNumberId: !!phoneNumberId,
            hasTo: !!to,
            hasBody: !!body,
        });
        return null;
    }

    const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
            preview_url: false,
            body,
        },
    };

    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
        console.error("[WHATSAPP BOT] send error:", json);
        throw new Error(
            json?.error?.message || `whatsapp_send_failed_${res.status}`
        );
    }

    return json;
}

module.exports = {
    sendWhatsAppText,
};