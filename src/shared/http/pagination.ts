
export const MAX_PAGE_SIZE = 50;

export interface PaginationQuery {
    page?: number;
    limit?: number;
}

export interface Pagination {
    page: number;
    limit: number;
    
    skip: number;
}

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}





export function resolvePagination(
    query: PaginationQuery,
    defaultLimit: number,
): Pagination {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, query.limit ?? defaultLimit));

    return { page, limit, skip: (page - 1) * limit };
}


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
