import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { AppError } from "../src/shared/errors/app-error.js";

/**
 * Caracterização do tratamento de erros global: todo erro sai no formato
 * `{ error: { code, message, statusCode } }`, e erros inesperados não vazam
 * detalhes internos.
 */
test("error handler maps AppError, validation and unexpected errors", async () => {
    const app = await buildApp({ rateLimit: false });

    // Rotas só deste teste, registradas na raiz (herdam o error handler).
    app.get("/__test/app-error", async () => {
        throw new AppError("Recusado", 409, "TEST_CONFLICT");
    });
    app.get("/__test/app-error-5xx", async () => {
        throw new AppError("Indisponível", 503, "TEST_UNAVAILABLE");
    });
    app.get("/__test/unexpected", async () => {
        throw new Error("detalhe interno que não pode vazar");
    });
    app.post(
        "/__test/validation",
        {
            schema: {
                body: {
                    type: "object",
                    required: ["name"],
                    properties: { name: { type: "string" } },
                },
            },
        },
        async () => ({ ok: true }),
    );

    await app.ready();

    try {
        const conflict = await app.inject({ method: "GET", url: "/__test/app-error" });
        assert.equal(conflict.statusCode, 409);
        assert.deepEqual(conflict.json(), {
            error: { code: "TEST_CONFLICT", message: "Recusado", statusCode: 409 },
        });

        const unavailable = await app.inject({
            method: "GET",
            url: "/__test/app-error-5xx",
        });
        assert.equal(unavailable.statusCode, 503);
        assert.deepEqual(unavailable.json(), {
            error: {
                code: "TEST_UNAVAILABLE",
                message: "Indisponível",
                statusCode: 503,
            },
        });

        const unexpected = await app.inject({ method: "GET", url: "/__test/unexpected" });
        assert.equal(unexpected.statusCode, 500);
        assert.deepEqual(unexpected.json(), {
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Internal server error",
                statusCode: 500,
            },
        });

        const invalid = await app.inject({
            method: "POST",
            url: "/__test/validation",
            payload: {},
        });
        assert.equal(invalid.statusCode, 400);
        assert.deepEqual(invalid.json(), {
            error: {
                code: "VALIDATION_ERROR",
                message: "Validation failed",
                statusCode: 400,
            },
        });
    } finally {
        await app.close();
    }
});
