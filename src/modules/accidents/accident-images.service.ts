import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { uploadImageToCloudinary } from "../../shared/services/storage/cloudinary.js";
import type { AuthUser } from "../auth/auth.types.js";
import { NO_AUDIT_CONTEXT, type AuditContext } from "../audit/audit.service.js";
import {
    auditStaffActionOnContent,
    canManageContent,
    ensurePublicAccidentExists,
} from "./accidents.access.js";
import { toAccidentImage } from "./accidents.mapper.js";
import type {
    AccidentImage,
    CreateAccidentImageBody,
} from "./accidents.types.js";

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
    auditContext: AuditContext = NO_AUDIT_CONTEXT,
): Promise<void> {
    const image = await prisma.accidentImage.findFirst({
        where: { id: imageId, accident_id: accidentId },
        select: {
            id: true,
            created_by_id: true,
            image_url: true,
            caption: true,
            created_at: true,
        },
    });

    if (!image) {
        throw new AppError("Image not found", 404, "IMAGE_NOT_FOUND");
    }

    if (!canManageContent(user, image.created_by_id)) {
        throw new AppError(
            "You cannot delete this image",
            403,
            "IMAGE_FORBIDDEN",
        );
    }

    await prisma.$transaction(async (transaction) => {
        await transaction.accidentImage.delete({
            where: { id: imageId },
        });

        await auditStaffActionOnContent(
            transaction,
            user,
            image.created_by_id,
            {
                action: "IMAGE_DELETED_BY_STAFF",
                targetType: "image",
                targetId: imageId,
                metadata: {
                    accident_id: accidentId,
                    author_id: image.created_by_id,
                    image_url: image.image_url,
                    caption: image.caption,
                    created_at: image.created_at.toISOString(),
                },
            },
            auditContext,
        );
    });
}
