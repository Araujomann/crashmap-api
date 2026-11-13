import {
    createHash,
    createHmac,
    randomBytes,
    randomInt,
    scryptSync,
    timingSafeEqual,
} from "node:crypto";
import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../../shared/config/env.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { buildPasswordResetEmail } from "./password-reset-email.js";
import { buildVerificationCodeEmail } from "./verification-code-email.js";
import { permissionsFor } from "./permissions.js";
import type {
    AccessTokenPayload,
    AuthResponse,
    AuthTokens,
    AuthUser,
    ResetPasswordBody,
    VerifyPasswordResetCodeBody,
    LoginBody,
    LogoutBody,
    RefreshBody,
    RegisterBody,
    UserRole,
} from "./auth.types.js";

export class AuthError extends AppError {
    constructor(message: string, statusCode: number, code: string) {
        super(message, statusCode, code);
        this.name = "AuthError";
    }
}

type TokenPayload = {
    sub: string;
    email: string;
    role: UserRole;
    type: "access";
};

const userRoles = ["user", "moderator", "admin"] as const;

export function isUserRole(value: string): value is UserRole {
    return userRoles.includes(value as UserRole);
}

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;
const PASSWORD_RESET_CODE_TTL_MS = 5 * 60 * 1000;
const PASSWORD_RESET_AUTH_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_REQUEST_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_MAX_REQUESTS = 3;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const EMAIL_VERIFICATION_CODE_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;

export function hashPasswordResetCode(userId: string, code: string): string {
    return createHmac("sha256", env.REFRESH_TOKEN_SECRET)
        .update(`password-reset-code:${userId}:${code}`)
        .digest("hex");
}

export function hashEmailVerificationCode(userId: string, code: string): string {
    return createHmac("sha256", env.REFRESH_TOKEN_SECRET)
        .update(`email-verification-code:${userId}:${code}`)
        .digest("hex");
}

function generateSixDigitCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function isMailConfigured(): boolean {
    return Boolean(env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

export function createMailTransporter() {
    return nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
        },
    });
}

export function toAuthUser(user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    is_email_verified: boolean;
    email_verified_at: Date | null;
    created_at: Date;
    updated_at: Date;
}): AuthUser {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: permissionsFor(user.role),
        is_email_verified: user.is_email_verified,
        email_verified_at: user.email_verified_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
    };
}

/** Conta suspensa por um administrador não autentica nem renova sessão. */
export function ensureNotSuspended(user: { suspended_at: Date | null }) {
    if (user.suspended_at) {
        throw new AuthError(
            "Esta conta está suspensa. Entre em contato com a equipe do Farol.",
            403,
            "AUTH_ACCOUNT_SUSPENDED",
        );
    }
}

export function hashPassword(password: string): string {
    const salt = randomBytes(PASSWORD_SALT_BYTES).toString("hex");
    const derivedKey = scryptSync(password, salt, PASSWORD_KEY_BYTES).toString(
        "hex",
    );

    return `${salt}:${derivedKey}`;
}

export function verifyPassword(
    password: string,
    passwordHash: string,
): boolean {
    const [salt, storedDerivedKey] = passwordHash.split(":");

    if (!salt || !storedDerivedKey) {
        return false;
    }

    const derivedKeyBuffer = scryptSync(password, salt, PASSWORD_KEY_BYTES);
    const storedBuffer = Buffer.from(storedDerivedKey, "hex");

    if (derivedKeyBuffer.length !== storedBuffer.length) {
        return false;
    }

    return timingSafeEqual(derivedKeyBuffer, storedBuffer);
}

function base64UrlJson(value: object) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeBase64UrlJson<T>(value: string): T {
    const decoded = Buffer.from(value, "base64url").toString("utf8");

    return JSON.parse(decoded) as T;
}

function verifyHmacSignature(
    unsignedToken: string,
    signature: string,
): boolean {
    const expectedSignature = Buffer.from(
        createHmac("sha256", env.ACCESS_TOKEN_SECRET)
            .update(unsignedToken)
            .digest("base64url"),
        "base64url",
    );
    const receivedSignature = Buffer.from(signature, "base64url");

    if (expectedSignature.length !== receivedSignature.length) {
        return false;
    }

    return timingSafeEqual(expectedSignature, receivedSignature);
}

