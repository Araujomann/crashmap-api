import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { uploadImageToCloudinary } from "../../shared/services/storage/cloudinary.js";
import type { AuthUser } from "../auth/auth.types.js";
import type {
    Accident,
    AccidentComment,
    AccidentDetail,
    AccidentImage,
    AccidentListQuery,
    AccidentListResult,
    AccidentMapItem,
    AccidentMapQuery,
    AccidentMapResult,
    AccidentModerationListItem,
    AccidentModerationListResult,
    AccidentModerationStatus,
    AccidentModerationSummary,
    AccidentSeverity,
    AccidentTrustSummary,
    CreateAccidentCommentBody,
    CreateAccidentImageBody,
    CreateAccidentBody,
    EditPendingAccidentBody,
    ModerateAccidentBody,
    ModerationAccident,
    UpdateAccidentBody,
} from "./accidents.types.js";

function toAccident(accident: {
    id: string;
    tipo_acidente: string;
    classificacao_acidente: "com_vitima" | "sem_vitima";
    condicao_meteorologica: "ceu_claro" | "chuva" | "nublado" | "garoa";
    description: string | null;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: AccidentSeverity;
    source: "APP" | "PRF";
    moderation_status: AccidentModerationStatus;
    moderation_message: string | null;
    moderated_at: Date | null;
    created_by_id: string | null;
    created_at: Date;
    updated_at: Date;
}): Accident {
    return {
        id: accident.id,
        tipo_acidente: accident.tipo_acidente,
        classificacao_acidente: accident.classificacao_acidente,
        condicao_meteorologica: accident.condicao_meteorologica,
        description: accident.description,
        latitude: accident.latitude,
        longitude: accident.longitude,
        occurred_at: accident.occurred_at,
        severity: accident.severity,
        source: accident.source,
        moderation_status: accident.moderation_status,
        moderation_message: accident.moderation_message,
        moderated_at: accident.moderated_at,
        created_by_id: accident.created_by_id,
        created_at: accident.created_at,
        updated_at: accident.updated_at,
    };
}

function toAccidentComment(comment: {
    id: string;
    accident_id: string;
    created_by_id: string;
    created_by?: { name: string };
    body: string;
    created_at: Date;
    updated_at: Date;
}): AccidentComment {
    return {
        id: comment.id,
        accident_id: comment.accident_id,
        created_by_id: comment.created_by_id,
        author_name: comment.created_by?.name ?? null,
        body: comment.body,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
    };
}

function toAccidentImage(image: {
    id: string;
    accident_id: string;
    created_by_id: string;
    image_url: string;
    caption: string | null;
    created_at: Date;
    updated_at: Date;
}): AccidentImage {
    return {
        id: image.id,
        accident_id: image.accident_id,
        created_by_id: image.created_by_id,
        image_url: image.image_url,
        caption: image.caption,
        created_at: image.created_at,
        updated_at: image.updated_at,
    };
}

function toAccidentDetail(accident: {
    id: string;
    tipo_acidente: string;
    classificacao_acidente: "com_vitima" | "sem_vitima";
    condicao_meteorologica: "ceu_claro" | "chuva" | "nublado" | "garoa";
    description: string | null;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: AccidentSeverity;
    source: "APP" | "PRF";
    moderation_status: AccidentModerationStatus;
    moderation_message: string | null;
    moderated_at: Date | null;
    created_by_id: string | null;
    created_at: Date;
    updated_at: Date;
    _count?: { trust_votes: number };
    comments: Array<{
        id: string;
        accident_id: string;
        created_by_id: string;
        created_by?: { name: string };
        body: string;
        created_at: Date;
        updated_at: Date;
    }>;
    images: Array<{
        id: string;
        accident_id: string;
        created_by_id: string;
        image_url: string;
        caption: string | null;
        created_at: Date;
        updated_at: Date;
    }>;
}): AccidentDetail {
    return {
        ...toAccident(accident),
        trusted_count: accident._count?.trust_votes ?? 0,
        comments: accident.comments.map(toAccidentComment),
        images: accident.images.map(toAccidentImage),
    };
}

function parseOccurredAt(value: string): Date {
    const occurredAt = new Date(value);

    if (Number.isNaN(occurredAt.getTime())) {
        throw new AppError(
            "Invalid occurredAt value",
            400,
            "INVALID_OCCURRED_AT",
        );
    }

    return occurredAt;
}

