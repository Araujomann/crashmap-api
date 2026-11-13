import type { FastifyPluginAsync } from "fastify";
import { bearerAuthSecurity as security } from "../../shared/http/api-response.js";
import type { AuthUser } from "../auth/auth.types.js";
import { auditContextFrom } from "../audit/audit.service.js";
import {
    settingsListResponseSchema,
    updateSettingsBodySchema,
} from "./settings.schema.js";
import { listSettings, updateSettings } from "./settings.service.js";

// Registradas dentro de `adminPlugin` com prefixo /settings — permissão settings:manage.
export const settingsRoutes: FastifyPluginAsync = async (app) => {
    app.get(
        "/",
        {
            config: { permission: "settings:manage" },
            schema: {
                tags: ["Admin"],
                summary: "Configurações da plataforma",
                security,
                response: { 200: settingsListResponseSchema },
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
                body: updateSettingsBodySchema,
                response: { 200: settingsListResponseSchema },
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
