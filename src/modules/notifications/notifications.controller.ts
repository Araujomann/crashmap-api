import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser } from "../auth/auth.guard.js";
import {
    registerPushToken,
    unregisterPushToken,
} from "./notifications.service.js";

interface RegisterPushTokenBody {
    token: string;
    platform: "android" | "ios";
}

interface UnregisterPushTokenBody {
    token: string;
}

const registerPushTokenBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["token", "platform"],
    properties: {
        token: { type: "string", minLength: 1, maxLength: 512 },
        platform: { type: "string", enum: ["android", "ios"] },
    },
} as const;

const unregisterPushTokenBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["token"],
    properties: {
        token: { type: "string", minLength: 1, maxLength: 512 },
    },
} as const;

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
    app.put<{ Body: RegisterPushTokenBody }>(
        "/push-token",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Notifications"],
                summary: "Registrar um dispositivo para notificações push",
                security: [{ bearerAuth: [] }],
                body: registerPushTokenBodySchema,
                response: {
                    200: {
                        type: "object",
                        additionalProperties: false,
                        required: ["data"],
                        properties: {
                            data: {
                                type: "object",
                                additionalProperties: false,
                                required: ["registered"],
                                properties: {
                                    registered: { type: "boolean" },
                                },
                            },
                        },
                    },
                },
            },
        },
        async (request, reply) => {
            await registerPushToken(
                request.authUser!.id,
                request.body.token,
                request.body.platform,
            );

            return reply.code(200).send({ data: { registered: true } });
        },
    );

    app.delete<{ Body: UnregisterPushTokenBody }>(
        "/push-token",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Notifications"],
                summary: "Remover um dispositivo das notificações push",
                security: [{ bearerAuth: [] }],
                body: unregisterPushTokenBodySchema,
                response: {
                    200: {
                        type: "object",
                        additionalProperties: false,
                        required: ["data"],
                        properties: {
                            data: {
                                type: "object",
                                additionalProperties: false,
                                required: ["removed"],
                                properties: {
                                    removed: { type: "boolean" },
                                },
                            },
                        },
                    },
                },
            },
        },
        async (request, reply) => {
            const removed = await unregisterPushToken(
                request.authUser!.id,
                request.body.token,
            );

            return reply.code(200).send({ data: { removed } });
        },
    );
};