function canManageAccident(user: AuthUser, accidentOwnerId: string | null) {
    return (
        user.role === "admin" ||
        user.role === "moderator" ||
        accidentOwnerId === user.id
    );
}

function ensureUpdatePayload(input: UpdateAccidentBody) {
    if (
        input.tipo_acidente === undefined &&
        input.classificacao_acidente === undefined &&
        input.condicao_meteorologica === undefined &&
        input.description === undefined &&
        input.latitude === undefined &&
        input.longitude === undefined &&
        input.occurredAt === undefined &&
        input.severity === undefined
    ) {
        throw new AppError(
            "At least one field must be provided",
            400,
            "INVALID_ACCIDENT_UPDATE",
        );
    }
}

export async function listAccidents(
    query: AccidentListQuery = {},
): Promise<AccidentListResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 10));
    const search = query.search?.trim();
    const severity = query.severity;
    const sort = query.sort ?? "newest";

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const minLat = query.minLat;
    const maxLat = query.maxLat;
    const minLng = query.minLng;
    const maxLng = query.maxLng;

    const where = {
        ...(search
            ? {
                  OR: [
                      {
                          tipo_acidente: {
                              contains: search,
                              mode: "insensitive" as const,
                          },
                      },
                      {
                          description: {
                              contains: search,
                              mode: "insensitive" as const,
                          },
                      },
                  ],
              }
            : {}),
        ...(severity ? { severity } : {}),
        ...(query.status ? { moderation_status: query.status } : {}),
        ...(from || to
            ? {
                  occurred_at: {
                      ...(from ? { gte: from } : {}),
                      ...(to ? { lte: to } : {}),
                  },
              }
            : {}),
        ...(minLat !== undefined || maxLat !== undefined
            ? {
                  latitude: {
                      ...(minLat !== undefined ? { gte: minLat } : {}),
                      ...(maxLat !== undefined ? { lte: maxLat } : {}),
                  },
              }
            : {}),
        ...(minLng !== undefined || maxLng !== undefined
            ? {
                  longitude: {
                      ...(minLng !== undefined ? { gte: minLng } : {}),
                      ...(maxLng !== undefined ? { lte: maxLng } : {}),
                  },
              }
            : {}),
    };

    const [total, accidents] = await prisma.$transaction([
        prisma.accident.count({ where }),
        prisma.accident.findMany({
            where,
            orderBy:
                sort === "oldest"
                    ? { occurred_at: "asc" }
                    : { created_at: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        data: accidents.map(toAccident),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

const MAP_MAX_RESULTS = 5000;

export async function listAccidentsForMap(
    query: AccidentMapQuery = {},
): Promise<AccidentMapResult> {
    const search = query.search?.trim();
    const severity = query.severity;
    const classificacao = query.classificacao;
    const condicaoMeteorologica = query.condicao_meteorologica;
    const source = query.source;
    const sourceYear = query.source_year;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const minLat = query.minLat;
    const maxLat = query.maxLat;
    const minLng = query.minLng;
    const maxLng = query.maxLng;

    const where = {
        moderation_status: "APPROVED" as const,
        ...(search
            ? {
                  OR: [
                      {
                          tipo_acidente: {
                              contains: search,
                              mode: "insensitive" as const,
                          },
                      },
                      {
                          description: {
                              contains: search,
                              mode: "insensitive" as const,
                          },
                      },
                  ],
              }
            : {}),
        ...(severity ? { severity } : {}),
        ...(classificacao
            ? { classificacao_acidente: classificacao }
            : {}),
        ...(condicaoMeteorologica
            ? { condicao_meteorologica: condicaoMeteorologica }
            : {}),
        ...(source ? { source } : {}),
        ...(sourceYear !== undefined ? { source_year: sourceYear } : {}),
        ...(from || to
            ? {
                  occurred_at: {
                      ...(from ? { gte: from } : {}),
                      ...(to ? { lte: to } : {}),
                  },
              }
            : {}),
        ...(minLat !== undefined || maxLat !== undefined
            ? {
                  latitude: {
                      ...(minLat !== undefined ? { gte: minLat } : {}),
                      ...(maxLat !== undefined ? { lte: maxLat } : {}),
                  },
              }
            : {}),
        ...(minLng !== undefined || maxLng !== undefined
            ? {
                  longitude: {
                      ...(minLng !== undefined ? { gte: minLng } : {}),
                      ...(maxLng !== undefined ? { lte: maxLng } : {}),
                  },
              }
            : {}),
    };

    const accidents = await prisma.accident.findMany({
        where,
        select: {
            id: true,
            tipo_acidente: true,
            classificacao_acidente: true,
            condicao_meteorologica: true,
            latitude: true,
            longitude: true,
            occurred_at: true,
            severity: true,
            source: true,
        },
        orderBy: { occurred_at: "desc" },
        take: MAP_MAX_RESULTS,
    });

    const data: AccidentMapItem[] = accidents.map((a) => ({
        id: a.id,
        tipo_acidente: a.tipo_acidente,
        classificacao_acidente: a.classificacao_acidente,
        condicao_meteorologica: a.condicao_meteorologica,
        latitude: a.latitude,
        longitude: a.longitude,
        occurred_at: a.occurred_at,
        severity: a.severity,
        source: a.source,
    }));

    return { data, total: data.length };
}

export async function getAccident(
    accidentId: string,
): Promise<AccidentDetail> {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, moderation_status: "APPROVED" },
        include: {
            comments: {
                orderBy: { created_at: "asc" },
                include: { created_by: { select: { name: true } } },
            },
            images: {
                orderBy: { created_at: "asc" },
            },
            _count: { select: { trust_votes: true } },
        },
    });

    if (!accident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
    }

    return toAccidentDetail(accident);
}

export async function createAccident(
    user: AuthUser,
    input: CreateAccidentBody,
): Promise<Accident> {
    const accident = await prisma.accident.create({
        data: {
            tipo_acidente: input.tipo_acidente.trim(),
            classificacao_acidente: input.classificacao_acidente,
            condicao_meteorologica: input.condicao_meteorologica,
            description: input.description?.trim() || null,
            latitude: input.latitude,
            longitude: input.longitude,
            occurred_at: parseOccurredAt(input.occurredAt),
            severity: input.severity,
            created_by_id: user.id,
        },
    });

    return toAccident(accident);
}

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

function toModerationAccident(
    accident: {
        id: string;
        tipo_acidente: string;
        classificacao_acidente: "com_vitima" | "sem_vitima";
        condicao_meteorologica: "ceu_claro" | "chuva" | "nublado" | "garoa";
        description: string | null;
        latitude: number;
        longitude: number;
        occurred_at: Date;
        severity: AccidentSeverity;
        source: "APP" | "PRF";
        moderation_status: AccidentModerationStatus;
        moderation_message: string | null;
        moderation_internal_note: string | null;
        moderated_at: Date | null;
        moderated_by_id: string | null;
        created_by_id: string | null;
        created_at: Date;
        updated_at: Date;
        _count?: { trust_votes: number };
        created_by: { id: string; name: string; email: string } | null;
        comments: Array<{
            id: string;
            accident_id: string;
            created_by_id: string;
            created_by?: { name: string };
            body: string;
            created_at: Date;
            updated_at: Date;
        }>;
        images: Array<{
            id: string;
            accident_id: string;
            created_by_id: string;
            image_url: string;
            caption: string | null;
            created_at: Date;
            updated_at: Date;
        }>;
        moderation_history: Array<{
            id: string;
            previous_status: AccidentModerationStatus;
            new_status: AccidentModerationStatus;
            public_message: string | null;
            internal_note: string | null;
            created_at: Date;
            moderated_by: { id: string; name: string; email: string };
        }>;
    },
): ModerationAccident {
    return {
        ...toAccidentDetail(accident),
        moderation_internal_note: accident.moderation_internal_note,
        created_by: accident.created_by,
        moderation_history: accident.moderation_history,
    };
}

export async function getAccidentModerationSummary(): Promise<AccidentModerationSummary> {
    const sourceFilter = { source: "APP" as const };
    const [total, pending, approved, rejected] = await Promise.all([
        prisma.accident.count({ where: sourceFilter }),
        prisma.accident.count({
            where: { ...sourceFilter, moderation_status: "PENDING" },
        }),
        prisma.accident.count({
            where: { ...sourceFilter, moderation_status: "APPROVED" },
        }),
        prisma.accident.count({
            where: { ...sourceFilter, moderation_status: "REJECTED" },
        }),
    ]);

    return { total, pending, approved, rejected };
}

export async function listAccidentsForModeration(
    query: AccidentListQuery = {},
): Promise<AccidentModerationListResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 10));
    const search = query.search?.trim();
    const where = {
        source: "APP" as const,
        ...(query.status ? { moderation_status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(search
            ? {
                  OR: [
                      {
                          tipo_acidente: {
                              contains: search,
                              mode: "insensitive" as const,
                          },
                      },
                      {
                          description: {
                              contains: search,
                              mode: "insensitive" as const,
                          },
                      },
                  ],
              }
            : {}),
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
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        data: accidents.map((accident): AccidentModerationListItem => ({
            ...toAccident(accident),
            created_by: accident.created_by,
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

export async function getAccidentForModeration(
    accidentId: string,
): Promise<ModerationAccident> {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, source: "APP" },
        include: moderationAccidentInclude,
    });

    if (!accident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
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
            where: { id: accidentId, source: "APP" },
            select: { id: true, moderation_status: true },
        });

        if (!currentAccident) {
            throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
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
                source: "APP",
                moderation_status: "PENDING",
            },
            data: {
                tipo_acidente: tipoAcidente,
                description,
            },
        });

        if (updated.count !== 1) {
            throw new AppError(
                "This accident was already moderated",
                409,
                "ACCIDENT_ALREADY_MODERATED",
            );
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
            where: { id: accidentId, source: "APP" },
            select: { id: true, moderation_status: true },
        });

        if (!currentAccident) {
            throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
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
            throw new AppError(
                "This accident was already moderated",
                409,
                "ACCIDENT_ALREADY_MODERATED",
            );
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

export async function updateAccident(
    user: AuthUser,
    accidentId: string,
    input: UpdateAccidentBody,
): Promise<Accident> {
    ensureUpdatePayload(input);

    const currentAccident = await prisma.accident.findUnique({
        where: { id: accidentId },
    });

    if (!currentAccident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
    }

    if (!canManageAccident(user, currentAccident.created_by_id)) {
        throw new AppError(
            "You cannot modify this accident",
            403,
            "ACCIDENT_FORBIDDEN",
        );
    }

    const accident = await prisma.accident.update({
        where: { id: accidentId },
        data: {
            tipo_acidente: input.tipo_acidente?.trim(),
            classificacao_acidente: input.classificacao_acidente,
            condicao_meteorologica: input.condicao_meteorologica,
            description:
                input.description === undefined
                    ? undefined
                    : input.description?.trim() || null,
            latitude: input.latitude,
            longitude: input.longitude,
            occurred_at:
                input.occurredAt === undefined
                    ? undefined
                    : parseOccurredAt(input.occurredAt),
            severity: input.severity,
        },
    });

    return toAccident(accident);
}

export async function deleteAccident(
    user: AuthUser,
    accidentId: string,
): Promise<void> {
    const currentAccident = await prisma.accident.findUnique({
        where: { id: accidentId },
    });

    if (!currentAccident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
    }

    if (currentAccident.moderation_status !== "PENDING") {
        throw new AppError(
            "Moderated accidents cannot be deleted",
            409,
            "ACCIDENT_MODERATED_CANNOT_DELETE",
        );
    }

    if (!canManageAccident(user, currentAccident.created_by_id)) {
        throw new AppError(
            "You cannot delete this accident",
            403,
            "ACCIDENT_FORBIDDEN",
        );
    }

    await prisma.accident.delete({
        where: { id: accidentId },
    });
}

async function ensurePublicAccidentExists(accidentId: string) {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, moderation_status: "APPROVED" },
        select: { id: true },
    });

    if (!accident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
    }
}

