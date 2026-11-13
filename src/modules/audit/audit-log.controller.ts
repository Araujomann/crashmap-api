import type { FastifyPluginAsync } from "fastify";
import { bearerAuthSecurity as security } from "../../shared/http/api-response.js";
import {
    auditLogListResponseSchema,
    auditLogQuerySchema,
} from "./audit-log.schema.js";
import { listAuditLogs, type AuditLogQuery } from "./audit-log.service.js";

// Registradas dentro de `adminPlugin` com prefixo /audit-logs — permissão audit:read.
export const auditLogRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: AuditLogQuery }>(
        "/",
        {
            config: { permission: "audit:read" },
            schema: {
                tags: ["Admin"],
                summary: "Auditoria administrativa",
                security,
                querystring: auditLogQuerySchema,
                response: { 200: auditLogListResponseSchema },
            },
        },
        async (request, reply) => reply.code(200).send(await listAuditLogs(request.query)),
    );
};
