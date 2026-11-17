import { AppError } from "../errors/app-error.js";

export const DAY_MS = 24 * 60 * 60 * 1000;


export function parseUtcDay(value: string): Date | null {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

export interface UtcDayRange {
    from?: Date;
    
    toExclusive?: Date;
}





export function resolveUtcDayRange(
    range: { from?: string; to?: string },
    invalidDateError: (field: "from" | "to") => Error,
): UtcDayRange {
    const parse = (value: string, field: "from" | "to") => {
        const date = parseUtcDay(value);
        if (!date) throw invalidDateError(field);
        return date;
    };

    const from = range.from ? parse(range.from, "from") : undefined;
    const toExclusive = range.to
        ? new Date(parse(range.to, "to").getTime() + DAY_MS)
        : undefined;

    if (from && toExclusive && from >= toExclusive) {
        throw new AppError(
            "The start date must be before the end date",
            400,
            "INVALID_DATE_RANGE",
        );
    }

    return { from, toExclusive };
}


export function dayRangeFilter({ from, toExclusive }: UtcDayRange) {
    if (!from && !toExclusive) return undefined;

    return {
        ...(from ? { gte: from } : {}),
        ...(toExclusive ? { lt: toExclusive } : {}),
    };
}
