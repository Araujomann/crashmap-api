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
import type {
    ModerationHistoryActor,
    ModerationHistoryModerator,
    ModerationHistoryQuery,
    ModerationHistoryResult,
} from "./moderation-history.types.js";

function toActor(user: {
    id: string;
    name: string;
    email: string;
    deleted_at: Date | null;
}): ModerationHistoryActor {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        is_deleted: user.deleted_at !== null,
    };
}

const actorSelect = {
    id: true,
    name: true,
    email: true,
    deleted_at: true,
} as const;


export async function listModerationHistory(
    query: ModerationHistoryQuery = {},
): Promise<ModerationHistoryResult> {
    const pagination = resolvePagination(query, 20);
    
    const createdAt = dayRangeFilter(
        resolveUtcDayRange(
            query,
            (field) =>
                new AppError(`Invalid ${field} date`, 400, "INVALID_DATE_RANGE"),
        ),
    );

    const where = {
        ...(query.moderatorId ? { moderated_by_id: query.moderatorId } : {}),
        ...(query.accidentId ? { accident_id: query.accidentId } : {}),
        ...(query.status ? { new_status: query.status } : {}),
        ...(createdAt ? { created_at: createdAt } : {}),
    };

    const [total, entries] = await prisma.$transaction([
        prisma.accidentModerationHistory.count({ where }),
        prisma.accidentModerationHistory.findMany({
            where,
            include: {
                moderated_by: { select: actorSelect },
                accident: {
                    select: { id: true, tipo_acidente: true, severity: true },
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
            previous_status: entry.previous_status,
            new_status: entry.new_status,
            public_message: entry.public_message,
            internal_note: entry.internal_note,
            created_at: entry.created_at,
            moderated_by: toActor(entry.moderated_by),
            accident: entry.accident,
        })),
        pagination: buildPaginationMeta(pagination, total),
    };
}


export async function listModerationHistoryModerators(): Promise<
    ModerationHistoryModerator[]
> {
    const users = await prisma.user.findMany({
        where: { moderation_decisions: { some: {} } },
        select: {
            ...actorSelect,
            _count: { select: { moderation_decisions: true } },
        },
        orderBy: { name: "asc" },
    });

    return users.map((user) => ({
        ...toActor(user),
        decisions_count: user._count.moderation_decisions,
    }));
}
