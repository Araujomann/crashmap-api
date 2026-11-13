import type { FastifyPluginAsync } from "fastify";
import { admin_audit_action } from "../../../generated/prisma/enums.js";
import type { AuthUser } from "../auth/auth.types.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { listAuditLogs, type AuditLogQuery } from "../audit/audit-log.service.js";
import {
    SETTING_DEFINITIONS,
    SETTING_KEYS,
    listSettings,
    updateSettings,
} from "../settings/settings.service.js";
import {
    getUserDetail,
    listUsers,
    reactivateUser,
    revokeUserSessions,
    suspendUser,
    type AdminUsersQuery,
} from "../users/users-admin.service.js";

const security = [{ bearerAuth: [] }];
const uuidParams = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
} as const;
const pagination = {
    type: "object",
    additionalProperties: false,
    required: ["page", "limit", "total", "totalPages"],
    properties: {
        page: { type: "integer" },
        limit: { type: "integer" },
        total: { type: "integer" },
        totalPages: { type: "integer" },
    },
} as const;
const personOrNull = {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["id", "name"],
    properties: { id: { type: "string" }, name: { type: "string" } },
} as const;

const userSummaryProperties = {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    role: { type: "string", enum: ["user", "moderator", "admin"] },
    is_email_verified: { type: "boolean" },
    created_at: { type: "string", format: "date-time" },
    suspended_at: { type: ["string", "null"], format: "date-time" },
    suspended_reason: { type: ["string", "null"] },
    suspended_by: personOrNull,
} as const;
const userSummarySchema = {
    type: "object",
    additionalProperties: false,
    required: Object.keys(userSummaryProperties),
    properties: userSummaryProperties,
} as const;
const userDetailProperties = {
    ...userSummaryProperties,
    reports_count: { type: "integer" },
    comments_count: { type: "integer" },
    decisions_count: { type: "integer" },
    active_sessions: { type: "integer" },
} as const;
const userDetailResponse = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: Object.keys(userDetailProperties),
            properties: userDetailProperties,
        },
    },
} as const;

type IdParams = { Params: { id: string } };

// /admin/users — permissão users:manage
export const usersAdminRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: AdminUsersQuery }>(
        "/",
        {
            config: { permission: "users:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Listar contas de usuários",
                security,
                querystring: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        search: { type: "string", maxLength: 120 },
                        role: { type: "string", enum: ["user", "moderator", "admin"] },
                        status: { type: "string", enum: ["active", "suspended"] },
                        page: { type: "integer", minimum: 1 },
                        limit: { type: "integer", minimum: 1, maximum: 50 },
                    },
                },
                response: {
                    200: {
                        type: "object",
                        additionalProperties: false,
                        required: ["data", "pagination"],
                        properties: {
                            data: { type: "array", items: userSummarySchema },
                            pagination,
                        },
                    },
                },
            },
        },
        async (request, reply) => reply.code(200).send(await listUsers(request.query)),
    );

    app.get<IdParams>(
        "/:id",
        {
            config: { permission: "users:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Detalhes de uma conta",
                security,
                params: uuidParams,
                response: { 200: userDetailResponse },
            },
        },
        async (request, reply) =>
            reply.code(200).send({ data: await getUserDetail(request.params.id) }),
    );

    app.post<IdParams & { Body: { reason: string } }>(
        "/:id/suspend",
        {
            config: { permission: "users:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Suspender conta (encerra as sessões)",
                security,
                params: uuidParams,
                body: {
                    type: "object",
                    additionalProperties: false,
                    required: ["reason"],
                    properties: { reason: { type: "string", minLength: 1, maxLength: 500 } },
                },
                response: { 200: userDetailResponse },
            },
        },
        async (request, reply) => {
            const user = await suspendUser(
                request.authUser as AuthUser,
                request.params.id,
                request.body.reason,
                auditContextFrom(request),
            );
            return reply.code(200).send({ data: user });
        },
    );

    app.post<IdParams>(
        "/:id/reactivate",
        {
            config: { permission: "users:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Reativar conta suspensa",
                security,
                params: uuidParams,
                response: { 200: userDetailResponse },
            },
        },
        async (request, reply) => {
            const user = await reactivateUser(
                request.authUser as AuthUser,
                request.params.id,
                auditContextFrom(request),
            );
            return reply.code(200).send({ data: user });
        },
    );

    app.post<IdParams>(
        "/:id/sessions/revoke",
        {
            config: { permission: "users:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Encerrar todas as sessões da conta",
                security,
                params: uuidParams,
                response: {
                    200: {
                        type: "object",
                        additionalProperties: false,
                        required: ["data"],
                        properties: {
                            data: {
                                type: "object",
                                additionalProperties: false,
                                required: ["revoked_sessions"],
                                properties: { revoked_sessions: { type: "integer" } },
                            },
                        },
                    },
                },
            },
        },
        async (request, reply) => {
            const result = await revokeUserSessions(
                request.authUser as AuthUser,
                request.params.id,
                auditContextFrom(request),
            );
            return reply.code(200).send({ data: result });
        },
    );
};

