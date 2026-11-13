import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";

test("DELETE /users/me requires the password and removes the account", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `delete-me-${uniqueSuffix}@example.com`;
    const password = "Test12345!";
    let userId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { name: `Delete Me ${uniqueSuffix}`, email, password },
        });

        assert.equal(registerResponse.statusCode, 201);
        const registerBody = registerResponse.json();
        const accessToken = registerBody.data.tokens.accessToken as string;
        userId = registerBody.data.user.id as string;
        const headers = { authorization: `Bearer ${accessToken}` };

        const missingPassword = await app.inject({
            method: "DELETE",
            url: "/users/me",
            headers,
            payload: {},
        });
        assert.equal(missingPassword.statusCode, 400);
        assert.equal(missingPassword.json().error.code, "PASSWORD_REQUIRED");

        const wrongPassword = await app.inject({
            method: "DELETE",
            url: "/users/me",
            headers,
            payload: { password: "wrong-password" },
        });
        assert.equal(wrongPassword.statusCode, 403);
        assert.equal(wrongPassword.json().error.code, "INVALID_PASSWORD");

        const deleteResponse = await app.inject({
            method: "DELETE",
            url: "/users/me",
            headers,
            payload: { password },
        });
        assert.equal(deleteResponse.statusCode, 204);

        const deletedUser = await prisma.user.findUnique({
            where: { id: userId },
        });
        assert.equal(deletedUser, null);
        assert.equal(
            await prisma.refreshToken.count({ where: { user_id: userId } }),
            0,
        );

        const meAfterDelete = await app.inject({
            method: "GET",
            url: "/users/me",
            headers,
        });
        assert.equal(meAfterDelete.statusCode, 401);
    } finally {
        if (userId) {
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await app.close();
    }
});

test("DELETE /users/me refuses staff accounts", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `delete-staff-${uniqueSuffix}@example.com`;
    const password = "Test12345!";
    let userId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { name: `Delete Staff ${uniqueSuffix}`, email, password },
        });

        assert.equal(registerResponse.statusCode, 201);
        const registerBody = registerResponse.json();
        userId = registerBody.data.user.id as string;
        await prisma.user.update({
            where: { id: userId },
            data: { role: "moderator" },
        });

        const response = await app.inject({
            method: "DELETE",
            url: "/users/me",
            headers: {
                authorization: `Bearer ${registerBody.data.tokens.accessToken}`,
            },
            payload: { password },
        });

        assert.equal(response.statusCode, 403);
        assert.equal(
            response.json().error.code,
            "STAFF_ACCOUNT_DELETION_FORBIDDEN",
        );
    } finally {
        if (userId) {
            await prisma.refreshToken.deleteMany({ where: { user_id: userId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await app.close();
    }
});
