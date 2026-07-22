import Fastify from "fastify";
import { prisma } from "./shared/database/prisma.js";
import { AppError } from "./shared/errors/app-error.js";
import { buildDataResponseSchema } from "./shared/http/api-response.js";
import { authRoutes } from "./modules/auth/auth.controller.js";

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

export async function buildApp() {
    const app = Fastify({ logger: true });

    app.setErrorHandler(async (error, request, reply) => {
        request.log.error({ err: error }, "request failed");

        if (error instanceof AppError) {
            return reply.code(error.statusCode).send({
                error: {
                    code: error.code,
                    message: error.message,
                    statusCode: error.statusCode,
                },
            });
        }

        if (
            typeof error === "object" &&
            error !== null &&
            "validation" in error
        ) {
            return reply.code(400).send({
                error: {
                    code: "VALIDATION_ERROR",
                    message: "Validation failed",
                    statusCode: 400,
                },
            });
        }

        return reply.code(500).send({
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Internal server error",
                statusCode: 500,
            },
        });
    });

    app.register(authRoutes, { prefix: "/auth" });

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
            try {
                await prisma.$queryRaw`SELECT 1`;

                return reply.send({
                    data: {
                        status: "ok",
                        uptime: process.uptime(),
                        database: "up",
                    },
                });
            } catch {
                return reply.code(503).send({
                    data: {
                        status: "degraded",
                        uptime: process.uptime(),
                        database: "down",
                    },
                });
            }
        },
    );

    app.addHook("onClose", async () => {
        await prisma.$disconnect();
    });

    return app;
}
