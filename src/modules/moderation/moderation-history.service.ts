import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
    ModerationHistoryActor,
    ModerationHistoryModerator,
    ModerationHistoryQuery,
    ModerationHistoryResult,
} from "./moderation-history.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value: string, field: "from" | "to"): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
        throw new AppError(`Invalid ${field} date`, 400, "INVALID_DATE_RANGE");
    }
    return date;
}

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

/** Decisões de moderação de todos os relatos, mais recentes primeiro. */
export async function listModerationHistory(
    query: ModerationHistoryQuery = {},
): Promise<ModerationHistoryResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const from = query.from ? parseDay(query.from, "from") : undefined;
    // `to` é inclusivo: vai até o fim daquele dia.
    const toExclusive = query.to
        ? new Date(parseDay(query.to, "to").getTime() + DAY_MS)
        : undefined;

    if (from && toExclusive && from >= toExclusive) {
        throw new AppError(
            "The start date must be before the end date",
            400,
            "INVALID_DATE_RANGE",
        );
    }

    const where = {
        ...(query.moderatorId ? { moderated_by_id: query.moderatorId } : {}),
        ...(query.accidentId ? { accident_id: query.accidentId } : {}),
        ...(query.status ? { new_status: query.status } : {}),
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
            skip: (page - 1) * limit,
            take: limit,
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
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

/** Quem já registrou ao menos uma decisão, para filtros e resumo por pessoa. */
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
