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
    const parts = [
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
    ];

    return Buffer.concat(parts);
}

test(
    "uploads an accident image to Cloudinary and persists the record",
    { skip: !hasCloudinaryConfig() },
    async () => {
        const app = await buildApp();
        await app.ready();

        const uniqueSuffix = `${Date.now()}`;
        const email = `upload-test-${uniqueSuffix}@example.com`;
        const password = "Test12345!";
        const tipoAcidente = `Upload test accident ${uniqueSuffix}`;
        const boundary = `----crashmap-test-${uniqueSuffix}`;
        const pngBuffer = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQABAAUA+gA3AAAAAElFTkSuQmCC",
            "base64",
        );

        let userId: string | undefined;
        let accidentId: string | undefined;
        let imageId: string | undefined;

        try {
            const registerResponse = await app.inject({
                method: "POST",
                url: "/auth/register",
                payload: {
                    name: "Upload Test User",
                    email,
                    password,
                },
            });

            assert.equal(registerResponse.statusCode, 201);
            const registerBody = registerResponse.json();
            const accessToken = registerBody.data.tokens.accessToken as string;
            userId = registerBody.data.user.id as string;

            const accidentResponse = await app.inject({
                method: "POST",
                url: "/accidents",
                headers: {
                    authorization: `Bearer ${accessToken}`,
                },
                payload: {
                    tipo_acidente: tipoAcidente,
                    classificacao_acidente: "com_vitima",
                    condicao_meteorologica: "ceu_claro",
                    description: "Temporary accident for upload testing",
                    latitude: -23.55,
                    longitude: -46.63,
                    occurredAt: "2026-08-05T10:00:00.000Z",
                    severity: "medium",
                },
            });

            assert.equal(accidentResponse.statusCode, 201);
            const accidentBody = accidentResponse.json();
            accidentId = accidentBody.data.id as string;

            const uploadResponse = await app.inject({
                method: "POST",
                url: `/accidents/${accidentId}/images`,
                headers: {
                    authorization: `Bearer ${accessToken}`,
                    "content-type": `multipart/form-data; boundary=${boundary}`,
                },
                payload: buildMultipartBody(
                    boundary,
                    "cloudinary test",
                    pngBuffer,
                ),
            });

            assert.equal(uploadResponse.statusCode, 201);
            const uploadBody = uploadResponse.json();
            imageId = uploadBody.data.id as string;

            assert.equal(uploadBody.data.accident_id, accidentId);
            assert.equal(uploadBody.data.caption, "cloudinary test");
            assert.match(uploadBody.data.image_url, /^https:\/\//);
        } finally {
            if (imageId) {
                await prisma.accidentImage.deleteMany({
                    where: { id: imageId },
                });
            }

            if (accidentId) {
                await prisma.accident.deleteMany({ where: { id: accidentId } });
            }

            if (userId) {
                await prisma.refreshToken.deleteMany({
                    where: { user_id: userId },
                });
                await prisma.user.deleteMany({ where: { id: userId } });
            }

            await app.close();
        }
    },
);
