const {
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_PHONE_NUMBER_ID_PA,
} = require("../config/params");
const { safeString } = require("../utils/text");

const FALLBACK_PANAMA_PHONE_NUMBER_ID = "1105131466013890";

function buildChannel({
    phoneNumberId,
    displayPhoneNumber = "",
    marketCountry,
    language,
    countryNormalized,
    countryLabel,
}) {
    return {
        phoneNumberId: safeString(phoneNumberId),
        displayPhoneNumber: safeString(displayPhoneNumber),
        marketCountry,
        language,
        countryNormalized,
        countryLabel,
    };
}

function getBrazilPhoneNumberId() {
    return safeString(WHATSAPP_PHONE_NUMBER_ID.value());
}

function getPanamaPhoneNumberId() {
    return safeString(WHATSAPP_PHONE_NUMBER_ID_PA.value()) || FALLBACK_PANAMA_PHONE_NUMBER_ID;
}

function getDefaultWhatsappChannel() {
    return buildChannel({
        phoneNumberId: getBrazilPhoneNumberId(),
        marketCountry: "BR",
        language: "pt-BR",
        countryNormalized: "brasil",
        countryLabel: "Brasil",
    });
}

function getPanamaWhatsappChannel(displayPhoneNumber = "") {
    return buildChannel({
        phoneNumberId: getPanamaPhoneNumberId(),
        displayPhoneNumber,
        marketCountry: "PA",
        language: "es-PA",
        countryNormalized: "panama",
        countryLabel: "Panama",
    });
}

function getWhatsappChannelByPhoneNumberId(phoneNumberId, displayPhoneNumber = "") {
    const id = safeString(phoneNumberId);
    const panamaId = getPanamaPhoneNumberId();

    if (id && id === panamaId) {
        return getPanamaWhatsappChannel(displayPhoneNumber);
    }

    const brId = getBrazilPhoneNumberId();
    if (!id || !brId || id === brId) {
        return buildChannel({
            ...getDefaultWhatsappChannel(),
            phoneNumberId: id || brId,
            displayPhoneNumber,
        });
    }

    return buildChannel({
        ...getDefaultWhatsappChannel(),
        phoneNumberId: id,
        displayPhoneNumber,
    });
}

function getWhatsappChannelFromMetadata(metadata) {
    return getWhatsappChannelByPhoneNumberId(
        metadata?.phone_number_id,
        metadata?.display_phone_number
    );
}

function getWhatsappChannelFromClient(client) {
    const id = safeString(client?.whatsappPhoneNumberId || "");
    const marketCountry = safeString(client?.marketCountry || "");

    if (id || marketCountry === "PA") {
        return getWhatsappChannelByPhoneNumberId(id || getPanamaPhoneNumberId());
    }

    return getDefaultWhatsappChannel();
}

module.exports = {
    FALLBACK_PANAMA_PHONE_NUMBER_ID,
    getPanamaPhoneNumberId,
    getDefaultWhatsappChannel,
    getPanamaWhatsappChannel,
    getWhatsappChannelByPhoneNumberId,
    getWhatsappChannelFromMetadata,
    getWhatsappChannelFromClient,
};
