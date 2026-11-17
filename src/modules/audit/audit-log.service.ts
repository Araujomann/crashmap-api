import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
    dayRangeFilter,
    resolveUtcDayRange,
} from "../../shared/utils/date-range.js";
import {
    buildPaginationMeta,
    resolvePagination,
} from "../../shared/http/pagination.js";
import type { AuditAction } from "./audit.service.js";

export interface AuditLogQuery {
    actorId?: string;
    action?: AuditAction;
    targetType?: string;
    targetId?: string;
    
    from?: string;
    
    to?: string;
    page?: number;
    limit?: number;
}

export async function listAuditLogs(query: AuditLogQuery = {}) {
    const pagination = resolvePagination(query, 25);
    const createdAt = dayRangeFilter(
        resolveUtcDayRange(
            query,
            () => new AppError("Invalid date", 400, "INVALID_DATE_RANGE"),
        ),
    );

    const where = {
        ...(query.actorId ? { actor_id: query.actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.targetType ? { target_type: query.targetType } : {}),
        ...(query.targetId ? { target_id: query.targetId } : {}),
        ...(createdAt ? { created_at: createdAt } : {}),
    };

    const [total, entries] = await prisma.$transaction([
        prisma.adminAuditLog.count({ where }),
        prisma.adminAuditLog.findMany({
            where,
            include: {
                actor: {
                    select: { id: true, name: true, email: true, deleted_at: true },
                },
            },
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            skip: pagination.skip,
            take: pagination.limit,
        }),
    ]);

    return {
        data: entries.map((entry) => ({
            id: entry.id,
            action: entry.action,
            target_type: entry.target_type,
            target_id: entry.target_id,
            metadata: entry.metadata,
            ip: entry.ip,
            user_agent: entry.user_agent,
            created_at: entry.created_at,
            actor: entry.actor
                ? {
                      id: entry.actor.id,
                      name: entry.actor.name,
                      email: entry.actor.email,
                      is_deleted: entry.actor.deleted_at !== null,
                  }
                : null,
        })),
        pagination: buildPaginationMeta(pagination, total),
    };
}
