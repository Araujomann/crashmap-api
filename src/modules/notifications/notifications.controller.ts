import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser, staff } from "../auth/auth.guard.js";
import {
    registerPushToken,
    unregisterPushToken,
} from "./notifications.service.js";
import {
    createAdministrativeNotice,
    listAdministrativeNotices,
} from "./administrative-notices.service.js";
import {
    administrativeNoticeBodySchema,
    administrativeNoticeResponseSchema,
    administrativeNoticesResponseSchema,
    registerPushTokenBodySchema,
    registerPushTokenResponseSchema,
    unregisterPushTokenBodySchema,
    unregisterPushTokenResponseSchema,
} from "./notifications.schema.js";
import type {
    AdministrativeNoticeBody,
    RegisterPushTokenBody,
    UnregisterPushTokenBody,
} from "./notifications.types.js";

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
                response: { 200: registerPushTokenResponseSchema },
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
                response: { 200: unregisterPushTokenResponseSchema },
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
