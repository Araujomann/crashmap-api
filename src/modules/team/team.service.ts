import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../auth/auth.types.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { TeamMember } from "./team.types.js";

/** Moderadores e administradores ativos. */
export async function listTeam(): Promise<TeamMember[]> {
    const members = await prisma.user.findMany({
        where: { role: { in: ["moderator", "admin"] }, deleted_at: null },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            created_at: true,
            _count: { select: { moderation_decisions: true } },
            invites_accepted: {
                select: { accepted_at: true },
                orderBy: { accepted_at: "desc" },
                take: 1,
            },
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
    });

    return members.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role === "admin" ? "admin" : "moderator",
        decisions_count: member._count.moderation_decisions,
        created_at: member.created_at,
        joined_at: member.invites_accepted[0]?.accepted_at ?? null,
    }));
}

/**
 * Remove a permissão de moderador: volta a `user` e todas as sessões são
 * encerradas. Administradores não são rebaixados por aqui.
 */
export async function revokeModerator(
    actor: AuthUser,
    targetId: string,
    rawReason: string,
    context: AuditContext,
): Promise<void> {
    const reason = rawReason.trim();
    if (reason.length < 3) {
        throw new AppError(
            "Informe o motivo da remoção",
            400,
            "REVOKE_REASON_REQUIRED",
        );
    }

    if (targetId === actor.id) {
        throw new AppError(
            "Você não pode remover a própria permissão",
            409,
            "CANNOT_REVOKE_SELF",
        );
    }

    const now = new Date();
    await prisma.$transaction(async (transaction) => {
        const target = await transaction.user.findUnique({
            where: { id: targetId },
            select: { id: true, name: true, email: true, role: true, deleted_at: true },
        });

        if (!target || target.deleted_at) {
            throw new AppError("User not found", 404, "USER_NOT_FOUND");
        }
        if (target.role === "admin") {
            throw new AppError(
                "Administradores não podem ser removidos por esta ação",
                409,
                "CANNOT_REVOKE_ADMIN",
            );
        }

        const demoted = await transaction.user.updateMany({
            where: { id: targetId, role: "moderator" },
            data: { role: "user" },
        });
        if (demoted.count !== 1) {
            throw new AppError(
                "Esta conta não é moderadora",
                409,
                "NOT_A_MODERATOR",
            );
        }

        const sessions = await transaction.refreshToken.updateMany({
            where: { user_id: targetId, revoked_at: null },
            data: { revoked_at: now },
        });

        await recordAudit(
            transaction,
            {
                actorId: actor.id,
                action: "MODERATOR_ROLE_REVOKED",
                targetType: "user",
                targetId,
                metadata: {
                    reason,
                    name: target.name,
                    email: target.email,
                    previous_role: "moderator",
                    revoked_sessions: sessions.count,
                },
            },
            context,
        );
    });
}
