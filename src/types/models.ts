// ----------------------
// USERS
// ----------------------
export type UserRole = "admin" | "user";

/**
 * ✅ Tipo de cobertura geográfica manual del usuario
 * - city: ciudad/municipio principal
 * - district: barrio / distrito / zona puntual
 * - state: estado completo (uso excepcional)
 */
export type UserGeoCoverageType = "city" | "district" | "state";

/**
 * ✅ Cobertura territorial asignada al usuario
 * Se usa para matching futuro contra el geo detectado del lead.
 */
export type UserGeoCoverage = {
    id: string;

    /**
     * Tipo de cobertura
     */
    type: UserGeoCoverageType;

    /**
     * País
     */
    countryLabel: string;
    countryNormalized: string;

    /**
     * Estado
     */
    stateLabel: string;
    stateNormalized: string;

    /**
     * Ciudad / municipio / localidad principal
     */
    cityLabel: string;
    cityNormalized: string;

    /**
     * Label final lista para UI
     * Ej: "Goiás · Goiânia"
     */
    displayLabel: string;

    /**
     * Metadata opcional
     */
    source?: "manual";
    active?: boolean;

    createdAt?: number;
    updatedAt?: number;
};

export type UserDoc = {
    id: string;

    name: string;
    email: string;

    role: UserRole;
    active: boolean;

    createdAt: number; // Date.now()
    updatedAt?: number;

    /**
     * ✅ Campo oficial de monetización
     * Tarifa por cliente visitado (R$)
     */
    ratePerVisit?: number;

    /**
     * ✅ Push notifications (Expo)
     * El user puede actualizar esto (rules).
     */
    expoPushToken?: string | null;
    expoPushTokenUpdatedAt?: number | null; // ms

    /**
     * ✅ WhatsApp / teléfono operativo
     */
    whatsappPhone?: string | null;

    /**
     * ✅ Coberturas geográficas manuales del usuario
     * Base para asignación semi-auto / auto.
     */
    geoCoverage?: UserGeoCoverage[];

    /**
     * ✅ Campo rápido opcional para UI / filtros
     * primera ciudad principal visible
     */
    primaryGeoCoverageLabel?: string | null;
};

// ----------------------
// CLIENTS
// ----------------------
export type ClientStatus = "pending" | "visited" | "rejected";

/**
 * ✅ Motivos permitidos de rechazo
 */
export type RejectedReason =
    | "clavo"
    | "localizacion"
    | "zona_riesgosa"
    | "ingresos_insuficientes"
    | "muy_endeudado"
    | "informacion_dudosa"
    | "no_le_interesa"
    | "no_estaba_cerrado"
    | "fuera_de_ruta"
    | "otro";

export type ClientSource = "manual" | "whatsapp_meta";
export type ClientParseStatus = "empty" | "partial" | "ready";

/**
 * ✅ Etapa del bot / flujo
 */
export type ClientBotStage =
    | "collecting"
    | "final"
    | "intro"
    | "coverage_check"
    | "missing:business"
    | "missing:maps"
    | "missing:business,maps"
    | "final:how_it_works"
    | "final:not_suitable"
    | string;

/**
 * ✅ Calidad del negocio detectado
 */
export type ClientBusinessQuality = "unknown" | "clear" | "mixed" | "review";

/**
 * ✅ Flags automáticos detectados
 */
export type ClientAutoFlag =
    | "retirement_profile"
    | "salary_profile"
    | "app_driver_profile"
    | "normalized_business_label"
    | "multi_signal_business"
    | "mixed_business_signals"
    | "fallback_business_detected";

/**
 * ✅ Tipo de perfil detectado
 */
export type ClientProfileType =
    | "business"
    | "app_driver"
    | "retired"
    | "salary_worker"
    | "mixed_restricted";

/**
 * ✅ Calidad operativa del lead
 */
export type ClientLeadQuality = "unknown" | "valid" | "review" | "not_suitable";

/**
 * ✅ Clasificación manual/operativa del admin
 */
export type ClientVerificationStatus =
    | "verified"
    | "pending_review"
    | "incomplete"
    | "not_suitable";

