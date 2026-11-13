import type { AuthUser } from "../modules/auth/auth.types.js";
import type { Permission } from "../modules/auth/permissions.js";

declare module "fastify" {
    interface FastifyRequest {
        authUser?: AuthUser;
    }

    interface FastifyContextConfig {
        /** Obrigatório em toda rota registrada dentro de `adminPlugin`. */
        permission?: Permission;
    }
}
