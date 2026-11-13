import { prisma } from "../../shared/database/prisma.js";
import type { UserRole } from "../auth/auth.types.js";
import { isUserRole } from "../auth/auth.service.js";
import { recordAudit } from "../audit/audit.service.js";

export class GrantRoleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GrantRoleError";
    }
}

export interface GrantRoleResult {
    userId: string;
    email: string;
    previousRole: UserRole;
    newRole: UserRole;
    changed: boolean;
    revokedSessions: number;
}

/**
 * Altera o papel de uma conta fora da API (uso operacional: criar o primeiro
 * admin, corrigir um papel). Toda alteração vai para a auditoria sem ator
 * (`actor_id = null`) e com o operador local em `metadata.operator`.
 */
export async function grantRole(
    rawEmail: string,
    rawRole: string,
    operator: string,
): Promise<GrantRoleResult> {
    const email = rawEmail.trim().toLowerCase();
    if (!isUserRole(rawRole)) {
        throw new GrantRoleError(
            `Papel inválido: "${rawRole}". Use user, moderator ou admin.`,
        );
    }
    const newRole: UserRole = rawRole;

    return prisma.$transaction(async (transaction) => {
        const user = await transaction.user.findUnique({ where: { email } });
        if (!user || user.deleted_at) {
            throw new GrantRoleError(`Nenhuma conta ativa com o e-mail ${email}.`);
        }
        if (newRole !== "user" && !user.is_email_verified) {
            throw new GrantRoleError(
                "A conta precisa ter o e-mail verificado antes de receber um papel da equipe.",
            );
        }

        const base = {
            userId: user.id,
            email,
            previousRole: user.role,
            newRole,
        };
        if (user.role === newRole) {
            return { ...base, changed: false, revokedSessions: 0 };
        }

        if (user.role === "admin") {
            const otherAdmins = await transaction.user.count({
                where: {
                    role: "admin",
                    deleted_at: null,
                    suspended_at: null,
                    id: { not: user.id },
                },
            });
            if (otherAdmins === 0) {
                throw new GrantRoleError(
                    "Esta é a última conta administradora ativa; promova outra antes.",
                );
            }
        }

        await transaction.user.update({
            where: { id: user.id },
            data: { role: newRole },
        });

        // Quem perde poder sai de todas as sessões.
        const rank: Record<UserRole, number> = { user: 0, moderator: 1, admin: 2 };
        let revokedSessions = 0;
        if (rank[newRole] < rank[user.role]) {
            const revoked = await transaction.refreshToken.updateMany({
                where: { user_id: user.id, revoked_at: null },
                data: { revoked_at: new Date() },
            });
            revokedSessions = revoked.count;
        }

        await recordAudit(
            transaction,
            {
                actorId: null,
                action: "ROLE_GRANTED_BY_SCRIPT",
                targetType: "user",
                targetId: user.id,
                metadata: {
                    email,
                    previous_role: user.role,
                    new_role: newRole,
                    operator,
                    revoked_sessions: revokedSessions,
                },
            },
            { ip: null, userAgent: "script:admin:grant-role" },
        );

        return { ...base, changed: true, revokedSessions };
    });
}
