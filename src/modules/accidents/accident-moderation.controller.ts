import type { FastifyInstance } from "fastify";
import { staff } from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import {
    accidentIdParamsSchema,
    accidentModerationListQuerySchema,
    accidentModerationListResponseSchema,
    accidentModerationSummaryResponseSchema,
    editPendingAccidentBodySchema,
    moderateAccidentBodySchema,
    moderationAccidentResponseSchema,
} from "./accidents.schema.js";
import {
    editPendingAccident,
    getAccidentForModeration,
    getAccidentModerationSummary,
    listAccidentsForModeration,
    moderateAccident,
    notifyAccidentApproved,
} from "./accident-moderation.service.js";
import type {
    AccidentListQuery,
    EditPendingAccidentBody,
    ModerateAccidentBody,
} from "./accidents.types.js";


export function registerModerationQueueRoutes(app: FastifyInstance) {
    app.get(
        "/moderation/summary",
        {
            preHandler: staff("stats:read"),
            schema: {
                tags: ["Accidents"],
                summary: "Resumo dos relatos enviados pelo aplicativo",
                security: [{ bearerAuth: [] }],
                response: { 200: accidentModerationSummaryResponseSchema },
            },
        },
        async (_, reply) => {
            const summary = await getAccidentModerationSummary();

            return reply.code(200).send({ data: summary });
        },
    );

    app.get<{
        Querystring: AccidentListQuery;
    }>(
        "/moderation",
        {
            preHandler: staff("reports:read"),
            schema: {
                tags: ["Accidents"],
                summary: "Listar relatos para moderação",
                security: [{ bearerAuth: [] }],
                querystring: accidentModerationListQuerySchema,
                response: { 200: accidentModerationListResponseSchema },
            },
        },
        async (request, reply) => {
            const result = await listAccidentsForModeration(request.query);

            return reply.code(200).send(result);
        },
    );

    app.get<{ Params: { id: string } }>(
        "/moderation/:id",
        {
            preHandler: staff("reports:read"),
            schema: {
                tags: ["Accidents"],
                summary: "Obter detalhes de um relato para moderação",
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                response: { 200: moderationAccidentResponseSchema },
            },
        },
        async (request, reply) => {
            const accident = await getAccidentForModeration(request.params.id);

            return reply.code(200).send({ data: accident });
        },
    );

    app.patch<{
        Params: { id: string };
        Body: EditPendingAccidentBody;
    }>(
        "/moderation/:id",
        {
            preHandler: staff("reports:moderate"),
            schema: {
                tags: ["Accidents"],
                summary: "Editar o texto de um relato pendente",
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                body: editPendingAccidentBodySchema,
                response: { 200: moderationAccidentResponseSchema },
            },
        },
        async (request, reply) => {
            const accident = await editPendingAccident(
                request.params.id,
                request.body,
            );

            return reply.code(200).send({ data: accident });
        },
    );
}


export function registerModerationDecisionRoute(app: FastifyInstance) {
    app.patch<{
        Params: { id: string };
        Body: ModerateAccidentBody;
    }>(
        "/:id/moderation",
        {
            preHandler: staff("reports:moderate"),
            schema: {
                tags: ["Accidents"],
                summary: "Aprovar ou rejeitar um relato",
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                body: moderateAccidentBodySchema,
                response: { 200: moderationAccidentResponseSchema },
            },
        },
        async (request, reply) => {
            const accident = await moderateAccident(
                request.authUser as AuthUser,
                request.params.id,
                request.body,
            );

            if (request.body.status === "APPROVED") {
                await notifyAccidentApproved(accident.id, request.log);
            }

            return reply.code(200).send({ data: accident });
        },
    );
}
