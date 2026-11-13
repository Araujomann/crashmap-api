/** Maior página aceita pelas listagens. */
export const MAX_PAGE_SIZE = 50;

export interface PaginationQuery {
    page?: number;
    limit?: number;
}

export interface Pagination {
    page: number;
    limit: number;
    /** Quantos registros pular (`skip` do Prisma). */
    skip: number;
}

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

/**
 * Normaliza página e tamanho vindos da query: página mínima 1, tamanho entre
 * 1 e `MAX_PAGE_SIZE`, com o padrão próprio de cada listagem.
 */
export function resolvePagination(
    query: PaginationQuery,
    defaultLimit: number,
): Pagination {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, query.limit ?? defaultLimit));

    return { page, limit, skip: (page - 1) * limit };
}

/** Bloco `pagination` das respostas (sempre ao menos uma página). */
export function buildPaginationMeta(
    { page, limit }: Pick<Pagination, "page" | "limit">,
    total: number,
): PaginationMeta {
    return {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
    };
}
