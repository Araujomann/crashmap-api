import type { FastifyRequest } from "fastify";
import type { RateLimitOptions } from "@fastify/rate-limit";
import { AppError } from "../errors/app-error.js";
import { normalizeEmail } from "../utils/email.js";







function emailFromBody(request: FastifyRequest) {
    const body = request.body as { email?: unknown } | undefined;
    return typeof body?.email === "string" ? normalizeEmail(body.email) : "";
}

export const RATE_LIMITS = {
    
    login: {
        max: 10,
        timeWindow: "15 minutes",
        keyGenerator: (request) => `login:${request.ip}:${emailFromBody(request)}`,
    },
    
    register: {
        max: 20,
        timeWindow: "1 hour",
        keyGenerator: (request) => `register:${request.ip}`,
    },
    
    passwordReset: {
        max: 10,
        timeWindow: "15 minutes",
        keyGenerator: (request) => `password-reset:${request.ip}`,
    },
    
    dataExport: {
        max: 5,
        timeWindow: "1 hour",
        keyGenerator: (request) => `data-export:${request.ip}`,
    },
    
    inviteAccept: {
        max: 10,
        timeWindow: "15 minutes",
        keyGenerator: (request) => `invite-accept:${request.ip}`,
    },
} satisfies Record<string, RateLimitOptions>;


export function rateLimitError(_request: FastifyRequest, context: { ttl: number }) {
    const minutes = Math.max(1, Math.ceil(context.ttl / 60_000));
    return new AppError(
        `Muitas tentativas. Tente novamente em ${minutes} minuto${minutes > 1 ? "s" : ""}.`,
        429,
        "RATE_LIMITED",
    );
}
