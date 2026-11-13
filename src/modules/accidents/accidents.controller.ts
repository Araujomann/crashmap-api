import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
    requireAuthenticatedUser,
    requireVerifiedEmail,
    staff,
} from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { registerCommentRoutes } from "./accident-comments.controller.js";
import { registerImageRoutes } from "./accident-images.controller.js";
import {
    registerModerationDecisionRoute,
    registerModerationQueueRoutes,
} from "./accident-moderation.controller.js";
import { registerTrustRoutes } from "./accident-trust.controller.js";
import {
    accidentCreateResponseSchema,
    accidentIdParamsSchema,
    accidentOverviewResponseSchema,
    accidentResponseSchema,
    accidentsListResponseSchema,
    accidentsMapQuerySchema,
    accidentsMapResponseSchema,
    accidentsMapVersionResponseSchema,
    createAccidentBodySchema,
    deletedAccidentResponseSchema,
    updateAccidentBodySchema,
} from "./accidents.schema.js";
import {
    createAccident,
    deleteAccident,
    getAccident,
    getAccidentOverview,
    getAccidentsMapVersion,
    listAccidents,
    listAccidentsForMap,
    updateAccident,
} from "./accidents.service.js";
import type {
    AccidentListQuery,
    AccidentMapQuery,
    CreateAccidentBody,
    UpdateAccidentBody,
} from "./accidents.types.js";

/**
 * Rotas de `/accidents`. Cada grupo fica no controller do seu assunto; a
 * ordem de registro abaixo é a ordem em que as rotas aparecem na tabela de
 * rotas e na documentação, por isso é mantida.
 */
export const accidentsRoutes: FastifyPluginAsync = async (app) => {
    registerOverviewRoute(app);
    registerModerationQueueRoutes(app);
    registerReadRoutes(app);
    registerTrustRoutes(app);
    registerCommentRoutes(app);
    registerImageRoutes(app);
    registerWriteRoutes(app);
    registerModerationDecisionRoute(app);
};

/** Estatísticas públicas. */
function registerOverviewRoute(app: FastifyInstance) {
    app.get(
        "/overview",
        {
            schema: {
                tags: ["Accidents"],
                summary: "Obter estatísticas públicas dos acidentes aprovados",
                response: { 200: accidentOverviewResponseSchema },
            },
        },
        async (_, reply) => {
            const overview = await getAccidentOverview();

            return reply.code(200).send({ data: overview });
        },
    );
}

/** Listagem (staff), mapa e detalhe público de um relato. */
function registerReadRoutes(app: FastifyInstance) {
    app.get<{
        Querystring: AccidentListQuery;
    }>(
        "/",
        {
            preHandler: staff("reports:read"),
            schema: {
                tags: ['Accidents'],
                summary: 'Listar acidentes com paginação e filtros',
                response: {
                    200: accidentsListResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const accidents = await listAccidents(request.query);

            return reply.code(200).send(accidents);
        },
    );

    app.get<{
        Querystring: AccidentMapQuery;
    }>(
        "/map",
        {
            schema: {
                tags: ['Accidents'],
                summary: 'Listar acidentes para o mapa (sem paginação, payload leve)',
                querystring: accidentsMapQuerySchema,
                response: {
                    200: accidentsMapResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const result = await listAccidentsForMap(request.query);

            return reply.code(200).send(result);
        },
    );

    app.get(
        "/map/version",
        {
            schema: {
                tags: ['Accidents'],
                summary: 'Versão atual dos acidentes do mapa (para cache no cliente)',
                response: {
                    200: accidentsMapVersionResponseSchema,
                },
            },
        },
        async (_request, reply) => {
            const version = await getAccidentsMapVersion();

            return reply.code(200).send({ data: version });
        },
    );

    app.get<{ Params: { id: string } }>(
        "/:id([0-9a-fA-F-]{36})",
        {
            schema: {
                tags: ['Accidents'],
                summary: 'Obter um acidente pelo ID',
                params: accidentIdParamsSchema,
                response: {
                    200: accidentResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const accident = await getAccident(request.params.id);

            return reply.code(200).send({ data: accident });
        },
    );
}

/** Criação, edição e exclusão do relato pelo autor (ou por staff). */
function registerWriteRoutes(app: FastifyInstance) {
    app.post<{ Body: CreateAccidentBody }>(
        "/",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Criar/Reportar um novo acidente',
                security: [{ bearerAuth: [] }],
                body: createAccidentBodySchema,
                response: {
                    201: accidentCreateResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const accident = await createAccident(
                request.authUser as AuthUser,
                request.body,
            );

            return reply.code(201).send({ data: accident });
        },
    );

    app.patch<{ Params: { id: string }; Body: UpdateAccidentBody }>(
        "/:id",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Atualizar informações de um acidente',
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                body: updateAccidentBodySchema,
                response: {
                    200: accidentCreateResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const accident = await updateAccident(
                request.authUser as AuthUser,
                request.params.id,
                request.body,
                auditContextFrom(request),
            );

            return reply.code(200).send({ data: accident });
        },
    );

    app.delete<{ Params: { id: string } }>(
        "/:id",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Deletar um acidente do sistema',
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                response: {
                    200: deletedAccidentResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await deleteAccident(
                request.authUser as AuthUser,
                request.params.id,
                auditContextFrom(request),
            );

            return reply.code(200).send({ data: { deleted: true } });
        },
    );
}
