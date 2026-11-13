import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../shared/database/prisma.js";
import { normalizeEmail } from "../../shared/utils/email.js";
import { AuthError } from "./auth.errors.js";
import { ensureNotSuspended, toAuthUser } from "./auth-user.js";
import { issueEmailVerificationCode } from "./email-verification.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { refreshTokenData, storeRefreshToken } from "./sessions.js";
import { buildTokens, hashRefreshToken } from "./tokens.js";
import type {
    AuthResponse,
    LoginBody,
    LogoutBody,
    RefreshBody,
    RegisterBody,
} from "./auth.types.js";

// Mantido aqui por compatibilidade: os testes importam deste módulo.
export { hashPasswordResetCode } from "./password-reset.service.js";

function ensurePasswordUser(passwordHash: string | null): string {
    if (!passwordHash) {
        throw new AuthError(
            "User does not have a password set",
            400,
            "AUTH_PASSWORD_NOT_SET",
        );
    }

    return passwordHash;
}

const invalidCredentialsError = () =>
    new AuthError("Invalid credentials", 401, "AUTH_INVALID_CREDENTIALS");

export async function registerUser(
    input: RegisterBody,
    logger: FastifyBaseLogger,
): Promise<AuthResponse> {
    const normalizedEmail = normalizeEmail(input.email);
    const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
    });

    if (existingUser) {
        throw new AuthError(
            "Email already in use",
            409,
            "AUTH_EMAIL_ALREADY_IN_USE",
        );
    }

    const user = await prisma.user.create({
        data: {
            name: input.name.trim(),
            email: normalizedEmail,
            password_hash: hashPassword(input.password),
        },
    });

    // Uma falha no envio não impede o cadastro: o usuário pode pedir reenvio.
    await issueEmailVerificationCode(user, logger);

    const tokens = buildTokens(user);
    await storeRefreshToken(user.id, tokens.refreshToken);

    return {
        user: toAuthUser(user),
        tokens,
    };
}

export async function loginUser(input: LoginBody): Promise<AuthResponse> {
    const user = await prisma.user.findUnique({
        where: { email: normalizeEmail(input.email) },
    });

    if (!user) {
        throw invalidCredentialsError();
    }

    const passwordHash = ensurePasswordUser(user.password_hash);

    if (!verifyPassword(input.password, passwordHash)) {
        throw invalidCredentialsError();
    }

    // Só depois da senha: não revela a suspensão para quem não é o dono.
    ensureNotSuspended(user);

    const tokens = buildTokens(user);
    await storeRefreshToken(user.id, tokens.refreshToken);

    return {
        user: toAuthUser(user),
        tokens,
    };
}

export async function refreshSession(
    input: RefreshBody,
): Promise<AuthResponse> {
    const refreshTokenHash = hashRefreshToken(input.refreshToken);

    const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token_hash: refreshTokenHash },
        include: { user: true },
    });

    if (
        !tokenRecord ||
        tokenRecord.revoked_at ||
        tokenRecord.expires_at <= new Date()
    ) {
        throw new AuthError(
            "Invalid refresh token",
            401,
            "AUTH_INVALID_REFRESH_TOKEN",
        );
    }

    ensureNotSuspended(tokenRecord.user);

    const tokens = buildTokens(tokenRecord.user);

    // Rotação: o token usado é revogado junto com a criação do novo.
    await prisma.$transaction([
        prisma.refreshToken.update({
            where: { id: tokenRecord.id },
            data: { revoked_at: new Date() },
        }),
        prisma.refreshToken.create({
            data: refreshTokenData(tokenRecord.user.id, tokens.refreshToken),
        }),
    ]);

    return {
        user: toAuthUser(tokenRecord.user),
        tokens,
    };
}

export async function logoutUser(input: LogoutBody): Promise<void> {
    const refreshTokenHash = hashRefreshToken(input.refreshToken);

    await prisma.refreshToken.updateMany({
        where: {
            token_hash: refreshTokenHash,
            revoked_at: null,
        },
        data: {
            revoked_at: new Date(),
        },
    });
}
