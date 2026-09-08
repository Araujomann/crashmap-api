import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { requireAuthenticatedUser, requireVerifiedEmail } from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import {
    accidentIdParamsSchema,
    accidentCommentsListResponseSchema,
    accidentImagesListResponseSchema,
    accidentCreateResponseSchema,
    accidentResponseSchema,
    accidentsListResponseSchema,
    createAccidentCommentBodySchema,
    createAccidentBodySchema,
    deletedAccidentResponseSchema,
    accidentCommentSchema,
    accidentImageSchema,
    updateAccidentBodySchema,
} from "./accidents.schema.js";
import {
    createAccidentComment,
    createAccidentImage,
    createAccident,
    deleteAccidentComment,
    deleteAccidentImage,
    deleteAccident,
    getAccident,
    listAccidentComments,
    listAccidentImages,
    listAccidents,
    updateAccident,
} from "./accidents.service.js";
import type {
    AccidentListQuery,
    CreateAccidentCommentBody,
    CreateAccidentImageBody,
    CreateAccidentBody,
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
    app.get<{
        Querystring: AccidentListQuery;
    }>(
        "/",
        {
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

    app.get<{ Params: { id: string } }>(
        "/:id",
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
};
