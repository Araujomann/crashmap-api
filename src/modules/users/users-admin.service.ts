import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
    buildPaginationMeta,
    resolvePagination,
} from "../../shared/http/pagination.js";
import type { AuthUser } from "../auth/auth.types.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { revokeAllSessions } from "../auth/sessions.js";
import type {
    AdminUserDetail,
    AdminUserSummary,
    AdminUsersQuery,
} from "./users.types.js";

const summarySelect = {
    id: true,
    name: true,
    email: true,
    role: true,
    is_email_verified: true,
    created_at: true,
    suspended_at: true,
    suspended_reason: true,
    suspended_by: { select: { id: true, name: true } },
} as const;


export async function listUsers(query: AdminUsersQuery = {}) {
    const pagination = resolvePagination(query, 20);
    const search = query.search?.trim();

    const where = {
        deleted_at: null,
        ...(query.role ? { role: query.role } : {}),
        ...(query.status === "suspended"
            ? { suspended_at: { not: null } }
            : query.status === "active"
              ? { suspended_at: null }
              : {}),
        ...(search
            ? {
                  OR: [
                      { name: { contains: search, mode: "insensitive" as const } },
                      { email: { contains: search, mode: "insensitive" as const } },
                  ],
              }
            : {}),
    };

    const [total, users] = await prisma.$transaction([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where,
            select: summarySelect,
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            skip: pagination.skip,
            take: pagination.limit,
        }),
    ]);

    return {
        data: users satisfies AdminUserSummary[],
        pagination: buildPaginationMeta(pagination, total),
    };
}

export async function getUserDetail(userId: string): Promise<AdminUserDetail> {
    const user = await prisma.user.findFirst({
        where: { id: userId, deleted_at: null },
        select: {
            ...summarySelect,
            _count: {
                select: {
                    accidents: true,
                    accident_comments: true,
                    moderation_decisions: true,
                },
            },
        },
    });

    if (!user) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    const activeSessions = await prisma.refreshToken.count({
        where: { user_id: userId, revoked_at: null, expires_at: { gt: new Date() } },
    });

    const { _count, ...summary } = user;
    return {
        ...summary,
        reports_count: _count.accidents,
        comments_count: _count.accident_comments,
        decisions_count: _count.moderation_decisions,
        active_sessions: activeSessions,
    };
}

async function loadTarget(actor: AuthUser, targetId: string, action: string) {
    if (targetId === actor.id) {
        throw new AppError(
            `Você não pode ${action} a própria conta`,
            409,
            "CANNOT_TARGET_SELF",
        );
    }

    const target = await prisma.user.findFirst({
        where: { id: targetId, deleted_at: null },
        select: { id: true, name: true, email: true, role: true, suspended_at: true },
    });
    if (!target) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    
    if (target.role === "admin") {
        throw new AppError(
            "Esta ação não pode ser aplicada a administradores",
            409,
            "CANNOT_TARGET_ADMIN",
        );
    }
    return target;
}


export async function suspendUser(
    actor: AuthUser,
    targetId: string,
    rawReason: string,
    context: AuditContext,
): Promise<AdminUserDetail> {
    const reason = rawReason.trim();
    if (reason.length < 3) {
        throw new AppError("Informe o motivo da suspensão", 400, "SUSPEND_REASON_REQUIRED");
    }

    const target = await loadTarget(actor, targetId, "suspender");
    const now = new Date();

    await prisma.$transaction(async (transaction) => {
        const suspended = await transaction.user.updateMany({
            where: { id: targetId, suspended_at: null },
            data: {
                suspended_at: now,
                suspended_reason: reason,
                suspended_by_id: actor.id,
            },
        });
        if (suspended.count !== 1) {
            throw new AppError("Esta conta já está suspensa", 409, "USER_ALREADY_SUSPENDED");
        }

        const revokedSessions = await revokeAllSessions(
            transaction,
            targetId,
            now,
        );

        await recordAudit(
            transaction,
            {
                actorId: actor.id,
                action: "USER_SUSPENDED",
                targetType: "user",
                targetId,
                metadata: {
                    reason,
                    name: target.name,
                    email: target.email,
                    role: target.role,
                    revoked_sessions: revokedSessions,
                },
            },
            context,
        );
    });

    return getUserDetail(targetId);
}

export async function reactivateUser(
    actor: AuthUser,
    targetId: string,
    context: AuditContext,
): Promise<AdminUserDetail> {
    const target = await loadTarget(actor, targetId, "reativar");

    await prisma.$transaction(async (transaction) => {
        const current = await transaction.user.findUniqueOrThrow({
            where: { id: targetId },
            select: { suspended_at: true, suspended_reason: true },
        });
        const reactivated = await transaction.user.updateMany({
            where: { id: targetId, suspended_at: { not: null } },
            data: { suspended_at: null, suspended_reason: null, suspended_by_id: null },
        });
        if (reactivated.count !== 1) {
            throw new AppError("Esta conta não está suspensa", 409, "USER_NOT_SUSPENDED");
        }

        await recordAudit(
            transaction,
            {
                actorId: actor.id,
                action: "USER_REACTIVATED",
                targetType: "user",
                targetId,
                metadata: {
                    name: target.name,
                    email: target.email,
                    suspended_at: current.suspended_at?.toISOString() ?? null,
                    suspended_reason: current.suspended_reason,
                },
            },
            context,
        );
    });

    return getUserDetail(targetId);
}


export async function revokeUserSessions(
    actor: AuthUser,
    targetId: string,
    context: AuditContext,
): Promise<{ revoked_sessions: number }> {
    const target = await loadTarget(actor, targetId, "encerrar as sessões de");

    return prisma.$transaction(async (transaction) => {
        const revokedSessions = await revokeAllSessions(transaction, targetId);

        await recordAudit(
            transaction,
            {
                actorId: actor.id,
                action: "USER_SESSIONS_REVOKED",
                targetType: "user",
                targetId,
                metadata: {
                    name: target.name,
                    email: target.email,
                    revoked_sessions: revokedSessions,
                },
            },
            context,
        );

        return { revoked_sessions: revokedSessions };
    });
}
