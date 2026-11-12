import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
    requireAuthenticatedUser,
    requireModerator,
    requireVerifiedEmail,
} from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import {
    accidentIdParamsSchema,
    accidentCommentsListResponseSchema,
    accidentImagesListResponseSchema,
    accidentModerationListResponseSchema,
    accidentModerationSummaryResponseSchema,
    accidentCreateResponseSchema,
    accidentOverviewResponseSchema,
    accidentResponseSchema,
    accidentTrustResponseSchema,
    accidentsListResponseSchema,
    accidentsMapResponseSchema,
    createAccidentCommentBodySchema,
    createAccidentBodySchema,
    deletedAccidentResponseSchema,
    accidentCommentSchema,
    accidentImageSchema,
    editPendingAccidentBodySchema,
    moderationAccidentResponseSchema,
    moderateAccidentBodySchema,
    updateAccidentBodySchema,
} from "./accidents.schema.js";
import {
    createAccidentComment,
    addAccidentTrust,
    createAccidentImage,
    createAccident,
    editPendingAccident,
    deleteAccidentComment,
    deleteAccidentImage,
    deleteAccident,
    getAccident,
    getAccidentTrust,
    listAccidentComments,
    listAccidentImages,
    listAccidents,
    getAccidentForModeration,
    getAccidentModerationSummary,
    getAccidentOverview,
    listAccidentsForModeration,
    listAccidentsForMap,
    moderateAccident,
    removeAccidentTrust,
    updateAccident,
} from "./accidents.service.js";
import { sendApprovedAccidentNotification } from "../notifications/notifications.service.js";
import type {
    AccidentListQuery,
    AccidentMapQuery,
    CreateAccidentCommentBody,
    CreateAccidentImageBody,
    CreateAccidentBody,
    EditPendingAccidentBody,
    ModerateAccidentBody,
    UpdateAccidentBody,
} from "./accidents.types.js";

interface AccidentImageUploadRequest {
    params: {
        id: string;
    };
}

async function readAccidentImageUpload(request: FastifyRequest) {
    let fileBuffer: Buffer | undefined;
    let caption: string | null = null;

    for await (const part of request.parts()) {
        if (part.type === "file") {
            fileBuffer = await part.toBuffer();
            continue;
        }

        if (part.type === "field" && part.fieldname === "caption") {
            caption = typeof part.value === "string" ? part.value.trim() : null;
        }
    }

    return { fileBuffer, caption };
}

