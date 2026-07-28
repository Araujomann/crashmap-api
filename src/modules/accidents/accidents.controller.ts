import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser } from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import {
    accidentIdParamsSchema,
    accidentCommentsListResponseSchema,
    accidentImagesListResponseSchema,
    accidentResponseSchema,
    accidentsListResponseSchema,
    createAccidentCommentBodySchema,
    createAccidentImageBodySchema,
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
    CreateAccidentCommentBody,
    CreateAccidentImageBody,
    CreateAccidentBody,
    UpdateAccidentBody,
} from "./accidents.types.js";

export const accidentsRoutes: FastifyPluginAsync = async (app) => {
    app.get(
        "/",
        {
            schema: {
                response: {
                    200: accidentsListResponseSchema,
                },
            },
        },
        async (_, reply) => {
            const accidents = await listAccidents();

            return reply.code(200).send({ data: accidents });
        },
    );

    app.get<{ Params: { id: string } }>(
        "/:id",
        {
            schema: {
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
            preHandler: requireAuthenticatedUser,
            schema: {
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
            preHandler: requireAuthenticatedUser,
            schema: {
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

    app.post<{ Params: { id: string }; Body: CreateAccidentImageBody }>(
        "/:id/images",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                params: accidentIdParamsSchema,
                body: createAccidentImageBodySchema,
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
            const image = await createAccidentImage(
                request.authUser as AuthUser,
                request.params.id,
                request.body,
            );

            return reply.code(201).send({ data: image });
        },
    );

    app.delete<{ Params: { id: string; imageId: string } }>(
        "/:id/images/:imageId",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
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
            preHandler: requireAuthenticatedUser,
            schema: {
                body: createAccidentBodySchema,
                response: {
                    201: accidentResponseSchema,
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
            preHandler: requireAuthenticatedUser,
            schema: {
                params: accidentIdParamsSchema,
                body: updateAccidentBodySchema,
                response: {
                    200: accidentResponseSchema,
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
            preHandler: requireAuthenticatedUser,
            schema: {
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
