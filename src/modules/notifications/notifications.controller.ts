import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser, staff } from "../auth/auth.guard.js";
import {
    registerPushToken,
    unregisterPushToken,
} from "./notifications.service.js";
import {
    createAdministrativeNotice,
    listAdministrativeNotices,
    MAX_ADMINISTRATIVE_NOTICE_LENGTH,
} from "./administrative-notices.service.js";

interface RegisterPushTokenBody {
    token: string;
    platform: "android" | "ios";
}

interface UnregisterPushTokenBody {
    token: string;
}

interface AdministrativeNoticeBody {
    message: string;
}

const administrativeNoticeSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "message", "created_at"],
    properties: {
        id: { type: "string" },
        message: { type: "string" },
        created_at: { type: "string", format: "date-time" },
    },
} as const;

const administrativeNoticesResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "array",
            items: administrativeNoticeSchema,
        },
    },
} as const;

const administrativeNoticeResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: administrativeNoticeSchema,
    },
} as const;

const administrativeNoticeBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["message"],
    properties: {
        message: {
            type: "string",
            minLength: 1,
            maxLength: MAX_ADMINISTRATIVE_NOTICE_LENGTH,
        },
    },
} as const;

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
    app.get(
        "/administrative-notices",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Notifications"],
                summary: "Listar avisos administrativos da comunidade",
                security: [{ bearerAuth: [] }],
                response: { 200: administrativeNoticesResponseSchema },
            },
        },
        async (_, reply) => {
            const notices = await listAdministrativeNotices();

            return reply.code(200).send({ data: notices });
        },
    );

    app.post<{ Body: AdministrativeNoticeBody }>(
        "/administrative-notices",
        {
            preHandler: staff("notices:publish"),
            schema: {
                tags: ["Notifications"],
                summary: "Publicar um aviso para a comunidade",
                security: [{ bearerAuth: [] }],
                body: administrativeNoticeBodySchema,
                response: { 201: administrativeNoticeResponseSchema },
            },
        },
        async (request, reply) => {
            const notice = await createAdministrativeNotice(
                request.body.message,
                request.authUser!.id,
            );

            return reply.code(201).send({ data: notice });
        },
    );

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
