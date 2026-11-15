import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser } from "../auth/auth.guard.js";
import { apiErrorSchema } from "../../shared/http/api-response.js";
import {
    deleteMeBodySchema,
    gamificationStatsResponseSchema,
    meResponseSchema,
    myReportsResponseSchema,
    updateMeBodySchema,
} from "./users.schema.js";
import {
    deleteMe,
    getMe,
    getMyGamificationStats,
    getMyReports,
    updateMe,
} from "./users.service.js";
import type {
    AcceptTermsBody,
    DeleteMeBody,
    MyReportsQuery,
    UpdateMeBody,
} from "./users.types.js";
import { RATE_LIMITS } from "../../shared/http/rate-limits.js";
import {
    acceptTermsBodySchema,
    dataExportResponseSchema,
} from "./privacy.schema.js";
import { acceptTerms, exportMyData } from "./privacy.service.js";

export const usersRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: MyReportsQuery }>(
        "/me/reports",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Users"],
                summary: "Listar relatos enviados pelo usuário corrente",
                security: [{ bearerAuth: [] }],
                querystring: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        page: { type: "integer", minimum: 1 },
                        limit: { type: "integer", minimum: 1, maximum: 50 },
                        status: {
                            type: "string",
                            enum: ["PENDING", "APPROVED", "REJECTED"],
                        },
                    },
                },
                response: { 200: myReportsResponseSchema },
            },
        },
        async (request, reply) => {
            const reports = await getMyReports(
                request.authUser!.id,
                request.query,
            );

            return reply.code(200).send(reports);
        },
    );

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

    app.delete<{ Body: DeleteMeBody }>(
        "/me",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Users"],
                summary: "Excluir permanentemente a conta do usuário corrente",
                security: [{ bearerAuth: [] }],
                body: deleteMeBodySchema,
                response: {
                    204: { type: "null" },
                    400: apiErrorSchema,
                    403: apiErrorSchema,
                    404: apiErrorSchema,
                },
            },
        },
        async (request, reply) => {
            await deleteMe(request.authUser!.id, request.body ?? {});

            return reply.code(204).send();
        },
    );

    app.post<{ Body: AcceptTermsBody }>(
        "/me/terms-acceptance",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Users"],
                summary:
                    "Registrar o aceite dos Termos de Uso e da Política de Privacidade",
                security: [{ bearerAuth: [] }],
                body: acceptTermsBodySchema,
                response: {
                    200: meResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const user = await acceptTerms(
                request.authUser!.id,
                request.body.version,
            );

            return reply.code(200).send({ data: user });
        },
    );

    app.get(
        "/me/data-export",
        {
            preHandler: requireAuthenticatedUser,
            config: { rateLimit: RATE_LIMITS.dataExport },
            schema: {
                tags: ["Users"],
                summary: "Exportar os dados pessoais do usuário corrente (LGPD)",
                security: [{ bearerAuth: [] }],
                response: {
                    200: dataExportResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const data = await exportMyData(request.authUser!.id);

            return reply.code(200).send({ data });
        },
    );
};