/**
 * ✅ Nuevo: control del modo de conversación
 * - bot: responde el bot
 * - human: responde humano / takeover manual
 * - hybrid: reservado para futuro
 */
export type ClientChatMode = "bot" | "human" | "hybrid";

/**
 * ✅ Nuevo: bucket lógico para historial de leads
 */
export type ClientLeadHistoryBucket = "incomplete" | "not_suitable";

/**
 * ✅ Nuevo: confianza del geo comercial / reverse geocoding
 */
export type ClientGeoConfidence = "high" | "medium" | "low";

/**
 * ✅ Nuevo:
 * geo comercial / operativo (trackgo)
 * - geoCityLabel: plaza/hub comercial detectado
 * - geoOutOfCoverage: true si cayó fuera del radio operativo
 *
 * ✅ Nuevo:
 * geo administrativo real (reverse geocoding)
 * - ciudad / estado / país detectados por coordenadas reales
 */
export type ClientDoc = {
    id: string;

    name?: string;
    business?: string;

    /**
     * ✅ Texto bruto / original del negocio detectado
     * útil para auditoría o UI
     */
    businessRaw?: string;

    phone: string;
    mapsUrl: string;
    address?: string;

    /**
     * ✅ Coordenadas opcionales
     * para mapa / proximidad / rutas
     */
    lat?: number | null;
    lng?: number | null;

    assignedTo?: string;
    assignedAt?: number;
    assignedDayKey?: number | string;

    /**
     * Estado actual REAL del cliente
     */
    status: ClientStatus;

    /**
     * Quién marcó el último estado.
     * Cuando vuelve a "pending" → debe ser null.
     */
    statusBy?: string | null;

    /**
     * Timestamp del último cambio de estado.
     * Cuando vuelve a "pending" → debe ser null.
     */
    statusAt?: number | null;

    createdAt: number; // ms
    updatedAt: number; // ms

    /**
     * ✅ Compat (legacy):
     * algunos flujos viejos guardaban el motivo en note.
     * Puede ser texto libre.
     */
    note?: string | null;

    /**
     * ✅ Nuevo (preferido):
     * motivo estructurado para rejected.
     */
    rejectedReason?: RejectedReason | null;

    /**
     * ✅ Nuevo:
     * texto libre cuando rejectedReason === "otro"
     */
    rejectedReasonText?: string | null;

    /**
     * ✅ Nuevo: origen del cliente
     */
    source?: ClientSource;

    /**
     * ✅ Nuevo: referencia al inbox/lead original
     */
    sourceRef?: string | null;

    /**
     * ✅ Nuevo: calidad del parseo automático
     */
    parseStatus?: ClientParseStatus;

    /**
     * ✅ Nuevo: marca de captura automática
     */
    autoCapturedAt?: number | null;

    /**
     * ✅ Nuevo: última actividad inbound
     */
    lastInboundMessageAt?: number | null;

    /**
     * ✅ Nuevo: última actividad outbound
     */
    lastOutboundAt?: number | null;

    /**
     * ✅ Nuevo: id del mensaje más reciente
     */
    lastMessageId?: string | null;

    /**
     * ✅ Nuevo: texto del último mensaje inbound
     */
    lastInboundText?: string | null;

    /**
     * ✅ Nuevo: intención detectada del último inbound
     */
    lastInboundIntent?: string | null;

    /**
     * ✅ Nuevo: waId / teléfono oficial desde Meta
     */
    waId?: string | null;

    /**
     * ✅ Nuevo: control del último reply automático del bot
     */
    lastBotReplyAt?: number | null;
    lastBotReplyText?: string | null;
    lastBotStage?: ClientBotStage | null;

    /**
     * ✅ Nuevo: intro inicial enviada por el bot
     */
    initialIntroSentAt?: number | null;

    /**
     * ✅ Nuevo: confirma que este lead actual sí mandó maps
     * para no heredar maps viejos y dar por válido un lead nuevo
     */
    currentLeadMapsConfirmedAt?: number | null;

    /**
     * ✅ Nuevo: semántica automática del negocio
     */
    businessQuality?: ClientBusinessQuality;
    businessFlags?: ClientAutoFlag[];

    /**
     * ✅ Nuevo: semántica automática del perfil
     */
    profileFlags?: ClientAutoFlag[];
    profileType?: ClientProfileType;
    leadQuality?: ClientLeadQuality;
    notSuitableReason?: string | null;

    /**
     * ✅ Nuevo: clasificación manual/admin del lead
     */
    verificationStatus?: ClientVerificationStatus;
    verifiedAt?: number | null;
    verifiedBy?: string | null;
    manualReviewNote?: string | null;

    /**
     * ✅ Nuevo:
     * cuándo entró al verificationStatus actual
     */
    verificationStatusChangedAt?: number | null;

    /**
     * ✅ Nuevo:
     * flags persistidos de historial lógico
     * (quedan listos para fase 2 / cron / backfill)
     */
    leadHistoryArchivedAt?: number | null;
    leadHistoryBucket?: ClientLeadHistoryBucket | null;

    /**
     * ✅ Nuevo: takeover humano / modo chat
     */
    chatMode?: ClientChatMode;
    botPausedAt?: number | null;
    botPausedBy?: string | null;
    humanTakeoverAt?: number | null;
    humanTakeoverBy?: string | null;
    resumeBotAt?: number | null;
    resumeBotBy?: string | null;

    /**
     * ✅ Nuevo: última respuesta manual
     */
    lastManualReplyAt?: number | null;
    lastManualReplyText?: string | null;
    lastManualReplyBy?: string | null;

    /**
     * ✅ Nuevo: cola admin / mensajes vistos
     */
    adminQueueLastSeenMessageAt?: number | null;
    adminQueueSeenAt?: number | null;

    /**
     * ✅ Nuevo: geocoding comercial / hub operativo
     */
    geoCityLabel?: string | null;
    geoCityNormalized?: string | null;
    geoCluster?: string | null;
    geoSource?: string | null;
    geoResolvedAt?: number | null;
    geoDistanceToHubKm?: number | null;
    geoOutOfCoverage?: boolean | null;
    geoConfidence?: ClientGeoConfidence | null;
    geoNearestHubKey?: string | null;
    geoNearestHubLabel?: string | null;

    /**
     * ✅ Nuevo: reverse geocoding administrativo real
     */
    geoAdminCityLabel?: string | null;
    geoAdminCityNormalized?: string | null;
    geoAdminStateLabel?: string | null;
    geoAdminStateNormalized?: string | null;
    geoAdminCountryLabel?: string | null;
    geoAdminCountryNormalized?: string | null;
    geoAdminSource?: string | null;
    geoAdminResolvedAt?: number | null;

    /**
     * ✅ Nuevo:
     * label final lista para UI
     * prioridad típica:
     * geoAdminCityLabel || geoNearestHubLabel || geoState...
     */
    geoAdminDisplayLabel?: string | null;
};

