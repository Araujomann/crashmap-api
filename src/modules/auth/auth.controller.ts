import type { FastifyPluginAsync } from "fastify";
import {
    authResponseSchema,
    loginBodySchema,
    logoutResponseSchema,
    meResponseSchema,
    refreshBodySchema,
    registerBodySchema,
    
    simpleMessageResponseSchema,
    verifyEmailBodySchema,
} from "./auth.schema.js";
import {
    loginUser,
    logoutUser,
    refreshSession,
    registerUser,
    verifyEmail,
} from "./auth.service.js";
import { requireAuthenticatedUser } from "./auth.guard.js";
import type {
    LoginBody,
    LogoutBody,
    RefreshBody,
    RegisterBody,
    VerifyEmailBody,
} from "./auth.types.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
    app.post<{ Body: RegisterBody }>(
        "/register",
        {
            schema: {
                body: registerBodySchema,
                response: {
                    201: authResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const result = await registerUser(request.body);

            return reply.code(201).send({ data: result });
        },
    );

    app.post<{ Body: VerifyEmailBody }>(
        "/verify-email",
        {
            schema: {
                body: verifyEmailBodySchema,
                response: {
                    200: simpleMessageResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await verifyEmail(request.body.token);

            return reply.code(200).send({ data: { message: "Email successfully verified!" } });
        },
    );

    app.post<{ Body: LoginBody }>(
        "/login",
        {
            schema: {
                body: loginBodySchema,
                response: {
                    200: authResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const result = await loginUser(request.body);

            return reply.code(200).send({ data: result });
        },
    );

    app.post<{ Body: RefreshBody }>(
        "/refresh",
        {
            schema: {
                body: refreshBodySchema,
                response: {
                    200: authResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const result = await refreshSession(request.body);

            return reply.code(200).send({ data: result });
        },
    );

    app.post<{ Body: LogoutBody }>(
        "/logout",
        {
            schema: {
                body: refreshBodySchema,
                response: {
                    200: logoutResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await logoutUser(request.body);

            return reply.code(200).send({ data: { revoked: true } });
        },
    );

    app.get(
        "/me",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                response: {
                    200: meResponseSchema,
                },
            },
        },
        async (request, reply) => {
            return reply.code(200).send({ data: request.authUser! });
        },
    );
};
