import type { UserDoc, UserWeeklySubscriptionWeek } from "../types/models";

export type WeeklyBillingSnapshot = {
    isWeeklySubscription: boolean;
    paid: boolean;
    gross: number;
    cost: number;
    net: number;
};

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp2(n: number) {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export function getUserBillingMode(user?: UserDoc | null) {
    const mode = String((user as any)?.billingMode ?? "").trim();
    return mode === "weekly_subscription" ? "weekly_subscription" : "per_visit";
}

export function getWeeklySubscriptionAmount(user?: UserDoc | null) {
    return safeNumber((user as any)?.weeklySubscriptionAmount, 0);
}

export function getWeeklySubscriptionCost(user?: UserDoc | null) {
    return safeNumber((user as any)?.weeklySubscriptionCost, 0);
}

export function getWeeklyBillingSnapshot(
    user: UserDoc | null | undefined,
    weekStartKey: string
): WeeklyBillingSnapshot {
    const isWeeklySubscription = getUserBillingMode(user) === "weekly_subscription";

    if (!isWeeklySubscription) {
        return {
            isWeeklySubscription: false,
            paid: false,
            gross: 0,
            cost: 0,
            net: 0,
        };
    }

    const weeks = ((user as any)?.weeklySubscriptionWeeks ?? {}) as Record<
        string,
        UserWeeklySubscriptionWeek | undefined
    >;
    const week = weeks[String(weekStartKey || "").trim()];
    const activeByDefault = (user as any)?.weeklySubscriptionActive !== false;
    const paid = typeof week?.paid === "boolean" ? week.paid : activeByDefault;

    if (!paid) {
        return {
            isWeeklySubscription: true,
            paid: false,
            gross: 0,
            cost: 0,
            net: 0,
        };
    }

    const gross = clamp2(safeNumber(week?.amount, getWeeklySubscriptionAmount(user)));
    const cost = clamp2(safeNumber(week?.cost, getWeeklySubscriptionCost(user)));

    return {
        isWeeklySubscription: true,
        paid: true,
        gross,
        cost,
        net: clamp2(gross - cost),
    };
}

export function getAccountingGrossForUserWeek(
    user: UserDoc | null | undefined,
    weekStartKey: string,
    perVisitGross: number
) {
    const billing = getWeeklyBillingSnapshot(user, weekStartKey);
    return billing.isWeeklySubscription ? billing.gross : clamp2(perVisitGross);
}