// ----------------------
// CLIENT MESSAGES / CHAT
// ----------------------
export type ClientMessageDirection = "inbound" | "outbound";
export type ClientMessageSenderType = "client" | "bot" | "admin";
export type ClientMessageStatus = "received" | "sent" | "error";

export type ClientMessageDoc = {
    id: string;
    clientId: string;

    direction: ClientMessageDirection;
    senderType: ClientMessageSenderType;

    /**
     * client  -> waId
     * bot     -> "system_bot"
     * admin   -> uid del admin
     */
    senderId?: string | null;

    text: string;
    messageType?: string | null;

    whatsappMessageId?: string | null;
    status?: ClientMessageStatus | string | null;

    createdAt: number;

    /**
     * Meta opcional para UI / auditoría
     */
    source?: string | null;
    stage?: string | null;
    profileName?: string | null;
    mapsUrl?: string | null;
    locationCaptured?: boolean | null;
    lat?: number | null;
    lng?: number | null;
};

// ----------------------
// DAILY EVENTS
// ----------------------
export type DailyEventType = "visited" | "rejected" | "pending";

/**
 * Historial (auditoría).
 * ⚠️ NO usar para monetización si no filtras por status actual del client.
 */
export type DailyEventDoc = {
    id: string;

    type: DailyEventType;

    userId: string; // actor que hizo el cambio
    clientId: string;

    // snapshot opcional (debug / historial)
    phone?: string;
    name?: string;
    business?: string;
    address?: string;

    /**
     * ✅ Compat (legacy): motivo como texto libre
     */
    note?: string | null;

    /**
     * ✅ Nuevo (preferido): motivo estructurado
     * Solo debería venir cuando type === "rejected"
     */
    rejectedReason?: RejectedReason | null;

    /**
     * ✅ Nuevo:
     * texto libre cuando rejectedReason === "otro"
     */
    rejectedReasonText?: string | null;

    createdAt: number; // ms
    dayKey: string; // "YYYY-MM-DD"
};