export const accidentsRoutes: FastifyPluginAsync = async (app) => {
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

    app.get(
        "/moderation/summary",
        {
            preHandler: [
                requireAuthenticatedUser,
                requireVerifiedEmail,
                requireModerator,
            ],
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
            preHandler: [
                requireAuthenticatedUser,
                requireVerifiedEmail,
                requireModerator,
            ],
            schema: {
                tags: ["Accidents"],
                summary: "Listar relatos para moderação",
                security: [{ bearerAuth: [] }],
                querystring: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        page: { type: "integer", minimum: 1 },
                        limit: { type: "integer", minimum: 1, maximum: 50 },
                        search: { type: "string" },
                        status: {
                            type: "string",
                            enum: ["PENDING", "APPROVED", "REJECTED"],
                        },
                        severity: {
                            type: "string",
                            enum: ["low", "medium", "high", "critical"],
                        },
                        sort: { type: "string", enum: ["newest", "oldest"] },
                    },
                },
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
            preHandler: [
                requireAuthenticatedUser,
                requireVerifiedEmail,
                requireModerator,
            ],
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
            preHandler: [
                requireAuthenticatedUser,
                requireVerifiedEmail,
                requireModerator,
            ],
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

    app.get<{
        Querystring: AccidentListQuery;
    }>(
        "/",
        {
            preHandler: [
                requireAuthenticatedUser,
                requireVerifiedEmail,
                requireModerator,
            ],
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
                querystring: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        search: { type: "string" },
                        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        classificacao: { type: "string", enum: ["com_vitima", "sem_vitima"] },
                        condicao_meteorologica: { type: "string", enum: ["ceu_claro", "chuva", "nublado", "garoa"] },
                        source: { type: "string", enum: ["APP", "PRF"] },
                        source_year: { type: "number" },
                        from: { type: "string", format: "date-time" },
                        to: { type: "string", format: "date-time" },
                        minLat: { type: "number", minimum: -90, maximum: 90 },
                        maxLat: { type: "number", minimum: -90, maximum: 90 },
                        minLng: { type: "number", minimum: -180, maximum: 180 },
                        maxLng: { type: "number", minimum: -180, maximum: 180 },
                    },
                },
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

    app.get<{ Params: { id: string } }>(
        "/:id/trust",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Accidents"],
                summary: "Consultar os votos de confiança de um acidente",
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                response: { 200: accidentTrustResponseSchema },
            },
        },
        async (request, reply) => {
            const trust = await getAccidentTrust(
                request.authUser!.id,
                request.params.id,
            );

            return reply.code(200).send({ data: trust });
        },
    );

    app.post<{ Params: { id: string } }>(
        "/:id/trust",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ["Accidents"],
                summary: "Marcar um acidente como confiável",
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                response: { 200: accidentTrustResponseSchema },
            },
        },
        async (request, reply) => {
            const trust = await addAccidentTrust(
                request.authUser!.id,
                request.params.id,
            );

            return reply.code(200).send({ data: trust });
        },
    );

    app.delete<{ Params: { id: string } }>(
        "/:id/trust",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ["Accidents"],
                summary: "Retirar o voto de confiança de um acidente",
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                response: { 200: accidentTrustResponseSchema },
            },
        },
        async (request, reply) => {
            const trust = await removeAccidentTrust(
                request.authUser!.id,
                request.params.id,
            );

            return reply.code(200).send({ data: trust });
        },
    );

    app.get<{ Params: { id: string } }>(
        "/:id/comments",
        {
            schema: {
                tags: ['Accidents'],
                summary: 'Listar comentários de um acidente',
                params: accidentIdParamsSchema,
                response: {
                    200: accidentCommentsListResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const comments = await listAccidentComments(request.params.id);

            return reply.code(200).send({ data: comments });
        },
    );

    app.post<{ Params: { id: string }; Body: CreateAccidentCommentBody }>(
        "/:id/comments",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Adicionar comentário em um acidente',
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                body: createAccidentCommentBodySchema,
                response: {
                    201: {
                        type: "object",
                        additionalProperties: false,
                        required: ["data"],
                        properties: {
                            data: accidentCommentSchema,
                        },
                    },
                },
            },
        },
        async (request, reply) => {
            const comment = await createAccidentComment(
                request.authUser as AuthUser,
                request.params.id,
                request.body,
            );

            return reply.code(201).send({ data: comment });
        },
    );

    app.delete<{ Params: { id: string; commentId: string } }>(
        "/:id/comments/:commentId",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Remover comentário de um acidente',
                security: [{ bearerAuth: [] }],
                params: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "commentId"],
                    properties: {
                        id: { type: "string", format: "uuid" },
                        commentId: { type: "string", format: "uuid" },
                    },
                },
                response: {
                    200: deletedAccidentResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await deleteAccidentComment(
                request.authUser as AuthUser,
                request.params.id,
                request.params.commentId,
            );

            return reply.code(200).send({ data: { deleted: true } });
        },
    );

    app.get<{ Params: { id: string } }>(
        "/:id/images",
        {
            schema: {
                params: accidentIdParamsSchema,
                response: {
                    200: accidentImagesListResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const images = await listAccidentImages(request.params.id);

            return reply.code(200).send({ data: images });
        },
    );

    app.post(
        "/:id/images",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Adicionar imagem a um acidente',
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                response: {
                    201: {
                        type: "object",
                        additionalProperties: false,
                        required: ["data"],
                        properties: {
                            data: accidentImageSchema,
                        },
                    },
                },
            },
        },
        async (request, reply) => {
            const typedRequest =
                request as unknown as AccidentImageUploadRequest;
            const upload = await readAccidentImageUpload(request);

            if (!upload.fileBuffer) {
                return reply.code(400 as 201).send({
                    error: {
                        code: "IMAGE_FILE_REQUIRED",
                        message: "An image file is required",
                        statusCode: 400,
                    },
                });
            }

            const image = await createAccidentImage(
                request.authUser as AuthUser,
                typedRequest.params.id,
                {
                    fileBuffer: upload.fileBuffer,
                    caption: upload.caption,
                } as CreateAccidentImageBody,
            );

            return reply.code(201).send({ data: image });
        },
    );

    app.delete<{ Params: { id: string; imageId: string } }>(
        "/:id/images/:imageId",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Remover imagem de um acidente',
                security: [{ bearerAuth: [] }],
                params: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "imageId"],
                    properties: {
                        id: { type: "string", format: "uuid" },
                        imageId: { type: "string", format: "uuid" },
                    },
                },
                response: {
                    200: deletedAccidentResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await deleteAccidentImage(
                request.authUser as AuthUser,
                request.params.id,
                request.params.imageId,
            );

            return reply.code(200).send({ data: { deleted: true } });
        },
    );

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
            );

            return reply.code(200).send({ data: { deleted: true } });
        },
    );

    app.patch<{
        Params: { id: string };
        Body: ModerateAccidentBody;
    }>(
        "/:id/moderation",
        {
            preHandler: [
                requireAuthenticatedUser,
                requireVerifiedEmail,
                requireModerator,
            ],
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
                try {
                    const delivery = await sendApprovedAccidentNotification(
                        accident.id,
                    );
                    request.log.info(
                        {
                            accidentId: accident.id,
                            recipients: delivery.recipientCount,
                            removedTokens: delivery.removedTokenCount,
                        },
                        "Accident approval notification processed",
                    );
                } catch (error) {
                    request.log.error(
                        { err: error, accidentId: accident.id },
                        "Failed to send accident approval notifications",
                    );
                }
            }

            return reply.code(200).send({ data: accident });
        },
    );
};