function canManageUserContent(user: AuthUser, ownerId: string) {
    return (
        user.role === "admin" ||
        user.role === "moderator" ||
        ownerId === user.id
    );
}

export async function listAccidentComments(
    accidentId: string,
): Promise<AccidentComment[]> {
    await ensurePublicAccidentExists(accidentId);

    const comments = await prisma.accidentComment.findMany({
        where: { accident_id: accidentId },
        orderBy: { created_at: "asc" },
        include: { created_by: { select: { name: true } } },
    });

    return comments.map(toAccidentComment);
}

export async function createAccidentComment(
    user: AuthUser,
    accidentId: string,
    input: CreateAccidentCommentBody,
): Promise<AccidentComment> {
    await ensurePublicAccidentExists(accidentId);

    const comment = await prisma.accidentComment.create({
        data: {
            accident_id: accidentId,
            created_by_id: user.id,
            body: input.body.trim(),
        },
        include: { created_by: { select: { name: true } } },
    });

    return toAccidentComment(comment);
}

export async function getAccidentTrust(
    userId: string,
    accidentId: string,
): Promise<AccidentTrustSummary> {
    await ensurePublicAccidentExists(accidentId);

    const [trustedCount, vote] = await prisma.$transaction([
        prisma.accidentTrustVote.count({
            where: { accident_id: accidentId },
        }),
        prisma.accidentTrustVote.findUnique({
            where: {
                accident_id_created_by_id: {
                    accident_id: accidentId,
                    created_by_id: userId,
                },
            },
            select: { id: true },
        }),
    ]);

    return { trusted_count: trustedCount, trusted_by_me: Boolean(vote) };
}

