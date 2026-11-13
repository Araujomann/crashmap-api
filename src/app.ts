import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./shared/config/env.js";
import { rateLimitError } from "./shared/http/rate-limits.js";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { prisma } from "./shared/database/prisma.js";
import { AppError } from "./shared/errors/app-error.js";
import { buildDataResponseSchema } from "./shared/http/api-response.js";
import { accidentsRoutes } from "./modules/accidents/accidents.controller.js";
import { authRoutes } from "./modules/auth/auth.controller.js";
import { notificationsRoutes } from "./modules/notifications/notifications.controller.js";
import { usersRoutes } from "./modules/users/users.controller.js";
import { adminPlugin } from "./modules/admin/admin.plugin.js";
import { moderatorInviteAcceptRoutes } from "./modules/team/team.controller.js";


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

export interface BuildAppOptions {
    /** Padrão: `RATE_LIMIT_ENABLED` do ambiente. */
    rateLimit?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
    // trustProxy: de quem aceitar X-Forwarded-For para obter o IP real do
    // cliente (auditoria e limites). Ver TRUST_PROXY em shared/config/env.ts.
    const app = Fastify({ logger: true, trustProxy: env.TRUST_PROXY });

    if (options.rateLimit ?? env.RATE_LIMIT_ENABLED) {
        // global: false — só as rotas com `config.rateLimit` são limitadas.
        // preHandler: o corpo já foi lido (o limite de login usa o e-mail).
        await app.register(rateLimit, {
            global: false,
            hook: "preHandler",
            errorResponseBuilder: rateLimitError,
        });
    }

    await app.register(fastifySwagger, {
        openapi: {
            openapi: "3.0.0",
            info: {
                title: "CrashMap API",
                description: "Documentação da API do CrashMap",
                version: "1.0.0",
            },
            tags: [
                { name: "Auth", description: "Endpoints de Autenticação" },
                { name: "Users", description: "Endpoints de Usuários" },
                {
                    name: "Notifications",
                    description: "Avisos administrativos e notificações push",
                },
                { name: "Accidents", description: "Endpoints de Acidentes" },
                {
                    name: "Moderation",
                    description: "Histórico e auditoria da moderação (painel)",
                },
                {
                    name: "Team",
                    description: "Convites e gestão da equipe de moderação",
                },
                {
                    name: "Admin",
                    description: "Contas, auditoria e configurações (somente ADMIN)",
                },
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "JWT",
                    },
                },
            },
        },
    });

    await app.register(fastifySwaggerUi, {
        routePrefix: "/docs",
        uiConfig: {
            docExpansion: "list",
            deepLinking: false,
        },
        staticCSP: true,
        transformStaticCSP: (header) => header,
    });
    // Só origens listadas (CORS_ORIGINS). O painel usa o BFF e não precisa.
    await app.register(cors, {
        origin: env.CORS_ORIGINS,
    });

    await app.register(multipart, {
        limits: {
            fileSize: 10 * 1024 * 1024,
        },
    });

    app.setErrorHandler(async (error, request, reply) => {
        // Recusa esperada (4xx: senha errada, sem permissão, limite) não é
        // falha do servidor: fica em "info" para não poluir os alertas.
        if (error instanceof AppError && error.statusCode < 500) {
            request.log.info(
                { code: error.code, statusCode: error.statusCode },
                "request rejected",
            );
        } else {
            request.log.error({ err: error }, "request failed");
        }

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
    app.register(usersRoutes, { prefix: "/users" });
    app.register(adminPlugin, { prefix: "/admin" });
    app.register(moderatorInviteAcceptRoutes, { prefix: "/moderator-invites" });
    app.register(notificationsRoutes, { prefix: "/notifications" });
    app.register(accidentsRoutes, { prefix: "/accidents" });

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
