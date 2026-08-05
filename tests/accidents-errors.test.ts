import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";

test("accidents routes reject missing auth and invalid create payloads", async () => {
    const app = await buildApp();
    await app.ready();

    try {
        const missingAuthResponse = await app.inject({
            method: "POST",
            url: "/accidents",
            payload: {
                title: "Unauthorized accident",
                description: "Should not be created",
                latitude: -23.55,
                longitude: -46.63,
                occurredAt: "2026-08-05T10:00:00.000Z",
                severity: "medium",
            },
        });

        assert.equal(missingAuthResponse.statusCode, 401);
        assert.equal(
            missingAuthResponse.json().error.code,
            "AUTH_MISSING_ACCESS_TOKEN",
        );

        const uniqueSuffix = `${Date.now()}`;
        const email = `accident-errors-${uniqueSuffix}@example.com`;
        const password = "Test12345!";

        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Accident Errors User ${uniqueSuffix}`,
                email,
                password,
            },
        });

        assert.equal(registerResponse.statusCode, 201);
        const accessToken = registerResponse.json().data.tokens
            .accessToken as string;

        const invalidCreateResponse = await app.inject({
            method: "POST",
            url: "/accidents",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
            payload: {
                title: "Bad accident",
                description: "Invalid date should fail validation",
                latitude: -23.55,
                longitude: -46.63,
                occurredAt: "not-a-date",
                severity: "medium",
            },
        });

        assert.equal(invalidCreateResponse.statusCode, 400);
        assert.equal(
            invalidCreateResponse.json().error.code,
            "VALIDATION_ERROR",
        );
    } finally {
        await app.close();
    }
});

test("accidents ownership rules reject other-user updates and deletes", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const ownerEmail = `owner-${uniqueSuffix}@example.com`;
    const intruderEmail = `intruder-${uniqueSuffix}@example.com`;
    const password = "Test12345!";

    let ownerUserId: string | undefined;
    let intruderUserId: string | undefined;
    let accidentId: string | undefined;

    try {
        const ownerRegisterResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Owner User ${uniqueSuffix}`,
                email: ownerEmail,
                password,
            },
        });

        assert.equal(ownerRegisterResponse.statusCode, 201);
        const ownerAccessToken = ownerRegisterResponse.json().data.tokens
            .accessToken as string;
        ownerUserId = ownerRegisterResponse.json().data.user.id as string;

        const intruderRegisterResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Intruder User ${uniqueSuffix}`,
                email: intruderEmail,
                password,
            },
        });

        assert.equal(intruderRegisterResponse.statusCode, 201);
        const intruderAccessToken = intruderRegisterResponse.json().data.tokens
            .accessToken as string;
        intruderUserId = intruderRegisterResponse.json().data.user.id as string;

        const createResponse = await app.inject({
            method: "POST",
            url: "/accidents",
            headers: {
                authorization: `Bearer ${ownerAccessToken}`,
            },
            payload: {
                title: `Owned accident ${uniqueSuffix}`,
                description: "Created by owner",
                latitude: -23.55,
                longitude: -46.63,
                occurredAt: "2026-08-05T10:00:00.000Z",
                severity: "medium",
            },
        });

        assert.equal(createResponse.statusCode, 201);
        accidentId = createResponse.json().data.id as string;

        const updateResponse = await app.inject({
            method: "PATCH",
            url: `/accidents/${accidentId}`,
            headers: {
                authorization: `Bearer ${intruderAccessToken}`,
            },
            payload: {
                title: "Unauthorized update",
            },
        });

        assert.equal(updateResponse.statusCode, 403);
        assert.equal(updateResponse.json().error.code, "ACCIDENT_FORBIDDEN");

        const deleteResponse = await app.inject({
            method: "DELETE",
            url: `/accidents/${accidentId}`,
            headers: {
                authorization: `Bearer ${intruderAccessToken}`,
            },
        });

        assert.equal(deleteResponse.statusCode, 403);
        assert.equal(deleteResponse.json().error.code, "ACCIDENT_FORBIDDEN");
    } finally {
        if (accidentId) {
            await prisma.accidentImage.deleteMany({
                where: { accident_id: accidentId },
            });
            await prisma.accidentComment.deleteMany({
                where: { accident_id: accidentId },
            });
            await prisma.accident.deleteMany({ where: { id: accidentId } });
        }

        if (ownerUserId) {
            await prisma.refreshToken.deleteMany({
                where: { user_id: ownerUserId },
            });
            await prisma.user.deleteMany({ where: { id: ownerUserId } });
        }

        if (intruderUserId) {
            await prisma.refreshToken.deleteMany({
                where: { user_id: intruderUserId },
            });
            await prisma.user.deleteMany({ where: { id: intruderUserId } });
        }

        await app.close();
    }
});
