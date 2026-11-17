import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
    buildPaginationMeta,
    resolvePagination,
} from "../../shared/http/pagination.js";
import type { AuthUser } from "../auth/auth.types.js";
import { sendApprovedAccidentNotification } from "../notifications/notifications.service.js";
import { accidentNotFoundError } from "./accidents.access.js";
import { accidentTextSearchFilter } from "./accidents.filters.js";
import { toAccident, toModerationAccident } from "./accidents.mapper.js";
import type {
    AccidentListQuery,
    AccidentModerationListItem,
    AccidentModerationListResult,
    AccidentModerationSummary,
    EditPendingAccidentBody,
    ModerateAccidentBody,
    ModerationAccident,
} from "./accidents.types.js";


const APP_SOURCE = { source: "APP" as const };

const moderationAccidentInclude = {
    created_by: {
        select: { id: true, name: true, email: true },
    },
    comments: {
        orderBy: { created_at: "asc" as const },
        include: { created_by: { select: { name: true } } },
    },
    images: { orderBy: { created_at: "asc" as const } },
    _count: { select: { trust_votes: true } },
    moderation_history: {
        orderBy: { created_at: "desc" as const },
        include: {
            moderated_by: {
                select: { id: true, name: true, email: true },
            },
        },
    },
} as const;

function alreadyModeratedError() {
    return new AppError(
        "This accident was already moderated",
        409,
        "ACCIDENT_ALREADY_MODERATED",
    );
}

export async function getAccidentModerationSummary(): Promise<AccidentModerationSummary> {
    const [total, pending, approved, rejected] = await Promise.all([
        prisma.accident.count({ where: APP_SOURCE }),
        prisma.accident.count({
            where: { ...APP_SOURCE, moderation_status: "PENDING" },
        }),
        prisma.accident.count({
            where: { ...APP_SOURCE, moderation_status: "APPROVED" },
        }),
        prisma.accident.count({
            where: { ...APP_SOURCE, moderation_status: "REJECTED" },
        }),
    ]);

    return { total, pending, approved, rejected };
}

export async function listAccidentsForModeration(
    query: AccidentListQuery = {},
): Promise<AccidentModerationListResult> {
    const pagination = resolvePagination(query, 10);
    const where = {
        ...APP_SOURCE,
        ...(query.status ? { moderation_status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...accidentTextSearchFilter(query.search?.trim()),
    };
    const [total, accidents] = await prisma.$transaction([
        prisma.accident.count({ where }),
        prisma.accident.findMany({
            where,
            include: {
                created_by: {
                    select: { id: true, name: true, email: true },
                },
            },
            orderBy: { created_at: query.sort === "oldest" ? "asc" : "desc" },
            skip: pagination.skip,
            take: pagination.limit,
        }),
    ]);

    return {
        data: accidents.map((accident): AccidentModerationListItem => ({
            ...toAccident(accident),
            created_by: accident.created_by,
        })),
        pagination: buildPaginationMeta(pagination, total),
    };
}

export async function getAccidentForModeration(
    accidentId: string,
): Promise<ModerationAccident> {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, ...APP_SOURCE },
        include: moderationAccidentInclude,
    });

    if (!accident) {
        throw accidentNotFoundError();
    }

    return toModerationAccident(accident);
}

export async function editPendingAccident(
    accidentId: string,
    input: EditPendingAccidentBody,
): Promise<ModerationAccident> {
    const tipoAcidente = input.tipo_acidente?.trim();
    const description =
        input.description === undefined
            ? undefined
            : input.description?.trim() || null;

    if (tipoAcidente !== undefined && tipoAcidente.length < 3) {
        throw new AppError(
            "Accident title must contain at least 3 characters",
            400,
            "INVALID_ACCIDENT_TITLE",
        );
    }

    return prisma.$transaction(async (transaction) => {
        const currentAccident = await transaction.accident.findFirst({
            where: { id: accidentId, ...APP_SOURCE },
            select: { id: true, moderation_status: true },
        });

        if (!currentAccident) {
            throw accidentNotFoundError();
        }

        if (currentAccident.moderation_status !== "PENDING") {
            throw new AppError(
                "Only pending accidents can be edited",
                409,
                "ACCIDENT_ALREADY_MODERATED",
            );
        }

        const updated = await transaction.accident.updateMany({
            where: {
                id: accidentId,
                ...APP_SOURCE,
                moderation_status: "PENDING",
            },
            data: {
                tipo_acidente: tipoAcidente,
                description,
            },
        });

        if (updated.count !== 1) {
            throw alreadyModeratedError();
        }

        const accident = await transaction.accident.findFirstOrThrow({
            where: { id: accidentId },
            include: moderationAccidentInclude,
        });

        return toModerationAccident(accident);
    });
}

export async function moderateAccident(
    user: AuthUser,
    accidentId: string,
    input: ModerateAccidentBody,
): Promise<ModerationAccident> {
    const publicMessage = input.publicMessage?.trim() || null;
    const internalNote = input.internalNote?.trim() || null;

    if (input.status === "REJECTED" && !publicMessage) {
        throw new AppError(
            "A public rejection message is required",
            400,
            "MODERATION_MESSAGE_REQUIRED",
        );
    }

    if (
        (publicMessage?.length ?? 0) > 2000 ||
        (internalNote?.length ?? 0) > 4000
    ) {
        throw new AppError(
            "Moderation messages exceed the allowed length",
            400,
            "MODERATION_MESSAGE_TOO_LONG",
        );
    }

    return prisma.$transaction(async (transaction) => {
        const currentAccident = await transaction.accident.findFirst({
            where: { id: accidentId, ...APP_SOURCE },
            select: { id: true, moderation_status: true },
        });

        if (!currentAccident) {
            throw accidentNotFoundError();
        }

        if (currentAccident.moderation_status !== "PENDING") {
            throw new AppError(
                "Only pending accidents can be moderated",
                409,
                "ACCIDENT_ALREADY_MODERATED",
            );
        }

        
        const updated = await transaction.accident.updateMany({
            where: { id: accidentId, moderation_status: "PENDING" },
            data: {
                moderation_status: input.status,
                moderation_message: publicMessage,
                moderation_internal_note: internalNote,
                moderated_at: new Date(),
                moderated_by_id: user.id,
            },
        });

        if (updated.count !== 1) {
            throw alreadyModeratedError();
        }

        await transaction.accidentModerationHistory.create({
            data: {
                accident_id: accidentId,
                moderated_by_id: user.id,
                previous_status: currentAccident.moderation_status,
                new_status: input.status,
                public_message: publicMessage,
                internal_note: internalNote,
            },
        });

        const accident = await transaction.accident.findFirstOrThrow({
            where: { id: accidentId },
            include: moderationAccidentInclude,
        });

        return toModerationAccident(accident);
    });
}





export async function notifyAccidentApproved(
    accidentId: string,
    logger: FastifyBaseLogger,
): Promise<void> {
    try {
        const delivery = await sendApprovedAccidentNotification(accidentId);
        logger.info(
            {
                accidentId,
                recipients: delivery.recipientCount,
                removedTokens: delivery.removedTokenCount,
            },
            "Accident approval notification processed",
        );
    } catch (error) {
        logger.error(
            { err: error, accidentId },
            "Failed to send accident approval notifications",
        );
    }
}
