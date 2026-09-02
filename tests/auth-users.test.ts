import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";

test("auth flow supports register, login, refresh, and logout", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `auth-test-${uniqueSuffix}@example.com`;
    const password = "Test12345!";
    const name = `Auth Test User ${uniqueSuffix}`;

    let userId: string | undefined;
    let refreshTokenToRevoke: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name,
                email,
                password,
            },
        });

        assert.equal(registerResponse.statusCode, 201);
        const registerBody = registerResponse.json();
        assert.equal(registerBody.data.user.email, email);
        userId = registerBody.data.user.id as string;

        await prisma.user.update({ where: { id: userId }, data: { is_email_verified: true } });
        const loginResponse = await app.inject({
            method: "POST",
            url: "/auth/login",
            payload: {
                email,
                password,
            },
        });

        assert.equal(loginResponse.statusCode, 200);
        const loginBody = loginResponse.json();
        assert.equal(loginBody.data.user.id, userId);

        const refreshResponse = await app.inject({
            method: "POST",
            url: "/auth/refresh",
            payload: {
                refreshToken: loginBody.data.tokens.refreshToken,
            },
        });

        assert.equal(refreshResponse.statusCode, 200);
        const refreshBody = refreshResponse.json();
        refreshTokenToRevoke = refreshBody.data.tokens.refreshToken as string;
        assert.equal(refreshBody.data.user.id, userId);

        const logoutResponse = await app.inject({
            method: "POST",
            url: "/auth/logout",
            payload: {
                refreshToken: refreshTokenToRevoke,
            },
        });

        assert.equal(logoutResponse.statusCode, 200);
        assert.equal(logoutResponse.json().data.revoked, true);

        const revokedRefreshResponse = await app.inject({
            method: "POST",
            url: "/auth/refresh",
            payload: {
                refreshToken: refreshTokenToRevoke,
            },
        });

        assert.equal(revokedRefreshResponse.statusCode, 401);
        assert.equal(
            revokedRefreshResponse.json().error.code,
            "AUTH_INVALID_REFRESH_TOKEN",
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

test("users me flow returns and updates the current profile", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `users-test-${uniqueSuffix}@example.com`;
    const password = "Test12345!";
    const name = `Users Test User ${uniqueSuffix}`;

    let userId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name,
                email,
                password,
            },
        });

        assert.equal(registerResponse.statusCode, 201);
        const registerBody = registerResponse.json();
        const accessToken = registerBody.data.tokens.accessToken as string;
        userId = registerBody.data.user.id as string;

        const meResponse = await app.inject({
            method: "GET",
            url: "/users/me",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });

        assert.equal(meResponse.statusCode, 200);
        assert.equal(meResponse.json().data.email, email);

        const updatedName = `Updated ${name}`;
        const updateResponse = await app.inject({
            method: "PATCH",
            url: "/users/me",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
            payload: {
                name: updatedName,
            },
        });

        assert.equal(updateResponse.statusCode, 200);
        assert.equal(updateResponse.json().data.name, updatedName);

        const meAfterUpdateResponse = await app.inject({
            method: "GET",
            url: "/users/me",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });

        assert.equal(meAfterUpdateResponse.statusCode, 200);
        assert.equal(meAfterUpdateResponse.json().data.name, updatedName);
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