async function ensureCanTrustAccident(accidentId: string, userId: string) {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, moderation_status: "APPROVED" },
        select: { created_by_id: true },
    });

    if (!accident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
    }

    if (!accident.created_by_id || accident.created_by_id === userId) {
        throw new AppError(
            "You cannot trust this accident",
            403,
            "ACCIDENT_TRUST_FORBIDDEN",
        );
    }
}

export async function addAccidentTrust(
    userId: string,
    accidentId: string,
): Promise<AccidentTrustSummary> {
    await ensureCanTrustAccident(accidentId, userId);

    await prisma.accidentTrustVote.upsert({
        where: {
            accident_id_created_by_id: {
                accident_id: accidentId,
                created_by_id: userId,
            },
        },
        create: { accident_id: accidentId, created_by_id: userId },
        update: {},
    });

    return getAccidentTrust(userId, accidentId);
}

export async function removeAccidentTrust(
    userId: string,
    accidentId: string,
): Promise<AccidentTrustSummary> {
    await ensurePublicAccidentExists(accidentId);

    await prisma.accidentTrustVote.deleteMany({
        where: { accident_id: accidentId, created_by_id: userId },
    });

    return getAccidentTrust(userId, accidentId);
}

export async function deleteAccidentComment(
    user: AuthUser,
    accidentId: string,
    commentId: string,
): Promise<void> {
    const comment = await prisma.accidentComment.findFirst({
        where: { id: commentId, accident_id: accidentId },
        select: { id: true, created_by_id: true },
    });

    if (!comment) {
        throw new AppError("Comment not found", 404, "COMMENT_NOT_FOUND");
    }

    if (!canManageUserContent(user, comment.created_by_id)) {
        throw new AppError(
            "You cannot delete this comment",
            403,
            "COMMENT_FORBIDDEN",
        );
    }

    await prisma.accidentComment.delete({
        where: { id: commentId },
    });
}

