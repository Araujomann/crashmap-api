import type { FastifyInstance } from "fastify";
import {
    requireAuthenticatedUser,
    requireVerifiedEmail,
} from "../auth/auth.guard.js";
import {
    accidentIdParamsSchema,
    accidentTrustResponseSchema,
} from "./accidents.schema.js";
import {
    addAccidentTrust,
    getAccidentTrust,
    removeAccidentTrust,
} from "./accident-trust.service.js";

/** Votos de confiança da comunidade em um relato aprovado. */
export function registerTrustRoutes(app: FastifyInstance) {
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
}
