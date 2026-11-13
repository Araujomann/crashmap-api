import type { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";

/** Documento OpenAPI da API e a interface do Swagger em `/docs`. */
export async function registerApiDocs(app: FastifyInstance) {
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
}
