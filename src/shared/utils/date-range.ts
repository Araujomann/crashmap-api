import { AppError } from "../errors/app-error.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → meia-noite UTC daquele dia; `null` se a data for inválida. */
export function parseUtcDay(value: string): Date | null {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

export interface UtcDayRange {
    from?: Date;
    /** Início do dia seguinte a `to`: o filtro inclui o dia `to` inteiro. */
    toExclusive?: Date;
}

/**
 * Intervalo de dias em UTC, ambos inclusivos. Quem chama decide o erro de
 * uma data inválida; o intervalo invertido tem um erro único.
 */
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

/** Filtro Prisma `{ gte, lt }` do intervalo, ou `undefined` se não houver. */
export function dayRangeFilter({ from, toExclusive }: UtcDayRange) {
    if (!from && !toExclusive) return undefined;

    return {
        ...(from ? { gte: from } : {}),
        ...(toExclusive ? { lt: toExclusive } : {}),
    };
}
