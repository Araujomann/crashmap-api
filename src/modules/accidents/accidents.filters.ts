import type { Prisma } from "../../../generated/prisma/client.js";

/** `{ gte, lte }` com os limites informados, ou `undefined` se nenhum. */
function closedRange<T>(min: T | undefined, max: T | undefined) {
    if (min === undefined && max === undefined) return undefined;

    return {
        ...(min !== undefined ? { gte: min } : {}),
        ...(max !== undefined ? { lte: max } : {}),
    };
}

/** Busca sem diferenciar maiúsculas no título e na descrição do relato. */
export function accidentTextSearchFilter(
    search: string | undefined,
): Prisma.AccidentWhereInput {
    if (!search) return {};

    return {
        OR: [
            { tipo_acidente: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
        ],
    };
}

/**
 * Período da ocorrência e área do mapa (retângulo de latitude/longitude),
 * todos os limites inclusivos.
 */
export function accidentPeriodAndAreaFilter(query: {
    from?: string;
    to?: string;
    minLat?: number;
    maxLat?: number;
    minLng?: number;
    maxLng?: number;
}): Prisma.AccidentWhereInput {
    const occurredAt = closedRange(
        query.from ? new Date(query.from) : undefined,
        query.to ? new Date(query.to) : undefined,
    );
    const latitude = closedRange(query.minLat, query.maxLat);
    const longitude = closedRange(query.minLng, query.maxLng);

    return {
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
        ...(latitude ? { latitude } : {}),
        ...(longitude ? { longitude } : {}),
    };
}
