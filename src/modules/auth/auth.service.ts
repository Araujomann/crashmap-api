import {
    createHash,
    createHmac,
    randomBytes,
    scryptSync,
    timingSafeEqual,
} from "node:crypto";
import { env } from "../../shared/config/env.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type {
    AuthResponse,
    AuthTokens,
    AuthUser,
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

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;

export function toAuthUser(user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    created_at: Date;
    updated_at: Date;
}): AuthUser {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at,
    };
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

export async function registerUser(input: RegisterBody): Promise<AuthResponse> {
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

    const tokens = buildTokens(user);
    await storeRefreshToken(user.id, tokens.refreshToken);

    return {
        user: toAuthUser(user),
        tokens,
    };
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
