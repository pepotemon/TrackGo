const { defineString } = require("firebase-functions/params");

const WHATSAPP_VERIFY_TOKEN = defineString("WHATSAPP_VERIFY_TOKEN");
const WHATSAPP_ACCESS_TOKEN = defineString("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = defineString("WHATSAPP_PHONE_NUMBER_ID");

module.exports = {
    WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID,
};