function parseDurationToSeconds(duration: string): number {
    const match = /^([1-9]\d*)([smhd])$/.exec(duration);

    if (!match) {
        throw new AuthError(
            `Invalid duration: ${duration}`,
            500,
            "AUTH_INVALID_DURATION",
        );
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers = {
        s: 1,
        m: 60,
        h: 60 * 60,
        d: 60 * 60 * 24,
    } as const;

    return amount * multipliers[unit as keyof typeof multipliers];
}

export function signAccessToken(payload: TokenPayload): string {
    const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresIn = parseDurationToSeconds(env.ACCESS_TOKEN_EXPIRES_IN);
    const body = base64UrlJson({
        ...payload,
        iat: issuedAt,
        exp: issuedAt + expiresIn,
    });
    const unsignedToken = `${header}.${body}`;
    const signature = createHmac("sha256", env.ACCESS_TOKEN_SECRET)
        .update(unsignedToken)
        .digest("base64url");

    return `${unsignedToken}.${signature}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
    const [headerPart, payloadPart, signaturePart] = token.split(".");

    if (!headerPart || !payloadPart || !signaturePart) {
        throw new AuthError(
            "Invalid access token",
            401,
            "AUTH_INVALID_ACCESS_TOKEN",
        );
    }

    const unsignedToken = `${headerPart}.${payloadPart}`;

    if (!verifyHmacSignature(unsignedToken, signaturePart)) {
        throw new AuthError(
            "Invalid access token",
            401,
            "AUTH_INVALID_ACCESS_TOKEN",
        );
    }

    const header = decodeBase64UrlJson<{ alg?: string; typ?: string }>(
        headerPart,
    );
    const payload = decodeBase64UrlJson<AccessTokenPayload>(payloadPart);

    if (header.alg !== "HS256" || header.typ !== "JWT") {
        throw new AuthError(
            "Invalid access token",
            401,
            "AUTH_INVALID_ACCESS_TOKEN",
        );
    }

    if (
        typeof payload.sub !== "string" ||
        typeof payload.email !== "string" ||
        typeof payload.role !== "string" ||
        !isUserRole(payload.role) ||
        payload.type !== "access" ||
        !Number.isInteger(payload.exp) ||
        payload.exp <= Math.floor(Date.now() / 1000)
    ) {
        throw new AuthError(
            "Invalid or expired access token",
            401,
            "AUTH_INVALID_ACCESS_TOKEN",
        );
    }

    return payload;
}

export function generateRefreshToken() {
    return randomBytes(48).toString("hex");
}

export function hashRefreshToken(refreshToken: string) {
    return createHmac("sha256", env.REFRESH_TOKEN_SECRET)
        .update(refreshToken)
        .digest("hex");
}

function buildTokens(user: {
    id: string;
    email: string;
    role: UserRole;
}): AuthTokens {
    return {
        accessToken: signAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role,
            type: "access",
        }),
        refreshToken: generateRefreshToken(),
    };
}

async function storeRefreshToken(userId: string, refreshToken: string) {
    return prisma.refreshToken.create({
        data: {
            user_id: userId,
            token_hash: hashRefreshToken(refreshToken),
            expires_at: new Date(
                Date.now() +
                    parseDurationToSeconds(env.REFRESH_TOKEN_EXPIRES_IN) * 1000,
            ),
        },
    });
}

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

type VerificationCodeRecipient = {
    id: string;
    name: string;
    email: string;
};

/**
 * Gera um novo código de 6 dígitos (substituindo o anterior) e envia por e-mail.
 * Retorna `false` se o e-mail não pôde ser enviado.
 */
async function issueEmailVerificationCode(
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

    const transporter = createMailTransporter();
    const emailContent = buildVerificationCodeEmail(user.name, code);

    try {
        await transporter.sendMail({
            from: env.SMTP_FROM,
            to: user.email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
        });
        return true;
    } catch (error) {
        logger.error(
            { err: error, userId: user.id },
            "Email verification code delivery failed",
        );
        return false;
    } finally {
        transporter.close();
    }
}

export async function resendEmailVerificationCode(
    userId: string,
    logger: FastifyBaseLogger,
): Promise<{ retryAfterSeconds: number }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
        throw new AuthError(
            "Authenticated user not found",
            401,
            "AUTH_USER_NOT_FOUND",
        );
    }

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

export async function verifyEmailCode(
    userId: string,
    code: string,
): Promise<AuthUser> {
    const invalidCodeError = () =>
        new AuthError(
            "O código é inválido ou expirou.",
            400,
            "AUTH_INVALID_VERIFICATION_CODE",
        );

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
        throw new AuthError(
            "Authenticated user not found",
            401,
            "AUTH_USER_NOT_FOUND",
        );
    }

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

    // Conta a tentativa antes de comparar (evita força bruta concorrente)
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

export async function registerUser(
    input: RegisterBody,
    logger: FastifyBaseLogger,
): Promise<AuthResponse> {
    const normalizedEmail = input.email.trim().toLowerCase();
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

export async function requestPasswordReset(
    email: string,
    logger: FastifyBaseLogger,
): Promise<void> {
    if (!env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM) {
        throw new AuthError(
            "A recuperação de senha está temporariamente indisponível.",
            503,
            "AUTH_PASSWORD_RESET_UNAVAILABLE",
        );
    }

    const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
        return;
    }

    const now = new Date();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const codeHash = hashPasswordResetCode(user.id, code);
    const currentRecord = await prisma.passwordResetToken.findUnique({
        where: { user_id: user.id },
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
            return;
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

        if (updated.count !== 1) {
            return;
        }
    } else {
        try {
            await prisma.passwordResetToken.create({
                data: {
                    user_id: user.id,
                    token_hash: codeHash,
                    expires_at: new Date(
                        now.getTime() + PASSWORD_RESET_CODE_TTL_MS,
                    ),
                    created_at: now,
                    request_count: 1,
                    request_window_started_at: now,
                },
            });
        } catch (error) {
            if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "P2002"
            ) {
                return;
            }

            throw error;
        }
    }

    const transporter = createMailTransporter();
    const emailContent = buildPasswordResetEmail(user.name, code);

    try {
        await transporter.sendMail({
            from: env.SMTP_FROM,
            to: user.email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
        });
    } catch (error) {
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
    } finally {
        transporter.close();
    }
}

export async function verifyPasswordResetCode(
    input: VerifyPasswordResetCodeBody,
): Promise<string> {
    const user = await prisma.user.findUnique({
        where: { email: input.email.trim().toLowerCase() },
    });

    if (!user) {
        throw new AuthError(
            "O código é inválido ou expirou.",
            400,
            "AUTH_INVALID_PASSWORD_RESET_CODE",
        );
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
        throw new AuthError(
            "O código é inválido ou expirou.",
            400,
            "AUTH_INVALID_PASSWORD_RESET_CODE",
        );
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
        throw new AuthError(
            "O código é inválido ou expirou.",
            400,
            "AUTH_INVALID_PASSWORD_RESET_CODE",
        );
    }

    const expectedHash = Buffer.from(
        hashPasswordResetCode(user.id, input.code),
        "hex",
    );
    const receivedHash = Buffer.from(record.token_hash, "hex");
    if (!timingSafeEqual(expectedHash, receivedHash)) {
        throw new AuthError(
            "O código é inválido ou expirou.",
            400,
            "AUTH_INVALID_PASSWORD_RESET_CODE",
        );
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
            authorization_hash: createHash("sha256")
                .update(authorizationToken)
                .digest("hex"),
            authorization_expires_at: new Date(
                now.getTime() + PASSWORD_RESET_AUTH_TTL_MS,
            ),
        },
    });

    if (verified.count !== 1) {
        throw new AuthError(
            "O código é inválido ou expirou.",
            400,
            "AUTH_INVALID_PASSWORD_RESET_CODE",
        );
    }

    return authorizationToken;
}

export async function resetPassword(input: ResetPasswordBody): Promise<void> {
    const tokenHash = createHash("sha256")
        .update(input.authorizationToken)
        .digest("hex");
    const now = new Date();

    const record = await prisma.passwordResetToken.findUnique({
        where: { authorization_hash: tokenHash },
    });

    if (
        !record ||
        !record.authorization_expires_at ||
        record.authorization_expires_at <= now
    ) {
        throw new AuthError(
            "A autorização de redefinição é inválida ou expirou.",
            400,
            "AUTH_INVALID_PASSWORD_RESET_AUTHORIZATION",
        );
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
            throw new AuthError(
                "A autorização de redefinição é inválida ou expirou.",
                400,
                "AUTH_INVALID_PASSWORD_RESET_AUTHORIZATION",
            );
        }

        await transaction.user.update({
            where: { id: record.user_id },
            data: { password_hash: passwordHash },
        });
        await transaction.refreshToken.updateMany({
            where: { user_id: record.user_id, revoked_at: null },
            data: { revoked_at: now },
        });
    });
}

export async function loginUser(input: LoginBody): Promise<AuthResponse> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
    });

    if (!user) {
        throw new AuthError(
            "Invalid credentials",
            401,
            "AUTH_INVALID_CREDENTIALS",
        );
    }

    const passwordHash = ensurePasswordUser(user.password_hash);

    if (!verifyPassword(input.password, passwordHash)) {
        throw new AuthError(
            "Invalid credentials",
            401,
            "AUTH_INVALID_CREDENTIALS",
        );
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

    await prisma.$transaction([
        prisma.refreshToken.update({
            where: { id: tokenRecord.id },
            data: { revoked_at: new Date() },
        }),
        prisma.refreshToken.create({
            data: {
                user_id: tokenRecord.user.id,
                token_hash: hashRefreshToken(tokens.refreshToken),
                expires_at: new Date(
                    Date.now() +
                        parseDurationToSeconds(env.REFRESH_TOKEN_EXPIRES_IN) *
                            1000,
                ),
            },
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
