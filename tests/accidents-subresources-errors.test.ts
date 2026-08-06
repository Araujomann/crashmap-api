import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { env } from "../src/shared/config/env.js";
import { prisma } from "../src/shared/database/prisma.js";

function hasCloudinaryConfig() {
    return Boolean(
        env.CLOUDINARY_CLOUD_NAME &&
        env.CLOUDINARY_API_KEY &&
        env.CLOUDINARY_API_SECRET,
    );
}

function buildMultipartBody(boundary: string, caption: string, file: Buffer) {
    return Buffer.concat([
        Buffer.from(
            `--${boundary}\r\n` +
                'Content-Disposition: form-data; name="caption"\r\n\r\n' +
                `${caption}\r\n`,
            "utf8",
        ),
        Buffer.from(
            `--${boundary}\r\n` +
                'Content-Disposition: form-data; name="file"; filename="valid.png"\r\n' +
                "Content-Type: image/png\r\n\r\n",
            "utf8",
        ),
        file,
        Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
}

test("accident comments reject missing auth and unknown accidents", async () => {
    const app = await buildApp();
    await app.ready();

    try {
        const missingAuthResponse = await app.inject({
            method: "POST",
            url: "/accidents/00000000-0000-0000-0000-000000000000/comments",
            payload: {
                body: "Hello world",
            },
        });

        assert.equal(missingAuthResponse.statusCode, 401);
        assert.equal(
            missingAuthResponse.json().error.code,
            "AUTH_MISSING_ACCESS_TOKEN",
        );

        const uniqueSuffix = `${Date.now()}`;
        const email = `comment-errors-${uniqueSuffix}@example.com`;
        const password = "Test12345!";

        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Comment Errors User ${uniqueSuffix}`,
                email,
                password,
            },
        });

        assert.equal(registerResponse.statusCode, 201);
        const accessToken = registerResponse.json().data.tokens
            .accessToken as string;

        const notFoundResponse = await app.inject({
            method: "POST",
            url: "/accidents/00000000-0000-0000-0000-000000000000/comments",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
            payload: {
                body: "Hello world",
            },
        });

        assert.equal(notFoundResponse.statusCode, 404);
        assert.equal(notFoundResponse.json().error.code, "ACCIDENT_NOT_FOUND");
    } finally {
        await app.close();
    }
});

test("accident comments and images reject other-user deletes", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const ownerEmail = `subresource-owner-${uniqueSuffix}@example.com`;
    const intruderEmail = `subresource-intruder-${uniqueSuffix}@example.com`;
    const password = "Test12345!";
    const boundary = `----crashmap-subresource-${uniqueSuffix}`;
    const pngBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQABAAUA+gA3AAAAAElFTkSuQmCC",
        "base64",
    );

    let ownerUserId: string | undefined;
    let intruderUserId: string | undefined;
    let accidentId: string | undefined;
    let commentId: string | undefined;
    let imageId: string | undefined;

    try {
        const ownerRegisterResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Subresource Owner ${uniqueSuffix}`,
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
                name: `Subresource Intruder ${uniqueSuffix}`,
                email: intruderEmail,
                password,
            },
        });

        assert.equal(intruderRegisterResponse.statusCode, 201);
        const intruderAccessToken = intruderRegisterResponse.json().data.tokens
            .accessToken as string;
        intruderUserId = intruderRegisterResponse.json().data.user.id as string;

        const accidentResponse = await app.inject({
            method: "POST",
            url: "/accidents",
            headers: {
                authorization: `Bearer ${ownerAccessToken}`,
            },
            payload: {
                tipo_acidente: `Subresource accident ${uniqueSuffix}`,
                classificacao_acidente: "sem_vitima",
                condicao_meteorologica: "nublado",
                description: "Created for comment/image tests",
                latitude: -23.55,
                longitude: -46.63,
                occurredAt: "2026-08-05T10:00:00.000Z",
                severity: "medium",
            },
        });

        assert.equal(accidentResponse.statusCode, 201);
        accidentId = accidentResponse.json().data.id as string;

        const commentResponse = await app.inject({
            method: "POST",
            url: `/accidents/${accidentId}/comments`,
            headers: {
                authorization: `Bearer ${ownerAccessToken}`,
            },
            payload: {
                body: "Owner comment",
            },
        });

        assert.equal(commentResponse.statusCode, 201);
        commentId = commentResponse.json().data.id as string;

        if (hasCloudinaryConfig()) {
            const imageResponse = await app.inject({
                method: "POST",
                url: `/accidents/${accidentId}/images`,
                headers: {
                    authorization: `Bearer ${ownerAccessToken}`,
                    "content-type": `multipart/form-data; boundary=${boundary}`,
                },
                payload: buildMultipartBody(boundary, "Owner image", pngBuffer),
            });

            assert.equal(imageResponse.statusCode, 201);
            imageId = imageResponse.json().data.id as string;
        }

        const commentDeleteResponse = await app.inject({
            method: "DELETE",
            url: `/accidents/${accidentId}/comments/${commentId}`,
            headers: {
                authorization: `Bearer ${intruderAccessToken}`,
            },
        });

        assert.equal(commentDeleteResponse.statusCode, 403);
        assert.equal(
            commentDeleteResponse.json().error.code,
            "COMMENT_FORBIDDEN",
        );

        if (imageId) {
            const imageDeleteResponse = await app.inject({
                method: "DELETE",
                url: `/accidents/${accidentId}/images/${imageId}`,
                headers: {
                    authorization: `Bearer ${intruderAccessToken}`,
                },
            });

            assert.equal(imageDeleteResponse.statusCode, 403);
            assert.equal(
                imageDeleteResponse.json().error.code,
                "IMAGE_FORBIDDEN",
            );
        }
    } finally {
        if (imageId) {
            await prisma.accidentImage.deleteMany({ where: { id: imageId } });
        }

        if (commentId) {
            await prisma.accidentComment.deleteMany({
                where: { id: commentId },
            });
        }

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
