import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { staff } from "../auth/auth.guard.js";
import { moderationHistoryRoutes } from "../moderation/moderation-history.controller.js";
import {
    auditLogRoutes,
    settingsRoutes,
    usersAdminRoutes,
} from "./admin-panel.controller.js";
import {
    moderatorInvitesAdminRoutes,
    moderatorsAdminRoutes,
} from "../team/team.controller.js";

/**
 * Agrupa as rotas administrativas sob `/admin`, negando por padrão: toda rota
 * registrada aqui dentro precisa declarar `config.permission`, senão a API nem
 * sobe. Os guards de `staff(permission)` são colocados antes de qualquer
 * `preHandler` da própria rota.
 */
export const adminPlugin: FastifyPluginAsync = async (app) => {
    app.addHook("onRoute", (route) => {
        const permission = route.config?.permission;
        if (!permission) {
            throw new Error(
                `Rota administrativa sem permissão declarada: ${route.method} ${route.url}`,
            );
        }

        const ownHandlers: preHandlerHookHandler[] = route.preHandler
            ? ([] as preHandlerHookHandler[]).concat(route.preHandler)
            : [];
        route.preHandler = [...staff(permission), ...ownHandlers];
    });

    await app.register(moderationHistoryRoutes, {
        prefix: "/moderation-history",
    });
    await app.register(moderatorInvitesAdminRoutes, {
        prefix: "/moderator-invites",
    });
    await app.register(moderatorsAdminRoutes, { prefix: "/moderators" });
    await app.register(usersAdminRoutes, { prefix: "/users" });
    await app.register(auditLogRoutes, { prefix: "/audit-logs" });
    await app.register(settingsRoutes, { prefix: "/settings" });
};
