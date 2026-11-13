import type { FastifyInstance } from "fastify";
import {
    requireAuthenticatedUser,
    requireVerifiedEmail,
} from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import { auditContextFrom } from "../audit/audit.service.js";
import {
    accidentCommentParamsSchema,
    accidentCommentResponseSchema,
    accidentCommentsListResponseSchema,
    accidentIdParamsSchema,
    createAccidentCommentBodySchema,
    deletedAccidentResponseSchema,
} from "./accidents.schema.js";
import {
    createAccidentComment,
    deleteAccidentComment,
    listAccidentComments,
} from "./accident-comments.service.js";
import type { CreateAccidentCommentBody } from "./accidents.types.js";

/** Comentários de um relato aprovado. */
export function registerCommentRoutes(app: FastifyInstance) {
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
                    201: accidentCommentResponseSchema,
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
                params: accidentCommentParamsSchema,
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
                auditContextFrom(request),
            );

            return reply.code(200).send({ data: { deleted: true } });
        },
    );
}
