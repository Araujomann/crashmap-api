import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser } from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import {
    accidentIdParamsSchema,
    accidentResponseSchema,
    accidentsListResponseSchema,
    createAccidentBodySchema,
    deletedAccidentResponseSchema,
    updateAccidentBodySchema,
} from "./accidents.schema.js";
import {
    createAccident,
    deleteAccident,
    getAccident,
    listAccidents,
    updateAccident,
} from "./accidents.service.js";
import type {
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
