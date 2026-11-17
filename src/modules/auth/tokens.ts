import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../shared/config/env.js";
import { hmacSha256Hex } from "../../shared/security/crypto.js";
import { AuthError } from "./auth.errors.js";
import { isUserRole } from "./auth-user.js";
import type {
    AccessTokenPayload,
    AuthTokens,
    UserRole,
} from "./auth.types.js";

type TokenPayload = {
    sub: string;
    email: string;
    role: UserRole;
    type: "access";
};

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


export function parseDurationToSeconds(duration: string): number {
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
    return hmacSha256Hex(env.REFRESH_TOKEN_SECRET, refreshToken);
}


export function buildTokens(user: {
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
