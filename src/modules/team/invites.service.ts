import { createHmac, randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../../shared/config/env.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { toAuthUser } from "../auth/auth.service.js";
import type { AuthUser } from "../auth/auth.types.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { buildInviteUrl, sendModeratorInviteEmail } from "./invite-email.js";
import type {
    InviteDelivery,
    InviteStatus,
    ListInvitesQuery,
    ModeratorInvite,
} from "./team.types.js";

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_EMAIL_PER_DAY = 5;
const MAX_INVITES_PER_ADMIN_PER_HOUR = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function hashInviteToken(token: string) {
    return createHmac("sha256", env.REFRESH_TOKEN_SECRET)
        .update(`moderator-invite:${token}`)
        .digest("hex");
}

function generateInviteToken() {
    return randomBytes(32).toString("base64url");
}

export function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

const personSelect = { select: { id: true, name: true } } as const;
const inviteInclude = {
    invited_by: personSelect,
    accepted_by: personSelect,
    revoked_by: personSelect,
} as const;

type InviteRecord = {
    id: string;
    email: string;
    expires_at: Date;
    created_at: Date;
    last_sent_at: Date;
    send_count: number;
    accepted_at: Date | null;
    revoked_at: Date | null;
    invited_by: { id: string; name: string };
    accepted_by: { id: string; name: string } | null;
    revoked_by: { id: string; name: string } | null;
};

export function inviteStatus(
    invite: Pick<InviteRecord, "accepted_at" | "revoked_at" | "expires_at">,
    now = new Date(),
): InviteStatus {
    if (invite.accepted_at) return "ACCEPTED";
    if (invite.revoked_at) return "REVOKED";
    if (invite.expires_at <= now) return "EXPIRED";
    return "PENDING";
}

function toInvite(record: InviteRecord): ModeratorInvite {
    return {
        id: record.id,
        email: record.email,
        status: inviteStatus(record),
        expires_at: record.expires_at,
        created_at: record.created_at,
        last_sent_at: record.last_sent_at,
        send_count: record.send_count,
        invited_by: record.invited_by,
        accepted_at: record.accepted_at,
        accepted_by: record.accepted_by,
        revoked_at: record.revoked_at,
        revoked_by: record.revoked_by,
    };
}

function statusWhere(status: InviteStatus | undefined, now: Date) {
    switch (status) {
        case "PENDING":
            return { accepted_at: null, revoked_at: null, expires_at: { gt: now } };
        case "EXPIRED":
            return { accepted_at: null, revoked_at: null, expires_at: { lte: now } };
        case "ACCEPTED":
            return { accepted_at: { not: null } };
        case "REVOKED":
            return { revoked_at: { not: null } };
        default:
            return {};
    }
}

async function ensureSendAllowed(email: string, now: Date) {
    const sentToday = await prisma.moderatorInvite.count({
        where: { email, created_at: { gt: new Date(now.getTime() - DAY_MS) } },
    });
    if (sentToday >= MAX_SENDS_PER_EMAIL_PER_DAY) {
        throw new AppError(
            "Too many invites sent to this email today",
            429,
            "INVITE_RATE_LIMITED",
        );
    }
}

async function deliver(
    invite: ModeratorInvite,
    token: string,
    actor: AuthUser,
    logger: FastifyBaseLogger,
): Promise<InviteDelivery> {
    const emailSent = await sendModeratorInviteEmail(
        {
            to: invite.email,
            inviteUrl: buildInviteUrl(token),
            inviterName: actor.name,
            expiresAt: invite.expires_at,
        },
        logger,
    );
    return { invite, email_sent: emailSent };
}

export async function listInvites(
    query: ListInvitesQuery = {},
): Promise<{ data: ModeratorInvite[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const now = new Date();
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const where = statusWhere(query.status, now);

    const [total, invites] = await prisma.$transaction([
        prisma.moderatorInvite.count({ where }),
        prisma.moderatorInvite.findMany({
            where,
            include: inviteInclude,
            orderBy: [{ created_at: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        data: invites.map(toInvite),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

export async function createInvite(
    actor: AuthUser,
    rawEmail: string,
    context: AuditContext,
    logger: FastifyBaseLogger,
): Promise<InviteDelivery> {
    const email = normalizeEmail(rawEmail);
    const now = new Date();

    const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { role: true, deleted_at: true },
    });
    if (existingUser && existingUser.role !== "user" && !existingUser.deleted_at) {
        throw new AppError(
            "This account is already part of the team",
            409,
            "INVITE_ALREADY_STAFF",
        );
    }

    const sentByActor = await prisma.moderatorInvite.count({
        where: {
            invited_by_id: actor.id,
            created_at: { gt: new Date(now.getTime() - HOUR_MS) },
        },
    });
    if (sentByActor >= MAX_INVITES_PER_ADMIN_PER_HOUR) {
        throw new AppError(
            "Too many invites created in the last hour",
            429,
            "INVITE_RATE_LIMITED",
        );
    }
    await ensureSendAllowed(email, now);

    const token = generateInviteToken();
    const invite = await prisma.$transaction(async (transaction) => {
        const open = await transaction.moderatorInvite.findFirst({
            where: { email, accepted_at: null, revoked_at: null },
        });

        if (open && open.expires_at > now) {
            throw new AppError(
                "There is already a pending invite for this email",
                409,
                "INVITE_ALREADY_PENDING",
            );
        }

        // Convite vencido ainda ocupa o índice "um em aberto por e-mail":
        // o sistema o encerra antes de criar o novo.
        if (open) {
            await transaction.moderatorInvite.update({
                where: { id: open.id },
                data: { revoked_at: now },
            });
        }

        const created = await transaction.moderatorInvite.create({
            data: {
                email,
                token_hash: hashInviteToken(token),
                invited_by_id: actor.id,
                expires_at: new Date(now.getTime() + INVITE_TTL_MS),
                last_sent_at: now,
            },
            include: inviteInclude,
        });

        await recordAudit(
            transaction,
            {
                actorId: actor.id,
                action: "MODERATOR_INVITE_CREATED",
                targetType: "invite",
                targetId: created.id,
                metadata: {
                    email,
                    expires_at: created.expires_at.toISOString(),
                    ...(open ? { replaced_expired_invite_id: open.id } : {}),
                },
            },
            context,
        );

        return created;
    });

    return deliver(toInvite(invite), token, actor, logger);
}

/** Gera um novo link (o antigo deixa de valer) e reenvia o e-mail. */
export async function resendInvite(
    actor: AuthUser,
    inviteId: string,
    context: AuditContext,
    logger: FastifyBaseLogger,
): Promise<InviteDelivery> {
    const now = new Date();
    const current = await prisma.moderatorInvite.findUnique({
        where: { id: inviteId },
    });

    if (!current) {
        throw new AppError("Invite not found", 404, "INVITE_NOT_FOUND");
    }
    if (current.accepted_at || current.revoked_at) {
        throw new AppError(
            "Only open invites can be resent",
            409,
            "INVITE_NOT_OPEN",
        );
    }
    if (now.getTime() - current.last_sent_at.getTime() < RESEND_COOLDOWN_MS) {
        throw new AppError(
            "Wait a minute before resending this invite",
            429,
            "INVITE_RESEND_COOLDOWN",
        );
    }
    await ensureSendAllowed(current.email, now);

    const token = generateInviteToken();
    const invite = await prisma.$transaction(async (transaction) => {
        const closed = await transaction.moderatorInvite.updateMany({
            where: { id: current.id, accepted_at: null, revoked_at: null },
            data: { revoked_at: now, revoked_by_id: actor.id },
        });
        if (closed.count !== 1) {
            throw new AppError(
                "Only open invites can be resent",
                409,
                "INVITE_NOT_OPEN",
            );
        }

        const created = await transaction.moderatorInvite.create({
            data: {
                email: current.email,
                token_hash: hashInviteToken(token),
                invited_by_id: actor.id,
                expires_at: new Date(now.getTime() + INVITE_TTL_MS),
                last_sent_at: now,
                send_count: current.send_count + 1,
            },
            include: inviteInclude,
        });

        await recordAudit(
            transaction,
            {
                actorId: actor.id,
                action: "MODERATOR_INVITE_RESENT",
                targetType: "invite",
                targetId: created.id,
                metadata: {
                    email: current.email,
                    previous_invite_id: current.id,
                    expires_at: created.expires_at.toISOString(),
                },
            },
            context,
        );

        return created;
    });

    return deliver(toInvite(invite), token, actor, logger);
}

export async function revokeInvite(
    actor: AuthUser,
    inviteId: string,
    context: AuditContext,
): Promise<ModeratorInvite> {
    const now = new Date();

    const invite = await prisma.$transaction(async (transaction) => {
        const revoked = await transaction.moderatorInvite.updateMany({
            where: { id: inviteId, accepted_at: null, revoked_at: null },
            data: { revoked_at: now, revoked_by_id: actor.id },
        });

        if (revoked.count !== 1) {
            const exists = await transaction.moderatorInvite.count({
                where: { id: inviteId },
            });
            throw exists
                ? new AppError("Only open invites can be revoked", 409, "INVITE_NOT_OPEN")
                : new AppError("Invite not found", 404, "INVITE_NOT_FOUND");
        }

        const updated = await transaction.moderatorInvite.findUniqueOrThrow({
            where: { id: inviteId },
            include: inviteInclude,
        });

        await recordAudit(
            transaction,
            {
                actorId: actor.id,
                action: "MODERATOR_INVITE_REVOKED",
                targetType: "invite",
                targetId: inviteId,
                metadata: { email: updated.email },
            },
            context,
        );

        return updated;
    });

    return toInvite(invite);
}

const INVALID_INVITE = () =>
    new AppError("Convite inválido ou expirado", 410, "INVITE_INVALID");

/**
 * Consome o convite e promove a conta autenticada a moderador. Respostas
 * iguais para convite inexistente, vencido, revogado ou já usado, para não
 * revelar o estado de um token.
 */
export async function acceptInvite(
    user: AuthUser,
    token: string,
    context: AuditContext,
): Promise<AuthUser> {
    const now = new Date();

    const updatedUser = await prisma.$transaction(async (transaction) => {
        const invite = await transaction.moderatorInvite.findUnique({
            where: { token_hash: hashInviteToken(token) },
        });

        if (!invite || inviteStatus(invite, now) !== "PENDING") {
            throw INVALID_INVITE();
        }

        if (invite.email !== normalizeEmail(user.email)) {
            throw new AppError(
                "Este convite foi enviado para outro e-mail",
                403,
                "INVITE_EMAIL_MISMATCH",
            );
        }

        // Consumo atômico: em uma corrida, só um aceite vence.
        const consumed = await transaction.moderatorInvite.updateMany({
            where: {
                id: invite.id,
                accepted_at: null,
                revoked_at: null,
                expires_at: { gt: now },
            },
            data: { accepted_at: now, accepted_by_id: user.id },
        });
        if (consumed.count !== 1) throw INVALID_INVITE();

        // Nunca rebaixa: admin que aceita continua admin.
        await transaction.user.updateMany({
            where: { id: user.id, role: "user" },
            data: { role: "moderator" },
        });

        await recordAudit(
            transaction,
            {
                actorId: user.id,
                action: "MODERATOR_INVITE_ACCEPTED",
                targetType: "invite",
                targetId: invite.id,
                metadata: {
                    invited_by_id: invite.invited_by_id,
                    previous_role: user.role,
                },
            },
            context,
        );

        return transaction.user.findUniqueOrThrow({ where: { id: user.id } });
    });

    return toAuthUser(updatedUser);
}
