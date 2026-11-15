import type { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../auth/auth.types.js";
import { can } from "../auth/permissions.js";
import {
    recordAudit,
    type AuditContext,
    type AuditEntry,
} from "../audit/audit.service.js";

export function accidentNotFoundError() {
    return new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
}

/** Relatos visíveis ao público são só os aprovados. */
export async function ensurePublicAccidentExists(accidentId: string) {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, moderation_status: "APPROVED" },
        select: { id: true },
    });

    if (!accident) {
        throw accidentNotFoundError();
    }
}

// Staff pode editar/apagar conteúdo de terceiros (decisão nº 3 em
// farol-admin/docs/architecture.md, "Decisões de autorização"). Cada ação de
// staff sobre conteúdo alheio vai para a AdminAuditLog.
export function canManageContent(user: AuthUser, ownerId: string | null) {
    return ownerId === user.id || can(user, "reports:moderate");
}

/**
 * Registra a auditoria só quando quem agiu não é o autor do conteúdo (isto
 * é, quando a ação foi de staff). Usar dentro da transação da própria ação.
 */
export async function auditStaffActionOnContent(
    db: Prisma.TransactionClient,
    actor: AuthUser,
    ownerId: string | null,
    entry: Omit<AuditEntry, "actorId">,
    context: AuditContext,
) {
    if (ownerId === actor.id) return;

    await recordAudit(db, { actorId: actor.id, ...entry }, context);
}
