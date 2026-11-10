import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser } from "../auth/auth.guard.js";
import {
    gamificationStatsResponseSchema,
    meResponseSchema,
    updateMeBodySchema,
} from "./users.schema.js";
import { getMe, getMyGamificationStats, updateMe } from "./users.service.js";
import type { UpdateMeBody } from "./users.types.js";

export const usersRoutes: FastifyPluginAsync = async (app) => {
    app.get(
        "/me/gamification",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Users"],
                summary: "Obter estatísticas de gamificação do usuário",
                security: [{ bearerAuth: [] }],
                response: {
                    200: gamificationStatsResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const stats = await getMyGamificationStats(
                request.authUser!.id,
            );

            return reply.code(200).send({ data: stats });
        },
    );

    app.get(
        "/me",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ['Users'],
                summary: 'Obter perfil completo do usuário',
                security: [{ bearerAuth: [] }],
                response: {
                    200: meResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const currentUser = await getMe(request.authUser!.id);

            return reply.code(200).send({ data: currentUser });
        },
    );

    app.patch<{ Body: UpdateMeBody }>(
        "/me",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ['Users'],
                summary: 'Atualizar os dados do usuário corrente',
                security: [{ bearerAuth: [] }],
                body: updateMeBodySchema,
                response: {
                    200: meResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const updatedUser = await updateMe(
                request.authUser!.id,
                request.body,
            );

            return reply.code(200).send({ data: updatedUser });
        },
    );
};
