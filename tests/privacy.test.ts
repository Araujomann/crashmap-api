import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";

const TERMS_VERSION = "2026-11-15";

test("POST /auth/register requires and records the accepted terms version", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `terms-${uniqueSuffix}@example.com`;
    let userId: string | undefined;

    try {
        const withoutTerms = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { name: "Sem Aceite", email, password: "Test12345!" },
        });
        assert.equal(withoutTerms.statusCode, 400);

        const invalidVersion = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: "Versão Inválida",
                email,
                password: "Test12345!",
                acceptedTermsVersion: "v1",
            },
        });
        assert.equal(invalidVersion.statusCode, 400);

        const response = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: "Com Aceite",
                email,
                password: "Test12345!",
                acceptedTermsVersion: TERMS_VERSION,
            },
        });
        assert.equal(response.statusCode, 201, response.body);

        const user = response.json().data.user;
        userId = user.id;
        assert.equal(user.terms_version, TERMS_VERSION);
        assert.ok(user.terms_accepted_at);
    } finally {
        if (userId) await prisma.user.deleteMany({ where: { id: userId } });
        await app.close();
    }
});

test("POST /users/me/terms-acceptance records a new acceptance", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    let userId: string | undefined;

    try {
        const register = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: "Reaceite",
                email: `reaccept-${uniqueSuffix}@example.com`,
                password: "Test12345!",
                acceptedTermsVersion: TERMS_VERSION,
            },
        });
        assert.equal(register.statusCode, 201, register.body);
        userId = register.json().data.user.id;
        const headers = {
            authorization: `Bearer ${register.json().data.tokens.accessToken}`,
        };

        // Conta anterior ao registro do aceite.
        await prisma.user.update({
            where: { id: userId },
            data: { terms_version: null, terms_accepted_at: null },
        });
        const before = await app.inject({ method: "GET", url: "/users/me", headers });
        assert.equal(before.json().data.terms_version, null);

        const invalid = await app.inject({
            method: "POST",
            url: "/users/me/terms-acceptance",
            headers,
            payload: { version: "ontem" },
        });
        assert.equal(invalid.statusCode, 400);

        const accepted = await app.inject({
            method: "POST",
            url: "/users/me/terms-acceptance",
            headers,
            payload: { version: "2026-12-01" },
        });
        assert.equal(accepted.statusCode, 200, accepted.body);
        assert.equal(accepted.json().data.terms_version, "2026-12-01");
        assert.ok(accepted.json().data.terms_accepted_at);

        const unauthenticated = await app.inject({
            method: "POST",
            url: "/users/me/terms-acceptance",
            payload: { version: TERMS_VERSION },
        });
        assert.equal(unauthenticated.statusCode, 401);
    } finally {
        if (userId) await prisma.user.deleteMany({ where: { id: userId } });
        await app.close();
    }
});

test("GET /users/me/data-export returns only the caller's data, without secrets", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const userIds: string[] = [];

    try {
        const register = async (label: string) => {
            const response = await app.inject({
                method: "POST",
                url: "/auth/register",
                payload: {
                    name: `Export ${label}`,
                    email: `export-${label}-${uniqueSuffix}@example.com`,
                    password: "Test12345!",
                    acceptedTermsVersion: TERMS_VERSION,
                },
            });
            assert.equal(response.statusCode, 201, response.body);
            const { user, tokens } = response.json().data;
            userIds.push(user.id);
            return { id: user.id as string, token: tokens.accessToken as string };
        };

        const owner = await register("owner");
        const other = await register("other");

        await prisma.accident.create({
            data: {
                tipo_acidente: "Colisão traseira",
                latitude: -5.52,
                longitude: -47.47,
                occurred_at: new Date(),
                severity: "low",
                created_by_id: owner.id,
            },
        });
        await prisma.accident.create({
            data: {
                tipo_acidente: "Outro usuário",
                latitude: -5.53,
                longitude: -47.48,
                occurred_at: new Date(),
                severity: "low",
                created_by_id: other.id,
            },
        });
        await prisma.pushToken.create({
            data: {
                user_id: owner.id,
                token: `ExponentPushToken[export-${uniqueSuffix}]`,
                platform: "android",
            },
        });

        const response = await app.inject({
            method: "GET",
            url: "/users/me/data-export",
            headers: { authorization: `Bearer ${owner.token}` },
        });
        assert.equal(response.statusCode, 200, response.body);

        const data = response.json().data;
        assert.equal(data.account.id, owner.id);
        assert.equal(data.account.terms_version, TERMS_VERSION);
        assert.equal(data.reports.length, 1);
        assert.equal(data.reports[0].tipo_acidente, "Colisão traseira");
        assert.deepEqual(
            data.devices.map((device: { platform: string }) => device.platform),
            ["android"],
        );
        assert.equal(data.active_sessions, 1);

        const raw = response.body;
        assert.ok(!raw.includes("password_hash"));
        assert.ok(!raw.includes("ExponentPushToken"));
        assert.ok(!raw.includes("Outro usuário"));
    } finally {
        await prisma.accident.deleteMany({
            where: { created_by_id: { in: userIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await app.close();
    }
});
