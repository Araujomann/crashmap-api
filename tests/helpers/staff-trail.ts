import { prisma } from "../../src/shared/database/prisma.js";

/**
 * Remove auditoria e convites criados por testes, para os usuários de teste
 * poderem ser apagados (FKs `Restrict`). A auditoria é somente-inserção: o
 * DELETE só passa dentro da transação que ligou `crashmap.allow_audit_purge`.
 */
export async function purgeStaffTrail(userIds: string[], emails: string[] = []) {
    if (userIds.length === 0 && emails.length === 0) return;

    await prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT set_config('crashmap.allow_audit_purge', 'on', true)`;
        await transaction.adminAuditLog.deleteMany({
            where: {
                OR: [
                    { actor_id: { in: userIds } },
                    { target_id: { in: userIds } },
                ],
            },
        });
    });

    await prisma.moderatorInvite.deleteMany({
        where: {
            OR: [
                { email: { in: emails } },
                { invited_by_id: { in: userIds } },
                { accepted_by_id: { in: userIds } },
                { revoked_by_id: { in: userIds } },
            ],
        },
    });
}
