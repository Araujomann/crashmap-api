import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";

test("administrative notices are readable by users and writable by moderators", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const moderatorEmail = `notice-moderator-${uniqueSuffix}@example.com`;
    const userEmail = `notice-user-${uniqueSuffix}@example.com`;
    let moderatorId: string | undefined;
    let userId: string | undefined;

    try {
        const moderatorRegistration = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Notice Moderator ${uniqueSuffix}`,
                email: moderatorEmail,
                password: "Test12345!",
            },
        });
        assert.equal(moderatorRegistration.statusCode, 201);

        const moderator = moderatorRegistration.json().data.user;
        moderatorId = moderator.id as string;
        await prisma.user.update({
            where: { id: moderatorId },
            data: { role: "moderator", is_email_verified: true },
        });
        const moderatorHeaders = {
            authorization: `Bearer ${moderatorRegistration.json().data.tokens.accessToken}`,
        };

        const userRegistration = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Notice User ${uniqueSuffix}`,
                email: userEmail,
                password: "Test12345!",
            },
        });
        assert.equal(userRegistration.statusCode, 201);
        userId = userRegistration.json().data.user.id as string;
        await prisma.user.update({
            where: { id: userId },
            data: { is_email_verified: true },
        });
        const userHeaders = {
            authorization: `Bearer ${userRegistration.json().data.tokens.accessToken}`,
        };

        const unauthorizedList = await app.inject({
            method: "GET",
            url: "/notifications/administrative-notices",
        });
        assert.equal(unauthorizedList.statusCode, 401);

        const forbiddenPublish = await app.inject({
            method: "POST",
            url: "/notifications/administrative-notices",
            headers: userHeaders,
            payload: { message: "Aviso restrito" },
        });
        assert.equal(forbiddenPublish.statusCode, 403);
        assert.equal(
            forbiddenPublish.json().error.code,
            "AUTH_MISSING_PERMISSION",
        );

        const emptyPublish = await app.inject({
            method: "POST",
            url: "/notifications/administrative-notices",
            headers: moderatorHeaders,
            payload: { message: "   " },
        });
        assert.equal(emptyPublish.statusCode, 400);

        const publish = await app.inject({
            method: "POST",
            url: "/notifications/administrative-notices",
            headers: moderatorHeaders,
            payload: { message: "  Atualização importante do Farol.  " },
        });
        assert.equal(publish.statusCode, 201);
        assert.equal(
            publish.json().data.message,
            "Atualização importante do Farol.",
        );

        const list = await app.inject({
            method: "GET",
            url: "/notifications/administrative-notices",
            headers: userHeaders,
        });
        assert.equal(list.statusCode, 200);
        assert.ok(
            list
                .json()
                .data.some(
                    (notice: { id: string }) =>
                        notice.id === publish.json().data.id,
                ),
        );
    } finally {
        if (moderatorId || userId) {
            await prisma.administrativeNotice.deleteMany({
                where: {
                    created_by_id: {
                        in: [moderatorId, userId].filter(
                            (id): id is string => Boolean(id),
                        ),
                    },
                },
            });
            await prisma.user.deleteMany({
                where: {
                    id: {
                        in: [moderatorId, userId].filter(
                            (id): id is string => Boolean(id),
                        ),
                    },
                },
            });
        }
        await app.close();
    }
});