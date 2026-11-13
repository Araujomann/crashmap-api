import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { toAuthUser, verifyPassword } from "../auth/auth.service.js";
import type { AuthUser } from "../auth/auth.types.js";
import type {
    DeleteMeBody,
    MyReport,
    MyReportsQuery,
    MyReportsResult,
    UpdateMeBody,
    UserGamificationStats,
} from "./users.types.js";

export async function getMe(userId: string): Promise<AuthUser> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    return toAuthUser(user);
}

export async function getMyGamificationStats(
    userId: string,
): Promise<UserGamificationStats> {
    const [approvedReportsCount, receivedTrustVotesCount] =
        await prisma.$transaction([
            prisma.accident.count({
                where: {
                    created_by_id: userId,
                    source: "APP",
                    moderation_status: "APPROVED",
                },
            }),
            prisma.accidentTrustVote.count({
                where: {
                    accident: { is: { created_by_id: userId } },
                },
            }),
        ]);

    return {
        approved_reports_count: approvedReportsCount,
        received_trust_votes_count: receivedTrustVotesCount,
    };
}

export async function getMyReports(
    userId: string,
    query: MyReportsQuery = {},
): Promise<MyReportsResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const where = {
        created_by_id: userId,
        source: "APP" as const,
        ...(query.status ? { moderation_status: query.status } : {}),
    };

    const [total, reports] = await prisma.$transaction([
        prisma.accident.count({ where }),
        prisma.accident.findMany({
            where,
            select: {
                id: true,
                tipo_acidente: true,
                classificacao_acidente: true,
                condicao_meteorologica: true,
                description: true,
                latitude: true,
                longitude: true,
                occurred_at: true,
                severity: true,
                source: true,
                moderation_status: true,
                moderation_message: true,
                moderated_at: true,
                created_by_id: true,
                created_at: true,
                updated_at: true,
                images: {
                    select: {
                        id: true,
                        image_url: true,
                        caption: true,
                    },
                    orderBy: { created_at: "asc" },
                    take: 1,
                },
            },
            orderBy: { created_at: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        data: reports satisfies MyReport[],
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

export async function updateMe(
    userId: string,
    input: UpdateMeBody,
): Promise<AuthUser> {
    const name = input.name.trim();

    if (name.length < 2) {
        throw new AppError(
            "Name must contain at least 2 characters after trimming",
            400,
            "INVALID_NAME",
        );
    }

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { name },
    });

    return toAuthUser(updatedUser);
}

/**
 * Exclui permanentemente a conta do usuário corrente.
 *
 * - Contas com senha precisam reconfirmá-la (reautenticação).
 * - Contas da equipe (moderador/admin) não podem ser excluídas por aqui: o
 *   histórico de moderação e os avisos administrativos dependem delas.
 * - Tokens, comentários, votos e imagens são removidos em cascata; os relatos
 *   permanecem no mapa sem autor (`created_by_id` → NULL).
 * - Ex-integrantes da equipe (rebaixados para `user`) que deixaram decisões de
 *   moderação ou avisos são anonimizados em vez de apagados: os dados pessoais
 *   somem, mas a autoria das decisões continua rastreável pelo mesmo `id`.
 */
export async function deleteMe(
    userId: string,
    input: DeleteMeBody = {},
): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    if (user.role !== "user") {
        throw new AppError(
            "Staff accounts cannot be deleted through the app",
            403,
            "STAFF_ACCOUNT_DELETION_FORBIDDEN",
        );
    }

    if (user.password_hash) {
        if (!input.password) {
            throw new AppError(
                "Password is required to delete the account",
                400,
                "PASSWORD_REQUIRED",
            );
        }

        if (!verifyPassword(input.password, user.password_hash)) {
            // 403 (e não 401) para não disparar a renovação de sessão no app.
            throw new AppError("Invalid password", 403, "INVALID_PASSWORD");
        }
    }

    const [decisions, notices] = await Promise.all([
        prisma.accidentModerationHistory.count({
            where: { moderated_by_id: userId },
        }),
        prisma.administrativeNotice.count({ where: { created_by_id: userId } }),
    ]);

    if (decisions + notices > 0) {
        await anonymizeAccount(userId);
        return;
    }

    await prisma.user.delete({ where: { id: userId } });
}

export const DELETED_ACCOUNT_NAME = "Conta removida";

/**
 * Remove os dados pessoais e tudo que a exclusão normal removeria em cascata,
 * mas mantém a linha de `User` para não quebrar as FKs `Restrict` do histórico
 * de moderação e dos avisos.
 */
async function anonymizeAccount(userId: string): Promise<void> {
    const where = { user_id: userId };
    const authored = { created_by_id: userId };

    await prisma.$transaction([
        prisma.refreshToken.deleteMany({ where }),
        prisma.pushToken.deleteMany({ where }),
        prisma.verificationToken.deleteMany({ where }),
        prisma.passwordResetToken.deleteMany({ where }),
        prisma.accidentComment.deleteMany({ where: authored }),
        prisma.accidentImage.deleteMany({ where: authored }),
        prisma.accidentTrustVote.deleteMany({ where: authored }),
        prisma.accident.updateMany({
            where: authored,
            data: { created_by_id: null },
        }),
        prisma.user.update({
            where: { id: userId },
            data: {
                name: DELETED_ACCOUNT_NAME,
                email: `deleted+${userId}@invalid.local`,
                password_hash: null,
                google_id: null,
                is_email_verified: false,
                email_verified_at: null,
                role: "user",
                deleted_at: new Date(),
            },
        }),
    ]);
}
