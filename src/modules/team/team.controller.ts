import type { FastifyPluginAsync } from "fastify";
import { RATE_LIMITS } from "../../shared/http/rate-limits.js";
import {
    requireAuthenticatedUser,
    requireVerifiedEmail,
} from "../auth/auth.guard.js";
import type { AuthUser } from "../auth/auth.types.js";
import { auditContextFrom } from "../audit/audit.service.js";
import {
    acceptInvite,
    createInvite,
    listInvites,
    resendInvite,
    revokeInvite,
} from "./invites.service.js";
import {
    acceptInviteBodySchema,
    acceptInviteResponseSchema,
    createInviteBodySchema,
    inviteDeliveryResponseSchema,
    inviteIdParamsSchema,
    inviteListResponseSchema,
    inviteResponseSchema,
    listInvitesQuerySchema,
    revokeModeratorBodySchema,
    revokeModeratorResponseSchema,
    teamListResponseSchema,
} from "./team.schema.js";
import { listTeam, revokeModerator } from "./team.service.js";
import type {
    AcceptInviteBody,
    CreateInviteBody,
    ListInvitesQuery,
    RevokeModeratorBody,
} from "./team.types.js";

type IdParams = { Params: { id: string } };
const security = [{ bearerAuth: [] }];

// Registradas dentro de `adminPlugin` com prefixo /moderator-invites.
export const moderatorInvitesAdminRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: ListInvitesQuery }>(
        "/",
        {
            config: { permission: "invites:manage" },
            schema: {
                tags: ["Team"],
                summary: "Listar convites de moderador",
                security,
                querystring: listInvitesQuerySchema,
                response: { 200: inviteListResponseSchema },
            },
        },
        async (request, reply) =>
            reply.code(200).send(await listInvites(request.query)),
    );

    app.post<{ Body: CreateInviteBody }>(
        "/",
        {
            config: { permission: "moderators:invite" },
            schema: {
                tags: ["Team"],
                summary: "Convidar um moderador por e-mail",
                security,
                body: createInviteBodySchema,
                response: { 201: inviteDeliveryResponseSchema },
            },
        },
        async (request, reply) => {
            const delivery = await createInvite(
                request.authUser as AuthUser,
                request.body.email,
                auditContextFrom(request),
                request.log,
            );
            return reply.code(201).send({ data: delivery });
        },
    );

    app.post<IdParams>(
        "/:id/resend",
        {
            config: { permission: "invites:manage" },
            schema: {
                tags: ["Team"],
                summary: "Reenviar convite (gera um novo link)",
                security,
                params: inviteIdParamsSchema,
                response: { 201: inviteDeliveryResponseSchema },
            },
        },
        async (request, reply) => {
            const delivery = await resendInvite(
                request.authUser as AuthUser,
                request.params.id,
                auditContextFrom(request),
                request.log,
            );
            return reply.code(201).send({ data: delivery });
        },
    );

    app.post<IdParams>(
        "/:id/revoke",
        {
            config: { permission: "invites:manage" },
            schema: {
                tags: ["Team"],
                summary: "Revogar convite pendente",
                security,
                params: inviteIdParamsSchema,
                response: { 200: inviteResponseSchema },
            },
        },
        async (request, reply) => {
            const invite = await revokeInvite(
                request.authUser as AuthUser,
                request.params.id,
                auditContextFrom(request),
            );
            return reply.code(200).send({ data: invite });
        },
    );
};

// Registradas dentro de `adminPlugin` com prefixo /moderators.
export const moderatorsAdminRoutes: FastifyPluginAsync = async (app) => {
    app.get(
        "/",
        {
            config: { permission: "moderators:revoke" },
            schema: {
                tags: ["Team"],
                summary: "Listar moderadores e administradores",
                security,
                response: { 200: teamListResponseSchema },
            },
        },
        async (_, reply) => reply.code(200).send({ data: await listTeam() }),
    );

    app.post<IdParams & { Body: RevokeModeratorBody }>(
        "/:id/revoke",
        {
            config: { permission: "moderators:revoke" },
            schema: {
                tags: ["Team"],
                summary: "Remover a permissão de moderador",
                security,
                params: inviteIdParamsSchema,
                body: revokeModeratorBodySchema,
                response: { 200: revokeModeratorResponseSchema },
            },
        },
        async (request, reply) => {
            await revokeModerator(
                request.authUser as AuthUser,
                request.params.id,
                request.body.reason,
                auditContextFrom(request),
            );
            return reply.code(200).send({ data: { revoked: true } });
        },
    );
};

// Fora de /admin: quem aceita ainda é `user`. Prefixo /moderator-invites.
export const moderatorInviteAcceptRoutes: FastifyPluginAsync = async (app) => {
    app.post<{ Body: AcceptInviteBody }>(
        "/accept",
        {
            config: { rateLimit: RATE_LIMITS.inviteAccept },
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ["Team"],
                summary: "Aceitar convite de moderador",
                security,
                body: acceptInviteBodySchema,
                response: { 200: acceptInviteResponseSchema },
            },
        },
        async (request, reply) => {
            const user = await acceptInvite(
                request.authUser as AuthUser,
                request.body.token,
                auditContextFrom(request),
            );
            return reply.code(200).send({ data: user });
        },
    );
};
