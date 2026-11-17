import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./shared/config/env.js";
import { rateLimitError } from "./shared/http/rate-limits.js";
import { prisma } from "./shared/database/prisma.js";
import { registerApiDocs } from "./shared/http/api-docs.js";
import { apiErrorHandler } from "./shared/http/error-handler.js";
import { accidentsRoutes } from "./modules/accidents/accidents.controller.js";
import { authRoutes } from "./modules/auth/auth.controller.js";
import { registerHealthRoute } from "./modules/health/health.controller.js";
import { notificationsRoutes } from "./modules/notifications/notifications.controller.js";
import { usersRoutes } from "./modules/users/users.controller.js";
import { adminPlugin } from "./modules/admin/admin.plugin.js";
import { moderatorInviteAcceptRoutes } from "./modules/team/team.controller.js";

export interface BuildAppOptions {
    
    rateLimit?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
    
    
    const app = Fastify({ logger: true, trustProxy: env.TRUST_PROXY });

    if (options.rateLimit ?? env.RATE_LIMIT_ENABLED) {
        
        
        await app.register(rateLimit, {
            global: false,
            hook: "preHandler",
            errorResponseBuilder: rateLimitError,
        });
    }

    await registerApiDocs(app);

    
    await app.register(cors, {
        origin: env.CORS_ORIGINS,
    });

    await app.register(multipart, {
        limits: {
            fileSize: 10 * 1024 * 1024,
        },
    });

    app.setErrorHandler(apiErrorHandler);

    app.register(authRoutes, { prefix: "/auth" });
    app.register(usersRoutes, { prefix: "/users" });
    app.register(adminPlugin, { prefix: "/admin" });
    app.register(moderatorInviteAcceptRoutes, { prefix: "/moderator-invites" });
    app.register(notificationsRoutes, { prefix: "/notifications" });
    app.register(accidentsRoutes, { prefix: "/accidents" });

    registerHealthRoute(app);

    app.addHook("onClose", async () => {
        await prisma.$disconnect();
    });

    return app;
}
