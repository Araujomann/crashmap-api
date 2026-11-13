import type { FastifyPluginAsync } from "fastify";
import {
    bearerAuthSecurity as security,
    uuidIdParamsSchema,
} from "../../shared/http/api-response.js";
import type { AuthUser } from "../auth/auth.types.js";
import { auditContextFrom } from "../audit/audit.service.js";
import {
    adminUserDetailResponseSchema,
    adminUsersListResponseSchema,
    adminUsersQuerySchema,
    revokeUserSessionsResponseSchema,
    suspendUserBodySchema,
} from "./users-admin.schema.js";
import {
    getUserDetail,
    listUsers,
    reactivateUser,
    revokeUserSessions,
    suspendUser,
} from "./users-admin.service.js";
import type { AdminUsersQuery } from "./users.types.js";

type IdParams = { Params: { id: string } };

// Registradas dentro de `adminPlugin` com prefixo /users — permissão users:manage.
export const usersAdminRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: AdminUsersQuery }>(
        "/",
        {
            config: { permission: "users:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Listar contas de usuários",
                security,
                querystring: adminUsersQuerySchema,
                response: { 200: adminUsersListResponseSchema },
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
                params: uuidIdParamsSchema,
                response: { 200: adminUserDetailResponseSchema },
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
                params: uuidIdParamsSchema,
                body: suspendUserBodySchema,
                response: { 200: adminUserDetailResponseSchema },
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
                params: uuidIdParamsSchema,
                response: { 200: adminUserDetailResponseSchema },
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
                params: uuidIdParamsSchema,
                response: { 200: revokeUserSessionsResponseSchema },
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
