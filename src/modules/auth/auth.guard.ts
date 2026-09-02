import type { preHandlerHookHandler } from "fastify";
import { prisma } from "../../shared/database/prisma.js";
import { AuthError, toAuthUser, verifyAccessToken } from "./auth.service.js";

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

    if (!user) {
        throw new AuthError(
            "Authenticated user not found",
            401,
            "AUTH_USER_NOT_FOUND",
        );
    }

    request.authUser = toAuthUser(user);
};

export const requireVerifiedEmail: preHandlerHookHandler = async (
    request,
) => {
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
