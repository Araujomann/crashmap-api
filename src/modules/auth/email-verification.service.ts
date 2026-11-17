import { timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../../shared/config/env.js";
import { prisma } from "../../shared/database/prisma.js";
import {
    generateSixDigitCode,
    hmacSha256Hex,
} from "../../shared/security/crypto.js";
import {
    isMailConfigured,
    sendMail,
} from "../../shared/services/mail/mailer.js";
import { AuthError } from "./auth.errors.js";
import { toAuthUser } from "./auth-user.js";
import type { AuthUser } from "./auth.types.js";
import { buildVerificationCodeEmail } from "./verification-code-email.js";

const EMAIL_VERIFICATION_CODE_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;

export function hashEmailVerificationCode(userId: string, code: string): string {
    return hmacSha256Hex(
        env.REFRESH_TOKEN_SECRET,
        `email-verification-code:${userId}:${code}`,
    );
}

type VerificationCodeRecipient = {
    id: string;
    name: string;
    email: string;
};





export async function issueEmailVerificationCode(
    user: VerificationCodeRecipient,
    logger: FastifyBaseLogger,
): Promise<boolean> {
    const now = new Date();
    const code = generateSixDigitCode();
    const codeHash = hashEmailVerificationCode(user.id, code);
    const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_CODE_TTL_MS);

    await prisma.verificationToken.upsert({
        where: { user_id: user.id },
        create: {
            user_id: user.id,
            token: codeHash,
            expires_at: expiresAt,
            created_at: now,
        },
        update: {
            token: codeHash,
            expires_at: expiresAt,
            created_at: now,
            attempts: 0,
        },
    });

    if (!isMailConfigured()) {
        if (env.NODE_ENV !== "production") {
            logger.warn(
                { userId: user.id, email: user.email, code },
                "SMTP não configurado: código de verificação de e-mail (somente desenvolvimento)",
            );
            return true;
        }

        logger.error(
            { userId: user.id },
            "SMTP não configurado: não foi possível enviar o código de verificação",
        );
        return false;
    }

    try {
        await sendMail(user.email, buildVerificationCodeEmail(user.name, code));
        return true;
    } catch (error) {
        logger.error(
            { err: error, userId: user.id },
            "Email verification code delivery failed",
        );
        return false;
    }
}

async function findAuthenticatedUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
        throw new AuthError(
            "Authenticated user not found",
            401,
            "AUTH_USER_NOT_FOUND",
        );
    }

    return user;
}

export async function resendEmailVerificationCode(
    userId: string,
    logger: FastifyBaseLogger,
): Promise<{ retryAfterSeconds: number }> {
    const user = await findAuthenticatedUser(userId);

    if (user.is_email_verified) {
        throw new AuthError(
            "Seu e-mail já foi verificado.",
            409,
            "AUTH_EMAIL_ALREADY_VERIFIED",
        );
    }

    const currentRecord = await prisma.verificationToken.findUnique({
        where: { user_id: user.id },
    });

    if (currentRecord) {
        const elapsed = Date.now() - currentRecord.created_at.getTime();

        if (elapsed < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) {
            const seconds = Math.ceil(
                (EMAIL_VERIFICATION_RESEND_COOLDOWN_MS - elapsed) / 1000,
            );
            throw new AuthError(
                `Aguarde ${seconds}s para solicitar um novo código.`,
                429,
                "AUTH_VERIFICATION_CODE_COOLDOWN",
            );
        }
    }

    const sent = await issueEmailVerificationCode(user, logger);

    if (!sent) {
        throw new AuthError(
            "Não foi possível enviar o código agora. Tente novamente em instantes.",
            503,
            "AUTH_VERIFICATION_EMAIL_UNAVAILABLE",
        );
    }

    return {
        retryAfterSeconds: EMAIL_VERIFICATION_RESEND_COOLDOWN_MS / 1000,
    };
}

const invalidCodeError = () =>
    new AuthError(
        "O código é inválido ou expirou.",
        400,
        "AUTH_INVALID_VERIFICATION_CODE",
    );

export async function verifyEmailCode(
    userId: string,
    code: string,
): Promise<AuthUser> {
    const user = await findAuthenticatedUser(userId);

    if (user.is_email_verified) {
        return toAuthUser(user);
    }

    const record = await prisma.verificationToken.findUnique({
        where: { user_id: user.id },
    });
    const now = new Date();

    if (!record || record.expires_at <= now) {
        throw invalidCodeError();
    }

    if (record.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
        throw new AuthError(
            "Muitas tentativas incorretas. Solicite um novo código.",
            429,
            "AUTH_VERIFICATION_CODE_TOO_MANY_ATTEMPTS",
        );
    }

    
    const attempted = await prisma.verificationToken.updateMany({
        where: {
            id: record.id,
            token: record.token,
            attempts: { lt: EMAIL_VERIFICATION_MAX_ATTEMPTS },
            expires_at: { gt: now },
        },
        data: { attempts: { increment: 1 } },
    });

    if (attempted.count !== 1) {
        throw invalidCodeError();
    }

    const expectedHash = Buffer.from(
        hashEmailVerificationCode(user.id, code),
        "hex",
    );
    const storedHash = Buffer.from(record.token, "hex");

    if (
        expectedHash.length !== storedHash.length ||
        !timingSafeEqual(expectedHash, storedHash)
    ) {
        throw invalidCodeError();
    }

    const updatedUser = await prisma.$transaction(async (transaction) => {
        const consumed = await transaction.verificationToken.deleteMany({
            where: { id: record.id, token: record.token },
        });

        if (consumed.count !== 1) {
            throw invalidCodeError();
        }

        return transaction.user.update({
            where: { id: user.id },
            data: { is_email_verified: true, email_verified_at: now },
        });
    });

    return toAuthUser(updatedUser);
}
