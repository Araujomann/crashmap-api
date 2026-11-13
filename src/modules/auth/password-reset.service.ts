import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../../shared/config/env.js";
import { prisma } from "../../shared/database/prisma.js";
import {
    generateSixDigitCode,
    hmacSha256Hex,
    sha256Hex,
} from "../../shared/security/crypto.js";
import {
    isMailConfigured,
    sendMail,
} from "../../shared/services/mail/mailer.js";
import { normalizeEmail } from "../../shared/utils/email.js";
import { AuthError } from "./auth.errors.js";
import type {
    ResetPasswordBody,
    VerifyPasswordResetCodeBody,
} from "./auth.types.js";
import { hashPassword } from "./password.js";
import { buildPasswordResetEmail } from "./password-reset-email.js";
import { revokeAllSessions } from "./sessions.js";

const PASSWORD_RESET_CODE_TTL_MS = 5 * 60 * 1000;
const PASSWORD_RESET_AUTH_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_REQUEST_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_MAX_REQUESTS = 3;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

export function hashPasswordResetCode(userId: string, code: string): string {
    return hmacSha256Hex(
        env.REFRESH_TOKEN_SECRET,
        `password-reset-code:${userId}:${code}`,
    );
}

const invalidCodeError = () =>
    new AuthError(
        "O código é inválido ou expirou.",
        400,
        "AUTH_INVALID_PASSWORD_RESET_CODE",
    );

const invalidAuthorizationError = () =>
    new AuthError(
        "A autorização de redefinição é inválida ou expirou.",
        400,
        "AUTH_INVALID_PASSWORD_RESET_AUTHORIZATION",
    );

function isUniqueConstraintError(error: unknown) {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
    );
}

/**
 * Grava o código novo para a conta, respeitando a janela de pedidos e o
 * intervalo mínimo entre eles. Retorna `false` quando o pedido deve ser
 * ignorado em silêncio (limite atingido ou corrida com outro pedido).
 */
async function storePasswordResetCode(
    userId: string,
    codeHash: string,
    now: Date,
): Promise<boolean> {
    const currentRecord = await prisma.passwordResetToken.findUnique({
        where: { user_id: userId },
    });

    if (currentRecord) {
        const requestWindowExpired =
            now.getTime() - currentRecord.request_window_started_at.getTime() >=
            PASSWORD_RESET_REQUEST_WINDOW_MS;
        const requestCount = requestWindowExpired
            ? 0
            : currentRecord.request_count;

        if (
            requestCount >= PASSWORD_RESET_MAX_REQUESTS ||
            now.getTime() - currentRecord.created_at.getTime() <
                PASSWORD_RESET_REQUEST_COOLDOWN_MS
        ) {
            return false;
        }

        const updated = await prisma.passwordResetToken.updateMany({
            where: {
                id: currentRecord.id,
                request_count: currentRecord.request_count,
                created_at: currentRecord.created_at,
            },
            data: {
                token_hash: codeHash,
                expires_at: new Date(now.getTime() + PASSWORD_RESET_CODE_TTL_MS),
                created_at: now,
                attempts: 0,
                request_count: requestCount + 1,
                request_window_started_at: requestWindowExpired
                    ? now
                    : currentRecord.request_window_started_at,
                authorization_hash: null,
                authorization_expires_at: null,
            },
        });

        return updated.count === 1;
    }

    try {
        await prisma.passwordResetToken.create({
            data: {
                user_id: userId,
                token_hash: codeHash,
                expires_at: new Date(now.getTime() + PASSWORD_RESET_CODE_TTL_MS),
                created_at: now,
                request_count: 1,
                request_window_started_at: now,
            },
        });
        return true;
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            return false;
        }

        throw error;
    }
}

