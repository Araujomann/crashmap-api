import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";

test("register rejects duplicate emails", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `duplicate-test-${uniqueSuffix}@example.com`;
    const password = "Test12345!";
    const name = `Duplicate Test User ${uniqueSuffix}`;

    let userId: string | undefined;

    try {
        const firstResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name,
                email,
                password,
            },
        });

        assert.equal(firstResponse.statusCode, 201);
        userId = firstResponse.json().data.user.id as string;

        const duplicateResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Another ${name}`,
                email,
                password,
            },
        });

        assert.equal(duplicateResponse.statusCode, 409);
        assert.equal(
            duplicateResponse.json().error.code,
            "AUTH_EMAIL_ALREADY_IN_USE",
        );
    } finally {
        if (userId) {
            await prisma.refreshToken.deleteMany({
                where: { user_id: userId },
            });
            await prisma.user.deleteMany({ where: { id: userId } });
        }

        await app.close();
    }
});

test("login rejects invalid credentials", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `login-test-${uniqueSuffix}@example.com`;
    const password = "Test12345!";

    let userId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Login Test User ${uniqueSuffix}`,
                email,
                password,
            },
        });

        assert.equal(registerResponse.statusCode, 201);
        userId = registerResponse.json().data.user.id as string;

        const invalidLoginResponse = await app.inject({
            method: "POST",
            url: "/auth/login",
            payload: {
                email,
                password: "wrong-password",
            },
        });

        assert.equal(invalidLoginResponse.statusCode, 401);
        assert.equal(
            invalidLoginResponse.json().error.code,
            "AUTH_INVALID_CREDENTIALS",
        );
    } finally {
        if (userId) {
            await prisma.refreshToken.deleteMany({
                where: { user_id: userId },
            });
            await prisma.user.deleteMany({ where: { id: userId } });
        }

        await app.close();
    }
});

test("protected routes reject missing access tokens", async () => {
    const app = await buildApp();
    await app.ready();

    try {
        const response = await app.inject({
            method: "GET",
            url: "/users/me",
        });

        assert.equal(response.statusCode, 401);
        assert.equal(response.json().error.code, "AUTH_MISSING_ACCESS_TOKEN");
    } finally {
        await app.close();
    }
});

test("users me rejects invalid payloads", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `validation-test-${uniqueSuffix}@example.com`;
    const password = "Test12345!";

    let userId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Validation Test User ${uniqueSuffix}`,
                email,
                password,
            },
        });

        assert.equal(registerResponse.statusCode, 201);
        const accessToken = registerResponse.json().data.tokens
            .accessToken as string;
        userId = registerResponse.json().data.user.id as string;

        const invalidUpdateResponse = await app.inject({
            method: "PATCH",
            url: "/users/me",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
            payload: {
                name: "a",
            },
        });

        assert.equal(invalidUpdateResponse.statusCode, 400);
        assert.equal(
            invalidUpdateResponse.json().error.code,
            "VALIDATION_ERROR",
        );
    } finally {
        if (userId) {
            await prisma.refreshToken.deleteMany({
                where: { user_id: userId },
            });
            await prisma.user.deleteMany({ where: { id: userId } });
        }

        await app.close();
    }
});
