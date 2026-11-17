import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error.js";









export async function apiErrorHandler(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
) {
    
    
    if (error instanceof AppError && error.statusCode < 500) {
        request.log.info(
            { code: error.code, statusCode: error.statusCode },
            "request rejected",
        );
    } else {
        request.log.error({ err: error }, "request failed");
    }

    if (error instanceof AppError) {
        return reply.code(error.statusCode).send({
            error: {
                code: error.code,
                message: error.message,
                statusCode: error.statusCode,
            },
        });
    }

    if (
        typeof error === "object" &&
        error !== null &&
        "validation" in error
    ) {
        return reply.code(400).send({
            error: {
                code: "VALIDATION_ERROR",
                message: "Validation failed",
                statusCode: 400,
            },
        });
    }

    return reply.code(500).send({
        error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Internal server error",
            statusCode: 500,
        },
    });
}
