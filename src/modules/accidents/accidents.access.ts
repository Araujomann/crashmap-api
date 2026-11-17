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


export async function ensurePublicAccidentExists(accidentId: string) {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, moderation_status: "APPROVED" },
        select: { id: true },
    });

    if (!accident) {
        throw accidentNotFoundError();
    }
}




export function canManageContent(user: AuthUser, ownerId: string | null) {
    return ownerId === user.id || can(user, "reports:moderate");
}





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
