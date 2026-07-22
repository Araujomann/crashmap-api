import type { FastifyPluginAsync } from "fastify";
import {
    authResponseSchema,
    loginBodySchema,
    logoutResponseSchema,
    refreshBodySchema,
    registerBodySchema,
} from "./auth.schema.js";
import {
    loginUser,
    logoutUser,
    refreshSession,
    registerUser,
} from "./auth.service.js";
import type {
    LoginBody,
    LogoutBody,
    RefreshBody,
    RegisterBody,
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
};
