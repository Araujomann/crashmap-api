import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";

export const MAX_ADMINISTRATIVE_NOTICE_LENGTH = 1000;
const MAX_ADMINISTRATIVE_NOTICES = 50;

export async function listAdministrativeNotices() {
    return prisma.administrativeNotice.findMany({
        select: {
            id: true,
            message: true,
            created_at: true,
        },
        orderBy: { created_at: "desc" },
        take: MAX_ADMINISTRATIVE_NOTICES,
    });
}

export async function createAdministrativeNotice(
    message: string,
    createdById: string,
) {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
        throw new AppError(
            "Escreva uma mensagem antes de publicar.",
            400,
            "INVALID_ADMINISTRATIVE_NOTICE",
        );
    }

    if (normalizedMessage.length > MAX_ADMINISTRATIVE_NOTICE_LENGTH) {
        throw new AppError(
            `A mensagem deve ter no máximo ${MAX_ADMINISTRATIVE_NOTICE_LENGTH} caracteres.`,
            400,
            "INVALID_ADMINISTRATIVE_NOTICE",
        );
    }

    return prisma.administrativeNotice.create({
        data: {
            message: normalizedMessage,
            created_by_id: createdById,
        },
        select: {
            id: true,
            message: true,
            created_at: true,
        },
    });
}