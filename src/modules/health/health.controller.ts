import type { FastifyInstance } from "fastify";
import { buildDataResponseSchema } from "../../shared/http/api-response.js";
import { isDatabaseUp } from "./health.service.js";

const healthDataSchema = {
    type: "object",
    additionalProperties: false,
    required: ["status", "uptime", "database"],
    properties: {
        status: { type: "string" },
        uptime: { type: "number" },
        database: { type: "string", enum: ["up", "down"] },
    },
} as const;

/** `GET /health`: 200 com o banco no ar, 503 (degradado) sem ele. */
export function registerHealthRoute(app: FastifyInstance) {
    app.get(
        "/health",
        {
            schema: {
                response: {
                    200: buildDataResponseSchema(healthDataSchema),
                    503: buildDataResponseSchema(healthDataSchema),
                },
            },
        },
        async (_, reply) => {
            if (await isDatabaseUp()) {
                return reply.send({
                    data: {
                        status: "ok",
                        uptime: process.uptime(),
                        database: "up",
                    },
                });
            }

            return reply.code(503).send({
                data: {
                    status: "degraded",
                    uptime: process.uptime(),
                    database: "down",
                },
            });
        },
    );
}
