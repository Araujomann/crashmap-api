import type { FastifyRequest } from "fastify";
import type { Prisma } from "../../../generated/prisma/client.js";
import type { admin_audit_action } from "../../../generated/prisma/enums.js";

export type AuditAction = admin_audit_action;

export type AuditTargetType =
    | "invite"
    | "user"
    | "accident"
    | "comment"
    | "image";

/** De onde veio a ação: preenchido pelo controller a partir da requisição. */
export interface AuditContext {
    ip: string | null;
    userAgent: string | null;
}

export const NO_AUDIT_CONTEXT: AuditContext = { ip: null, userAgent: null };

export function auditContextFrom(request: FastifyRequest): AuditContext {
    const userAgent = request.headers["user-agent"];
    return {
        ip: request.ip ?? null,
        userAgent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
    };
}

export interface AuditEntry {
    actorId: string | null;
    action: AuditAction;
    targetType: AuditTargetType;
    targetId: string | null;
    /** Motivo, antes/depois, retrato do conteúdo. Nunca tokens ou senhas. */
    metadata?: Prisma.InputJsonObject;
}

/**
 * Grava uma linha de auditoria. Sempre chamar com o cliente da transação da
 * própria ação: se a auditoria falhar, a ação também não acontece.
 */
export async function recordAudit(
    db: Prisma.TransactionClient,
    entry: AuditEntry,
    context: AuditContext,
) {
    await db.adminAuditLog.create({
        data: {
            actor_id: entry.actorId,
            action: entry.action,
            target_type: entry.targetType,
            target_id: entry.targetId,
            metadata: entry.metadata ?? {},
            ip: context.ip,
            user_agent: context.userAgent,
        },
    });
}