export async function listAccidentImages(
    accidentId: string,
): Promise<AccidentImage[]> {
    await ensurePublicAccidentExists(accidentId);

    const images = await prisma.accidentImage.findMany({
        where: { accident_id: accidentId },
        orderBy: { created_at: "asc" },
    });

    return images.map(toAccidentImage);
}

export async function createAccidentImage(
    user: AuthUser,
    accidentId: string,
    input: CreateAccidentImageBody,
): Promise<AccidentImage> {
    await ensurePublicAccidentExists(accidentId);

    const uploadedImage = await uploadImageToCloudinary(
        input.fileBuffer,
        `accidents/${accidentId}`,
    );

    const image = await prisma.accidentImage.create({
        data: {
            accident_id: accidentId,
            created_by_id: user.id,
            image_url: uploadedImage.secureUrl,
            caption: input.caption?.trim() || null,
        },
    });

    return toAccidentImage(image);
}

export async function deleteAccidentImage(
    user: AuthUser,
    accidentId: string,
    imageId: string,
): Promise<void> {
    const image = await prisma.accidentImage.findFirst({
        where: { id: imageId, accident_id: accidentId },
        select: { id: true, created_by_id: true },
    });

    if (!image) {
        throw new AppError("Image not found", 404, "IMAGE_NOT_FOUND");
    }

    if (!canManageUserContent(user, image.created_by_id)) {
        throw new AppError(
            "You cannot delete this image",
            403,
            "IMAGE_FORBIDDEN",
        );
    }

    await prisma.accidentImage.delete({
        where: { id: imageId },
    });
}
