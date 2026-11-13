import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuditAction } from "./audit.service.js";

export interface AuditLogQuery {
    actorId?: string;
    action?: AuditAction;
    targetType?: string;
    targetId?: string;
    /** YYYY-MM-DD, inclusivo, UTC. */
    from?: string;
    /** YYYY-MM-DD, inclusivo, UTC. */
    to?: string;
    page?: number;
    limit?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
        throw new AppError("Invalid date", 400, "INVALID_DATE_RANGE");
    }
    return date;
}

export async function listAuditLogs(query: AuditLogQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 25));
    const from = query.from ? parseDay(query.from) : undefined;
    const toExclusive = query.to
        ? new Date(parseDay(query.to).getTime() + DAY_MS)
        : undefined;
    if (from && toExclusive && from >= toExclusive) {
        throw new AppError(
            "The start date must be before the end date",
            400,
            "INVALID_DATE_RANGE",
        );
    }

    const where = {
        ...(query.actorId ? { actor_id: query.actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.targetType ? { target_type: query.targetType } : {}),
        ...(query.targetId ? { target_id: query.targetId } : {}),
        ...(from || toExclusive
            ? {
                  created_at: {
                      ...(from ? { gte: from } : {}),
                      ...(toExclusive ? { lt: toExclusive } : {}),
                  },
              }
            : {}),
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
            skip: (page - 1) * limit,
            take: limit,
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
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}
