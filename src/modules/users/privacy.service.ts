import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { toAuthUser } from "../auth/auth-user.js";
import type { AuthUser } from "../auth/auth.types.js";







export async function acceptTerms(
    userId: string,
    version: string,
): Promise<AuthUser> {
    const user = await prisma.user.update({
        where: { id: userId },
        data: { terms_version: version, terms_accepted_at: new Date() },
    });

    return toAuthUser(user);
}


export async function exportMyData(userId: string) {
    const now = new Date();
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            is_email_verified: true,
            email_verified_at: true,
            terms_version: true,
            terms_accepted_at: true,
            created_at: true,
            updated_at: true,
        },
    });

    if (!user) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    const [reports, comments, images, trustVotes, devices, activeSessions] =
        await Promise.all([
            prisma.accident.findMany({
                where: { created_by_id: userId },
                orderBy: { created_at: "asc" },
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
                    moderation_status: true,
                    moderation_message: true,
                    moderated_at: true,
                    created_at: true,
                    updated_at: true,
                },
            }),
            prisma.accidentComment.findMany({
                where: { created_by_id: userId },
                orderBy: { created_at: "asc" },
                select: {
                    id: true,
                    accident_id: true,
                    body: true,
                    created_at: true,
                    updated_at: true,
                },
            }),
            prisma.accidentImage.findMany({
                where: { created_by_id: userId },
                orderBy: { created_at: "asc" },
                select: {
                    id: true,
                    accident_id: true,
                    image_url: true,
                    caption: true,
                    created_at: true,
                },
            }),
            prisma.accidentTrustVote.findMany({
                where: { created_by_id: userId },
                orderBy: { created_at: "asc" },
                select: { accident_id: true, created_at: true },
            }),
            prisma.pushToken.findMany({
                where: { user_id: userId },
                orderBy: { created_at: "asc" },
                select: { platform: true, created_at: true, updated_at: true },
            }),
            prisma.refreshToken.count({
                where: {
                    user_id: userId,
                    revoked_at: null,
                    expires_at: { gt: now },
                },
            }),
        ]);

    return {
        generated_at: now,
        account: user,
        reports,
        comments,
        images,
        trust_votes: trustVotes,
        devices,
        active_sessions: activeSessions,
    };
}