// /admin/audit-logs — permissão audit:read
export const auditLogRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: AuditLogQuery }>(
        "/",
        {
            config: { permission: "audit:read" },
            schema: {
                tags: ["Admin"],
                summary: "Auditoria administrativa",
                security,
                querystring: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        actorId: { type: "string", format: "uuid" },
                        action: { type: "string", enum: Object.values(admin_audit_action) },
                        targetType: {
                            type: "string",
                            enum: ["invite", "user", "accident", "comment", "image", "settings"],
                        },
                        targetId: { type: "string", maxLength: 100 },
                        from: { type: "string", format: "date" },
                        to: { type: "string", format: "date" },
                        page: { type: "integer", minimum: 1 },
                        limit: { type: "integer", minimum: 1, maximum: 50 },
                    },
                },
                response: {
                    200: {
                        type: "object",
                        additionalProperties: false,
                        required: ["data", "pagination"],
                        properties: {
                            data: {
                                type: "array",
                                items: {
                                    type: "object",
                                    additionalProperties: false,
                                    required: [
                                        "id",
                                        "action",
                                        "target_type",
                                        "target_id",
                                        "metadata",
                                        "ip",
                                        "user_agent",
                                        "created_at",
                                        "actor",
                                    ],
                                    properties: {
                                        id: { type: "string" },
                                        action: { type: "string" },
                                        target_type: { type: "string" },
                                        target_id: { type: ["string", "null"] },
                                        metadata: { type: "object", additionalProperties: true },
                                        ip: { type: ["string", "null"] },
                                        user_agent: { type: ["string", "null"] },
                                        created_at: { type: "string", format: "date-time" },
                                        actor: {
                                            type: ["object", "null"],
                                            additionalProperties: false,
                                            required: ["id", "name", "email", "is_deleted"],
                                            properties: {
                                                id: { type: "string" },
                                                name: { type: "string" },
                                                email: { type: "string" },
                                                is_deleted: { type: "boolean" },
                                            },
                                        },
                                    },
                                },
                            },
                            pagination,
                        },
                    },
                },
            },
        },
        async (request, reply) => reply.code(200).send(await listAuditLogs(request.query)),
    );
};

const settingsListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "key",
                    "value",
                    "default",
                    "min",
                    "max",
                    "description",
                    "updated_at",
                    "updated_by",
                ],
                properties: {
                    key: { type: "string" },
                    value: { type: "integer" },
                    default: { type: "integer" },
                    min: { type: "integer" },
                    max: { type: "integer" },
                    description: { type: "string" },
                    updated_at: { type: ["string", "null"], format: "date-time" },
                    updated_by: personOrNull,
                },
            },
        },
    },
} as const;

// /admin/settings — permissão settings:manage
export const settingsRoutes: FastifyPluginAsync = async (app) => {
    app.get(
        "/",
        {
            config: { permission: "settings:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Configurações da plataforma",
                security,
                response: { 200: settingsListResponse },
            },
        },
        async (_, reply) => reply.code(200).send({ data: await listSettings() }),
    );

    app.patch<{ Body: Record<string, number> }>(
        "/",
        {
            config: { permission: "settings:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Alterar configurações da plataforma",
                security,
                body: {
                    type: "object",
                    additionalProperties: false,
                    minProperties: 1,
                    properties: Object.fromEntries(
                        SETTING_KEYS.map((key) => [
                            key,
                            {
                                type: "integer",
                                minimum: SETTING_DEFINITIONS[key].min,
                                maximum: SETTING_DEFINITIONS[key].max,
                            },
                        ]),
                    ),
                },
                response: { 200: settingsListResponse },
            },
        },
        async (request, reply) => {
            const settings = await updateSettings(
                request.authUser as AuthUser,
                request.body,
                auditContextFrom(request),
            );
            return reply.code(200).send({ data: settings });
        },
    );
};
