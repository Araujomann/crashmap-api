import type { FastifyRequest } from "fastify";
import type { RateLimitOptions } from "@fastify/rate-limit";
import { AppError } from "../errors/app-error.js";

/**
 * Limites por rota sensível. A contagem é por IP do cliente; com
 * `TRUST_PROXY` configurado, é o IP real vindo do painel ou do proxy, não o
 * do servidor intermediário. Os contadores ficam em memória (uma instância
 * da API); com várias instâncias, trocar por um store compartilhado (Redis).
 */
function emailFromBody(request: FastifyRequest) {
    const body = request.body as { email?: unknown } | undefined;
    return typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
}

export const RATE_LIMITS = {
    /** Tentativas de login por IP + e-mail: freia adivinhação de senha. */
    login: {
        max: 10,
        timeWindow: "15 minutes",
        keyGenerator: (request) => `login:${request.ip}:${emailFromBody(request)}`,
    },
    /** Cadastros por IP. */
    register: {
        max: 20,
        timeWindow: "1 hour",
        keyGenerator: (request) => `register:${request.ip}`,
    },
    /** Pedido, conferência e troca de senha esquecida, por IP. */
    passwordReset: {
        max: 10,
        timeWindow: "15 minutes",
        keyGenerator: (request) => `password-reset:${request.ip}`,
    },
    /** Aceite de convite de moderador, por IP. */
    inviteAccept: {
        max: 10,
        timeWindow: "15 minutes",
        keyGenerator: (request) => `invite-accept:${request.ip}`,
    },
} satisfies Record<string, RateLimitOptions>;

/** Resposta no mesmo formato de erro do resto da API (passa pelo error handler). */
export function rateLimitError(_request: FastifyRequest, context: { ttl: number }) {
    const minutes = Math.max(1, Math.ceil(context.ttl / 60_000));
    return new AppError(
        `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? "s" : ""}.`,
        429,
        "RATE_LIMITED",
    );
}
