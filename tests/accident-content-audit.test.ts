import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";
import { purgeStaffTrail } from "./helpers/staff-trail.js";

/**
 * Caracterização: exclusão de comentário e de imagem de um relato aprovado.
 * O autor apaga o próprio conteúdo sem auditoria; staff apaga conteúdo de
 * terceiros e a ação vai para a auditoria; outro usuário comum é recusado.
 */
test("comment and image deletes respect ownership and audit staff actions", async () => {
    const app = await buildApp();
    await app.ready();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userIds: string[] = [];
    const emails: string[] = [];
    let accidentId: string | undefined;

    async function register(label: string, role: "user" | "moderator") {
        const email = `content-audit-${label}-${suffix}@example.com`;
        emails.push(email);
        const response = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { acceptedTermsVersion: "2026-11-15", name: `Audit ${label}`, email, password: "Test12345!" },
        });
        assert.equal(response.statusCode, 201, response.body);
        const { user, tokens } = response.json().data;
        userIds.push(user.id);
        await prisma.user.update({
            where: { id: user.id },
            data: { role, is_email_verified: true },
        });
        return {
            id: user.id as string,
            headers: { authorization: `Bearer ${tokens.accessToken}` },
        };
    }

    const auditFor = (action: string, targetId: string) =>
        prisma.adminAuditLog.findMany({
            where: { action: action as never, target_id: targetId },
        });

    try {
        const author = await register("author", "user");
        const stranger = await register("stranger", "user");
        const moderator = await register("moderator", "moderator");

        const accident = await prisma.accident.create({
            data: {
                tipo_acidente: `content-audit-${suffix}`,
                latitude: -5.52,
                longitude: -47.47,
                occurred_at: new Date("2026-11-10T12:00:00.000Z"),
                severity: "low",
                moderation_status: "APPROVED",
                created_by_id: author.id,
            },
        });
        accidentId = accident.id;

        async function comment(body: string) {
            const response = await app.inject({
                method: "POST",
                url: `/accidents/${accident.id}/comments`,
                headers: author.headers,
                payload: { body },
            });
            assert.equal(response.statusCode, 201, response.body);
            return response.json().data as {
                id: string;
                author_name: string | null;
                created_at: string;
            };
        }

        const ownComment = await comment("  meu comentário  ");
        assert.equal(ownComment.author_name, "Audit author");
        const otherComment = await comment("comentário para moderar");

        const listed = await app.inject({
            method: "GET",
            url: `/accidents/${accident.id}/comments`,
        });
        assert.equal(listed.statusCode, 200);
        assert.deepEqual(
            listed.json().data.map((item: { body: string }) => item.body),
            ["meu comentário", "comentário para moderar"],
        );

        // Usuário comum não apaga comentário alheio.
        const forbidden = await app.inject({
            method: "DELETE",
            url: `/accidents/${accident.id}/comments/${otherComment.id}`,
            headers: stranger.headers,
        });
        assert.equal(forbidden.statusCode, 403);
        assert.equal(forbidden.json().error.code, "COMMENT_FORBIDDEN");

        // O autor apaga o próprio comentário: sem auditoria.
        const ownDelete = await app.inject({
            method: "DELETE",
            url: `/accidents/${accident.id}/comments/${ownComment.id}`,
            headers: author.headers,
        });
        assert.equal(ownDelete.statusCode, 200);
        assert.deepEqual(ownDelete.json(), { data: { deleted: true } });
        assert.equal(
            (await auditFor("COMMENT_DELETED_BY_STAFF", ownComment.id)).length,
            0,
        );

        // Staff apaga comentário de terceiro: auditado com o conteúdo.
        const staffDelete = await app.inject({
            method: "DELETE",
            url: `/accidents/${accident.id}/comments/${otherComment.id}`,
            headers: moderator.headers,
        });
        assert.equal(staffDelete.statusCode, 200);
        const [commentAudit] = await auditFor(
            "COMMENT_DELETED_BY_STAFF",
            otherComment.id,
        );
        assert.ok(commentAudit);
        assert.equal(commentAudit.actor_id, moderator.id);
        assert.equal(commentAudit.target_type, "comment");
        assert.deepEqual(commentAudit.metadata, {
            accident_id: accident.id,
            author_id: author.id,
            body: "comentário para moderar",
            created_at: otherComment.created_at,
        });

        const missing = await app.inject({
            method: "DELETE",
            url: `/accidents/${accident.id}/comments/${otherComment.id}`,
            headers: moderator.headers,
        });
        assert.equal(missing.statusCode, 404);
        assert.equal(missing.json().error.code, "COMMENT_NOT_FOUND");

        // Imagens: gravadas direto no banco (o upload depende do Cloudinary).
        const image = await prisma.accidentImage.create({
            data: {
                accident_id: accident.id,
                created_by_id: author.id,
                image_url: "https://example.com/image.jpg",
                caption: "legenda",
            },
        });

        const images = await app.inject({
            method: "GET",
            url: `/accidents/${accident.id}/images`,
        });
        assert.equal(images.statusCode, 200);
        assert.equal(images.json().data[0].id, image.id);

        const imageForbidden = await app.inject({
            method: "DELETE",
            url: `/accidents/${accident.id}/images/${image.id}`,
            headers: stranger.headers,
        });
        assert.equal(imageForbidden.statusCode, 403);
        assert.equal(imageForbidden.json().error.code, "IMAGE_FORBIDDEN");

        const imageDelete = await app.inject({
            method: "DELETE",
            url: `/accidents/${accident.id}/images/${image.id}`,
            headers: moderator.headers,
        });
        assert.equal(imageDelete.statusCode, 200);
        const [imageAudit] = await auditFor("IMAGE_DELETED_BY_STAFF", image.id);
        assert.ok(imageAudit);
        assert.equal(imageAudit.actor_id, moderator.id);
        assert.equal(imageAudit.target_type, "image");
        assert.deepEqual(imageAudit.metadata, {
            accident_id: accident.id,
            author_id: author.id,
            image_url: "https://example.com/image.jpg",
            caption: "legenda",
            created_at: image.created_at.toISOString(),
        });
    } finally {
        await purgeStaffTrail(userIds, emails);
        if (accidentId) {
            await prisma.accident.deleteMany({ where: { id: accidentId } });
        }
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await app.close();
    }
});
