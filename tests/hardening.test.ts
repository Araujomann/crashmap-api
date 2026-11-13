import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { env } from "../src/shared/config/env.js";

// Nenhum destes testes cria dados: logins de e-mails inexistentes só leem o banco.
const TRUSTED = "127.0.0.1"; // o painel local (TRUST_PROXY padrão em dev)
const UNTRUSTED = "198.51.100.9";

function attempt(
    app: Awaited<ReturnType<typeof buildApp>>,
    email: string,
    remoteAddress: string,
    forwardedFor?: string,
) {
    return app.inject({
        method: "POST",
        url: "/auth/login",
        remoteAddress,
        headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
        payload: { email, password: "senha-errada-123" },
    });
}

test("login is rate limited per client IP and email", async () => {
    const app = await buildApp({ rateLimit: true });
    await app.ready();
    const email = `limit-${Date.now()}@example.com`;

    try {
        for (let index = 0; index < 10; index += 1) {
            const response = await attempt(app, email, TRUSTED, "203.0.113.10");
            assert.equal(response.statusCode, 401, `tentativa ${index + 1}`);
        }

        const blocked = await attempt(app, email, TRUSTED, "203.0.113.10");
        assert.equal(blocked.statusCode, 429);
        assert.equal(blocked.json().error.code, "RATE_LIMITED");
        assert.match(blocked.json().error.message, /Tente novamente em \d+ minuto/);
        assert.ok(Number(blocked.headers["retry-after"]) > 0, "envia Retry-After");

        // Outro e-mail, mesmo IP: contador separado.
        const otherEmail = await attempt(app, `other-${email}`, TRUSTED, "203.0.113.10");
        assert.equal(otherEmail.statusCode, 401);

        // Mesmo e-mail, outro cliente atrás do painel: contador separado.
        // Prova que o IP vem do X-Forwarded-For quando a origem é confiável.
        const otherClient = await attempt(app, email, TRUSTED, "203.0.113.20");
        assert.equal(otherClient.statusCode, 401);
    } finally {
        await app.close();
    }
});

test("the panel's IPv4-mapped loopback address is trusted too", async () => {
    // Localmente o painel chega à API como ::ffff:127.0.0.1.
    const app = await buildApp({ rateLimit: true });
    await app.ready();
    const email = `mapped-${Date.now()}@example.com`;

    try {
        for (let index = 0; index < 10; index += 1) {
            await attempt(app, email, "::ffff:127.0.0.1", "203.0.113.30");
        }
        const blocked = await attempt(app, email, "::ffff:127.0.0.1", "203.0.113.30");
        assert.equal(blocked.statusCode, 429);
        const otherClient = await attempt(app, email, "::ffff:127.0.0.1", "203.0.113.31");
        assert.equal(otherClient.statusCode, 401, "outro IP encaminhado, outro contador");
    } finally {
        await app.close();
    }
});

test("X-Forwarded-For from an untrusted address is ignored", async () => {
    const app = await buildApp({ rateLimit: true });
    await app.ready();
    const email = `spoof-${Date.now()}@example.com`;

    try {
        // Trocar o cabeçalho a cada tentativa não escapa do limite: vale o
        // endereço real da conexão.
        for (let index = 0; index < 10; index += 1) {
            const response = await attempt(app, email, UNTRUSTED, `203.0.113.${100 + index}`);
            assert.equal(response.statusCode, 401, `tentativa ${index + 1}`);
        }
        const blocked = await attempt(app, email, UNTRUSTED, "203.0.113.250");
        assert.equal(blocked.statusCode, 429);
    } finally {
        await app.close();
    }
});

test("CORS answers only the configured origins", async () => {
    const app = await buildApp();
    await app.ready();

    try {
        const [allowedOrigin] = env.CORS_ORIGINS;
        assert.ok(allowedOrigin, "há uma origem configurada para o teste");

        const allowed = await app.inject({
            method: "OPTIONS",
            url: "/health",
            headers: {
                origin: allowedOrigin,
                "access-control-request-method": "GET",
            },
        });
        assert.equal(allowed.headers["access-control-allow-origin"], allowedOrigin);

        const denied = await app.inject({
            method: "OPTIONS",
            url: "/health",
            headers: {
                origin: "https://site-qualquer.example",
                "access-control-request-method": "GET",
            },
        });
        assert.equal(denied.headers["access-control-allow-origin"], undefined);
    } finally {
        await app.close();
    }
});
