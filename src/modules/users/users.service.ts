import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { toAuthUser } from "../auth/auth.service.js";
import type { AuthUser } from "../auth/auth.types.js";
import type {
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
    const approvedReportsCount = await prisma.accident.count({
        where: {
            created_by_id: userId,
            source: "APP",
            moderation_status: "APPROVED",
        },
    });

    return { approved_reports_count: approvedReportsCount };
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
