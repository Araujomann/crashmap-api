import { prisma } from "../../src/shared/database/prisma.js";

/**
 * Apaga histórico de moderação criado por testes. O trigger
 * `accident_moderation_history_append_only` bloqueia DELETE, exceto dentro de
 * uma transação que ligou `crashmap.allow_history_purge`.
 */
export async function purgeModerationHistory(accidentIds: string[]) {
    if (accidentIds.length === 0) return;

    await prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT set_config('crashmap.allow_history_purge', 'on', true)`;
        await transaction.accidentModerationHistory.deleteMany({
            where: { accident_id: { in: accidentIds } },
        });
    });
}
