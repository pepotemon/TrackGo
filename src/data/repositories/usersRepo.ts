import {
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import type { UserDoc, UserGeoCoverage, UserRole } from "../../types/models";
import { col, docRef } from "../firestore";

function safeString(value: unknown) {
    return String(value ?? "").trim();
}

function normalizeLooseText(value: unknown) {
    return safeString(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function normalizePhone(raw?: string | null) {
    return String(raw ?? "").replace(/\D+/g, "");
}

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function buildCoverageId(
    countryNormalized: string,
    stateNormalized: string,
    cityNormalized: string,
    type: string
) {
    return `${type}__${countryNormalized}__${stateNormalized || "all"}__${cityNormalized || "all"}`;
}

function normalizeCoverageItem(input: Partial<UserGeoCoverage> | null | undefined): UserGeoCoverage | null {
    if (!input) return null;

    const type = safeString(input.type || "city") as UserGeoCoverage["type"];
    const countryLabel = safeString(input.countryLabel || "Brasil");
    const countryNormalized = normalizeLooseText(input.countryNormalized || input.countryLabel || "brasil");

    const stateLabel = safeString(input.stateLabel);
    const stateNormalized = normalizeLooseText(input.stateNormalized || input.stateLabel);

    const cityLabel = safeString(input.cityLabel);
    const cityNormalized = normalizeLooseText(input.cityNormalized || input.cityLabel);

    if (type === "country" && (!countryLabel || !countryNormalized)) return null;
    if (type === "state" && (!stateLabel || !stateNormalized)) return null;
    if (type === "city" && (!stateLabel || !stateNormalized || !cityLabel || !cityNormalized)) {
        return null;
    }

    const displayLabel =
        safeString(input.displayLabel) || `${stateLabel} · ${cityLabel}`;

    const now = Date.now();

    return {
        id:
            safeString(input.id) ||
            buildCoverageId(countryNormalized, stateNormalized, cityNormalized, type),
        type,
        countryLabel,
        countryNormalized,
        stateLabel,
        stateNormalized,
        cityLabel,
        cityNormalized,
        displayLabel,
        source: "manual",
        active: input.active !== false,
        createdAt: safeNumber(input.createdAt, now),
        updatedAt: safeNumber(input.updatedAt, now),
    };
}

function normalizeCoverageList(value: unknown): UserGeoCoverage[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const out: UserGeoCoverage[] = [];

    for (const item of value) {
        const normalized = normalizeCoverageItem(item as Partial<UserGeoCoverage>);
        if (!normalized) continue;
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        out.push(normalized);
    }

    return out;
}

function normalizeUserPayload(user: Partial<UserDoc>) {
    const geoCoverage = normalizeCoverageList((user as any).geoCoverage);
    const primaryGeoCoverageLabel =
        safeString((user as any).primaryGeoCoverageLabel) ||
        geoCoverage[0]?.displayLabel ||
        null;

    return {
        ...user,
        name: safeString(user.name || "Usuario"),
        email: safeString(user.email),
        role: (safeString(user.role || "user") as UserRole) || "user",
        active: user.active !== false,
        ratePerVisit: safeNumber((user as any).ratePerVisit, 0),
        billingMode:
            safeString((user as any).billingMode) === "weekly_subscription"
                ? "weekly_subscription"
                : "per_visit",
        weeklySubscriptionAmount: safeNumber((user as any).weeklySubscriptionAmount, 0),
        weeklySubscriptionCost: safeNumber((user as any).weeklySubscriptionCost, 0),
        weeklySubscriptionActive: (user as any).weeklySubscriptionActive !== false,
        weeklySubscriptionWeeks:
            (user as any).weeklySubscriptionWeeks &&
                typeof (user as any).weeklySubscriptionWeeks === "object"
                ? (user as any).weeklySubscriptionWeeks
                : {},
        whatsappPhone: normalizePhone((user as any).whatsappPhone),
        geoCoverage,
        primaryGeoCoverageLabel,
    };
}

export async function upsertUserDoc(user: UserDoc) {
    const now = Date.now();
    const normalized = normalizeUserPayload(user);

    await setDoc(
        docRef.user(user.id),
        {
            ...normalized,
            updatedAt: now,
            createdAt: safeNumber(user.createdAt, now),
        },
        { merge: true }
    );
}

export async function getUserDoc(userId: string): Promise<UserDoc | null> {
    const snap = await getDoc(docRef.user(userId));
    if (!snap.exists()) return null;

    const raw = { id: snap.id, ...(snap.data() as any) } as UserDoc;
    const normalized = normalizeUserPayload(raw);

    return {
        ...raw,
        ...normalized,
        id: raw.id,
    } as UserDoc;
}

export async function listUsers(role?: UserRole): Promise<UserDoc[]> {
    const q = role
        ? query(
            col.users,
            where("role", "==", role),
            orderBy("createdAt", "desc"),
            limit(200)
        )
        : query(col.users, orderBy("createdAt", "desc"), limit(200));

    const snaps = await getDocs(q);

    return snaps.docs.map((d) => {
        const raw = { id: d.id, ...(d.data() as any) } as UserDoc;
        const normalized = normalizeUserPayload(raw);

        return {
            ...raw,
            ...normalized,
            id: raw.id,
        } as UserDoc;
    });
}

/**
 * ✅ Actualizar tarifa por visita (solo admin en rules)
 * Campo oficial: ratePerVisit
 */
export async function updateUserRatePerVisit(userId: string, ratePerVisit: number) {
    const rate = Number.isFinite(ratePerVisit) ? ratePerVisit : 0;

    await updateDoc(docRef.user(userId), {
        ratePerVisit: rate,
        updatedAt: Date.now(),
    });
}

export async function updateUserWeeklySubscriptionWeek(
    userId: string,
    weekStartKey: string,
    input: {
        paid: boolean;
        amount?: number;
        cost?: number;
        updatedBy?: string | null;
    }
) {
    const key = safeString(weekStartKey);
    if (!key) throw new Error("weekStartKey requerido");

    await updateDoc(docRef.user(userId), {
        [`weeklySubscriptionWeeks.${key}`]: {
            paid: !!input.paid,
            amount: safeNumber(input.amount, 0),
            cost: safeNumber(input.cost, 0),
            updatedAt: Date.now(),
            updatedBy: input.updatedBy ?? null,
        },
        updatedAt: Date.now(),
    });
}

/**
 * ✅ Actualiza el WhatsApp operativo
 */
export async function updateUserWhatsappPhone(userId: string, whatsappPhone: string) {
    await updateDoc(docRef.user(userId), {
        whatsappPhone: normalizePhone(whatsappPhone),
        updatedAt: Date.now(),
    });
}

/**
 * ✅ Reemplaza completamente la cobertura geográfica del usuario
 */
export async function updateUserGeoCoverage(
    userId: string,
    geoCoverage: UserGeoCoverage[]
) {
    const normalized = normalizeCoverageList(geoCoverage);

    await updateDoc(docRef.user(userId), {
        geoCoverage: normalized,
        primaryGeoCoverageLabel: normalized[0]?.displayLabel ?? null,
        updatedAt: Date.now(),
    });
}
