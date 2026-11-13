import type { preHandlerHookHandler } from "fastify";
import { prisma } from "../../shared/database/prisma.js";
import {
    AuthError,
    ensureNotSuspended,
    toAuthUser,
    verifyAccessToken,
} from "./auth.service.js";
import { can, type Permission } from "./permissions.js";

function readBearerToken(authorizationHeader: string | undefined): string {
    if (!authorizationHeader) {
        throw new AuthError(
            "Missing access token",
            401,
            "AUTH_MISSING_ACCESS_TOKEN",
        );
    }

    const [scheme, token] = authorizationHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
        throw new AuthError(
            "Invalid access token",
            401,
            "AUTH_INVALID_ACCESS_TOKEN",
        );
    }

    return token;
}

export const requireAuthenticatedUser: preHandlerHookHandler = async (
    request,
) => {
    const accessToken = readBearerToken(request.headers.authorization);
    const payload = verifyAccessToken(accessToken);

    const user = await prisma.user.findUnique({
        where: { id: payload.sub },
    });

    // Conta anonimizada: o access token ainda não expirado deixa de valer.
    if (!user || user.deleted_at) {
        throw new AuthError(
            "Authenticated user not found",
            401,
            "AUTH_USER_NOT_FOUND",
        );
    }

    // Suspensão vale na hora, inclusive para access tokens já emitidos.
    ensureNotSuspended(user);

    request.authUser = toAuthUser(user);
};

export const requireVerifiedEmail: preHandlerHookHandler = async (request) => {
    if (!request.authUser) {
        throw new AuthError(
            "Authenticated user not found",
            401,
            "AUTH_USER_NOT_FOUND",
        );
    }

    if (!request.authUser.is_email_verified) {
        throw new AuthError(
            "Email not verified. Please check your inbox.",
            403,
            "AUTH_EMAIL_NOT_VERIFIED",
        );
    }
};

/**
 * Exige todas as permissões informadas. Usa o papel relido do banco em
 * `requireAuthenticatedUser`, nunca o papel gravado no JWT.
 */
export function requirePermission(
    ...requiredPermissions: Permission[]
): preHandlerHookHandler {
    return async (request) => {
        const user = request.authUser;

        if (!user) {
            throw new AuthError(
                "Authenticated user not found",
                401,
                "AUTH_USER_NOT_FOUND",
            );
        }

        if (!requiredPermissions.every((permission) => can(user, permission))) {
            throw new AuthError(
                "You do not have permission to perform this action",
                403,
                "AUTH_MISSING_PERMISSION",
            );
        }
    };
}

/** Cadeia padrão das rotas do painel administrativo. */
export function staff(
    ...requiredPermissions: Permission[]
): preHandlerHookHandler[] {
    return [
        requireAuthenticatedUser,
        requireVerifiedEmail,
        requirePermission("panel:access", ...requiredPermissions),
    ];
}