// ----------------------
// INCOMING LEADS / WHATSAPP
// ----------------------
export type IncomingLeadStatus = "processing" | "processed" | "error";
export type IncomingLeadResult = "created" | "updated_existing" | "ignored";

export type IncomingLeadDoc = {
    id: string;
    source: "whatsapp_meta";
    channel: "whatsapp";

    phone: string;
    waId?: string;
    profileName?: string;

    rawText?: string;
    messageType?: string;

    parsedName?: string;
    parsedAddress?: string;
    parsedBusiness?: string;
    parsedBusinessRaw?: string;
    parseStatus?: ClientParseStatus;

    /**
     * ✅ Calidad automática negocio/perfil
     */
    businessQuality?: ClientBusinessQuality;
    businessFlags?: ClientAutoFlag[];
    profileFlags?: ClientAutoFlag[];
    profileType?: ClientProfileType;
    leadQuality?: ClientLeadQuality;
    notSuitableReason?: string | null;
    verificationStatus?: ClientVerificationStatus;

    /**
     * ✅ Si llegó ubicación de WhatsApp
     */
    mapsUrl?: string;
    lat?: number | null;
    lng?: number | null;
    locationAddress?: string;
    locationName?: string;
    locationCaptured?: boolean;

    /**
     * ✅ Nuevo: geo operativo / reverse geo
     */
    geoCityLabel?: string | null;
    geoCityNormalized?: string | null;
    geoCluster?: string | null;
    geoSource?: string | null;
    geoResolvedAt?: number | null;
    geoDistanceToHubKm?: number | null;
    geoOutOfCoverage?: boolean | null;
    geoConfidence?: ClientGeoConfidence | null;
    geoNearestHubKey?: string | null;
    geoNearestHubLabel?: string | null;

    geoAdminCityLabel?: string | null;
    geoAdminCityNormalized?: string | null;
    geoAdminStateLabel?: string | null;
    geoAdminStateNormalized?: string | null;
    geoAdminCountryLabel?: string | null;
    geoAdminCountryNormalized?: string | null;
    geoAdminSource?: string | null;
    geoAdminResolvedAt?: number | null;
    geoAdminDisplayLabel?: string | null;

    clientId?: string;
    result?: IncomingLeadResult;
    status?: IncomingLeadStatus;
    error?: string | null;

    createdAt: number;
    processedAt?: number;
    dayKey: string;

    /**
     * ✅ Control de mensajes ignorados
     */
    ignored?: boolean;
    ignoreReason?: string | null;

    /**
     * ✅ Flags del flujo
     */
    greetingDetected?: boolean;

    /**
     * ✅ Estado de la respuesta automática del bot
     */
    botReplyStatus?: "sent" | "skipped" | "error";
    botReplyReason?: string | null;
    botReplyError?: string | null;
    botReplyText?: string | null;
    botReplyAt?: number;
    botReplyMessageId?: string | null;
    botReplyStage?: string | null;
    botReplyPlannedDelayMs?: number | null;
};

// ----------------------
// ACCOUNTING / INVESTMENTS
// ----------------------
export type WeeklyInvestmentDoc = {
    id: string; // weekStartKey (docId recomendado)
    weekStartKey: string; // "YYYY-MM-DD" (lunes)
    weekEndKey: string; // "YYYY-MM-DD" (domingo)

    /**
     * Monto invertido esa semana (R$)
     */
    amount: number;

    createdAt: number; // ms
    updatedAt: number; // ms
};