export async function requestPasswordReset(
    email: string,
    logger: FastifyBaseLogger,
): Promise<void> {
    if (!isMailConfigured()) {
        throw new AuthError(
            "A recuperação de senha está temporariamente indisponível.",
            503,
            "AUTH_PASSWORD_RESET_UNAVAILABLE",
        );
    }

    const user = await prisma.user.findUnique({
        where: { email: normalizeEmail(email) },
    });

    if (!user) {
        return;
    }

    const now = new Date();
    const code = generateSixDigitCode();
    const codeHash = hashPasswordResetCode(user.id, code);

    if (!(await storePasswordResetCode(user.id, codeHash, now))) {
        return;
    }

    try {
        await sendMail(user.email, buildPasswordResetEmail(user.name, code));
    } catch (error) {
        // O código que não chegou ao usuário deixa de valer.
        await prisma.passwordResetToken.updateMany({
            where: {
                user_id: user.id,
                token_hash: codeHash,
            },
            data: {
                token_hash: null,
                expires_at: now,
                attempts: PASSWORD_RESET_MAX_ATTEMPTS,
            },
        });
        logger.error(
            { err: error, userId: user.id },
            "Password reset email delivery failed",
        );
    }
}

export async function verifyPasswordResetCode(
    input: VerifyPasswordResetCodeBody,
): Promise<string> {
    const user = await prisma.user.findUnique({
        where: { email: normalizeEmail(input.email) },
    });

    if (!user) {
        throw invalidCodeError();
    }

    const record = await prisma.passwordResetToken.findUnique({
        where: { user_id: user.id },
    });
    const now = new Date();

    if (
        !record?.token_hash ||
        record.expires_at <= now ||
        record.attempts >= PASSWORD_RESET_MAX_ATTEMPTS
    ) {
        throw invalidCodeError();
    }

    const attempted = await prisma.passwordResetToken.updateMany({
        where: {
            id: record.id,
            token_hash: record.token_hash,
            attempts: { lt: PASSWORD_RESET_MAX_ATTEMPTS },
            expires_at: { gt: now },
        },
        data: { attempts: { increment: 1 } },
    });

    if (attempted.count !== 1) {
        throw invalidCodeError();
    }

    const expectedHash = Buffer.from(
        hashPasswordResetCode(user.id, input.code),
        "hex",
    );
    const receivedHash = Buffer.from(record.token_hash, "hex");
    if (!timingSafeEqual(expectedHash, receivedHash)) {
        throw invalidCodeError();
    }

    const authorizationToken = randomBytes(32).toString("hex");
    const verified = await prisma.passwordResetToken.updateMany({
        where: {
            id: record.id,
            token_hash: record.token_hash,
            attempts: record.attempts + 1,
            expires_at: { gt: now },
        },
        data: {
            token_hash: null,
            authorization_hash: sha256Hex(authorizationToken),
            authorization_expires_at: new Date(
                now.getTime() + PASSWORD_RESET_AUTH_TTL_MS,
            ),
        },
    });

    if (verified.count !== 1) {
        throw invalidCodeError();
    }

    return authorizationToken;
}

export async function resetPassword(input: ResetPasswordBody): Promise<void> {
    const tokenHash = sha256Hex(input.authorizationToken);
    const now = new Date();

    const record = await prisma.passwordResetToken.findUnique({
        where: { authorization_hash: tokenHash },
    });

    if (
        !record ||
        !record.authorization_expires_at ||
        record.authorization_expires_at <= now
    ) {
        throw invalidAuthorizationError();
    }

    const passwordHash = hashPassword(input.newPassword);
    await prisma.$transaction(async (transaction) => {
        const consumed = await transaction.passwordResetToken.updateMany({
            where: {
                id: record.id,
                authorization_hash: tokenHash,
                authorization_expires_at: { gt: now },
            },
            data: {
                authorization_hash: null,
                authorization_expires_at: null,
            },
        });

        if (consumed.count !== 1) {
            throw invalidAuthorizationError();
        }

        await transaction.user.update({
            where: { id: record.user_id },
            data: { password_hash: passwordHash },
        });
        await revokeAllSessions(transaction, record.user_id, now);
    });
}
