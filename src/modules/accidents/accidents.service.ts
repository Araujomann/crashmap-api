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
    AccidentSeverity,
    CreateAccidentCommentBody,
    CreateAccidentImageBody,
    CreateAccidentBody,
    UpdateAccidentBody,
} from "./accidents.types.js";

function toAccident(accident: {
    id: string;
    title: string;
    description: string | null;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: AccidentSeverity;
    created_by_id: string | null;
    created_at: Date;
    updated_at: Date;
}): Accident {
    return {
        id: accident.id,
        title: accident.title,
        description: accident.description,
        latitude: accident.latitude,
        longitude: accident.longitude,
        occurred_at: accident.occurred_at,
        severity: accident.severity,
        created_by_id: accident.created_by_id,
        created_at: accident.created_at,
        updated_at: accident.updated_at,
    };
}

function toAccidentComment(comment: {
    id: string;
    accident_id: string;
    created_by_id: string;
    body: string;
    created_at: Date;
    updated_at: Date;
}): AccidentComment {
    return {
        id: comment.id,
        accident_id: comment.accident_id,
        created_by_id: comment.created_by_id,
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
    title: string;
    description: string | null;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: AccidentSeverity;
    created_by_id: string | null;
    created_at: Date;
    updated_at: Date;
    comments: Array<{
        id: string;
        accident_id: string;
        created_by_id: string;
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
        input.title === undefined &&
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

    const where = {
        ...(search
            ? {
                  OR: [
                      {
                          title: {
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

export async function getAccident(accidentId: string): Promise<Accident> {
    const accident = await prisma.accident.findUnique({
        where: { id: accidentId },
        include: {
            comments: {
                orderBy: { created_at: "asc" },
            },
            images: {
                orderBy: { created_at: "asc" },
            },
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
            title: input.title.trim(),
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
            title: input.title?.trim(),
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

async function ensureAccidentExists(accidentId: string) {
    const accident = await prisma.accident.findUnique({
        where: { id: accidentId },
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
    await ensureAccidentExists(accidentId);

    const comments = await prisma.accidentComment.findMany({
        where: { accident_id: accidentId },
        orderBy: { created_at: "asc" },
    });

    return comments.map(toAccidentComment);
}

export async function createAccidentComment(
    user: AuthUser,
    accidentId: string,
    input: CreateAccidentCommentBody,
): Promise<AccidentComment> {
    await ensureAccidentExists(accidentId);

    const comment = await prisma.accidentComment.create({
        data: {
            accident_id: accidentId,
            created_by_id: user.id,
            body: input.body.trim(),
        },
    });

    return toAccidentComment(comment);
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
    await ensureAccidentExists(accidentId);

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
    await ensureAccidentExists(accidentId);

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
