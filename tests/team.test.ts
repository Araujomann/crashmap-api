import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";
import {
    setModeratorInviteMailer,
    type ModeratorInviteMessage,
} from "../src/modules/team/invite-email.js";
import { getSettings } from "../src/modules/settings/settings.service.js";
import { purgeStaffTrail } from "./helpers/staff-trail.js";

function tokenFrom(message: ModeratorInviteMessage) {
    const [, token] = message.inviteUrl.split("#token=");
    assert.ok(token, `link sem token: ${message.inviteUrl}`);
    return decodeURIComponent(token);
}

test("moderator invites, team management and staff audit", async () => {
    const app = await buildApp();
    await app.ready();

    const sent: ModeratorInviteMessage[] = [];
    setModeratorInviteMailer(async (message) => {
        sent.push(message);
        return true;
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const password = "Test12345!";
    const userIds: string[] = [];
    const emails: string[] = [];
    const accidentIds: string[] = [];

    async function register(
        label: string,
        role: "user" | "moderator" | "admin",
        verified = true,
    ) {
        const email = `team-${label}-${suffix}@example.com`;
        emails.push(email);
        const response = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { name: `Team ${label}`, email, password },
        });
        assert.equal(response.statusCode, 201, response.body);
        const { user, tokens } = response.json().data;
        userIds.push(user.id);
        await prisma.user.update({
            where: { id: user.id },
            data: { role, is_email_verified: verified },
        });
        return {
            id: user.id as string,
            email,
            refreshToken: tokens.refreshToken as string,
            headers: { authorization: `Bearer ${tokens.accessToken}` },
        };
    }

    const call = (
        method: "GET" | "POST" | "PATCH" | "DELETE",
        url: string,
        headers?: Record<string, string>,
        payload?: Record<string, unknown>,
    ) => app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

    const auditCount = (action: string, targetId?: string) =>
        prisma.adminAuditLog.count({
            where: {
                action: action as never,
                ...(targetId ? { target_id: targetId } : {}),
                actor_id: { in: userIds },
            },
        });

    try {
        const admin = await register("admin", "admin");
        const secondAdmin = await register("admin2", "admin");
        const moderator = await register("moderator", "moderator");
        const invitee = await register("invitee", "user");
        const stranger = await register("stranger", "user");
        const unverified = await register("unverified", "user", false);

        // --- Autorização das rotas administrativas
        for (const [method, url, payload] of [
            ["GET", "/admin/moderator-invites", undefined],
            ["POST", "/admin/moderator-invites", { email: "x@example.com" }],
            ["GET", "/admin/moderators", undefined],
        ] as const) {
            assert.equal((await call(method, url, undefined, payload)).statusCode, 401, url);
            const forbidden = await call(method, url, moderator.headers, payload);
            assert.equal(forbidden.statusCode, 403, `${method} ${url}`);
            assert.equal(forbidden.json().error.code, "AUTH_MISSING_PERMISSION");
        }

        // --- Criação
        const alreadyStaff = await call("POST", "/admin/moderator-invites", admin.headers, {
            email: moderator.email,
        });
        assert.equal(alreadyStaff.statusCode, 409);
        assert.equal(alreadyStaff.json().error.code, "INVITE_ALREADY_STAFF");

        const created = await call("POST", "/admin/moderator-invites", admin.headers, {
            email: invitee.email.toUpperCase(),
        });
        assert.equal(created.statusCode, 201, created.body);
        const firstInvite = created.json().data.invite;
        assert.equal(created.json().data.email_sent, true);
        assert.equal(firstInvite.status, "PENDING");
        assert.equal(firstInvite.email, invitee.email);
        assert.equal(firstInvite.invited_by.id, admin.id);
        const { invite_ttl_hours: ttlHours } = await getSettings();
        const hoursValid =
            (new Date(firstInvite.expires_at).getTime() - Date.now()) / 3_600_000;
        assert.ok(
            hoursValid > ttlHours - 0.1 && hoursValid <= ttlHours,
            `validade ${hoursValid}h, configurado ${ttlHours}h`,
        );
        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, invitee.email);
        assert.match(sent[0].inviteUrl, /\/invite#token=/);
        const firstToken = tokenFrom(sent[0]);
        assert.equal(
            await prisma.moderatorInvite.count({ where: { token_hash: firstToken } }),
            0,
            "o token não é salvo em texto",
        );
        assert.equal(await auditCount("MODERATOR_INVITE_CREATED", firstInvite.id), 1);

        const duplicate = await call("POST", "/admin/moderator-invites", admin.headers, {
            email: invitee.email,
        });
        assert.equal(duplicate.statusCode, 409);
        assert.equal(duplicate.json().error.code, "INVITE_ALREADY_PENDING");

        const pending = await call("GET", "/admin/moderator-invites?status=PENDING", admin.headers);
        assert.equal(pending.statusCode, 200, pending.body);
        assert.ok(
            pending.json().data.some((invite: { id: string }) => invite.id === firstInvite.id),
        );

        // --- Aceite: guardas
        const mismatch = await call("POST", "/moderator-invites/accept", stranger.headers, {
            token: firstToken,
        });
        assert.equal(mismatch.statusCode, 403);
        assert.equal(mismatch.json().error.code, "INVITE_EMAIL_MISMATCH");

        const notVerified = await call("POST", "/moderator-invites/accept", unverified.headers, {
            token: firstToken,
        });
        assert.equal(notVerified.statusCode, 403);
        assert.equal(notVerified.json().error.code, "AUTH_EMAIL_NOT_VERIFIED");

        const bogus = await call("POST", "/moderator-invites/accept", invitee.headers, {
            token: "x".repeat(43),
        });
        assert.equal(bogus.statusCode, 410);
        assert.equal(bogus.json().error.code, "INVITE_INVALID");

        // --- Reenvio: cooldown, novo link e link antigo inválido
        const tooSoon = await call(
            "POST",
            `/admin/moderator-invites/${firstInvite.id}/resend`,
            admin.headers,
        );
        assert.equal(tooSoon.statusCode, 429);
        assert.equal(tooSoon.json().error.code, "INVITE_RESEND_COOLDOWN");

        await prisma.moderatorInvite.update({
            where: { id: firstInvite.id },
            data: { last_sent_at: new Date(Date.now() - 2 * 60 * 1000) },
        });
        const resent = await call(
            "POST",
            `/admin/moderator-invites/${firstInvite.id}/resend`,
            admin.headers,
        );
        assert.equal(resent.statusCode, 201, resent.body);
        const secondInvite = resent.json().data.invite;
        assert.notEqual(secondInvite.id, firstInvite.id);
        assert.equal(secondInvite.send_count, 2);
        const secondToken = tokenFrom(sent[1]);
        assert.notEqual(secondToken, firstToken);
        assert.equal(await auditCount("MODERATOR_INVITE_RESENT", secondInvite.id), 1);

        const oldLink = await call("POST", "/moderator-invites/accept", invitee.headers, {
            token: firstToken,
        });
        assert.equal(oldLink.statusCode, 410);

        // --- Aceite válido
        const accepted = await call("POST", "/moderator-invites/accept", invitee.headers, {
            token: secondToken,
        });
        assert.equal(accepted.statusCode, 200, accepted.body);
        assert.equal(accepted.json().data.role, "moderator");
        assert.ok(accepted.json().data.permissions.includes("reports:moderate"));
        assert.equal(await auditCount("MODERATOR_INVITE_ACCEPTED", secondInvite.id), 1);

        const reused = await call("POST", "/moderator-invites/accept", invitee.headers, {
            token: secondToken,
        });
        assert.equal(reused.statusCode, 410);

        const history = await call("GET", "/admin/moderator-invites", admin.headers);
        const statuses = Object.fromEntries(
            history
                .json()
                .data.filter((invite: { email: string }) => invite.email === invitee.email)
                .map((invite: { id: string; status: string }) => [invite.id, invite.status]),
        );
        assert.equal(statuses[firstInvite.id], "REVOKED");
        assert.equal(statuses[secondInvite.id], "ACCEPTED");

        // --- Revogação de convite
        const strangerInvite = await call("POST", "/admin/moderator-invites", admin.headers, {
            email: stranger.email,
        });
        assert.equal(strangerInvite.statusCode, 201, strangerInvite.body);
        const strangerToken = tokenFrom(sent[2]);
        const strangerInviteId = strangerInvite.json().data.invite.id as string;

        const revokedInvite = await call(
            "POST",
            `/admin/moderator-invites/${strangerInviteId}/revoke`,
            admin.headers,
        );
        assert.equal(revokedInvite.statusCode, 200, revokedInvite.body);
        assert.equal(revokedInvite.json().data.status, "REVOKED");
        assert.equal(revokedInvite.json().data.revoked_by.id, admin.id);
        assert.equal(await auditCount("MODERATOR_INVITE_REVOKED", strangerInviteId), 1);

        const revokedAccept = await call("POST", "/moderator-invites/accept", stranger.headers, {
            token: strangerToken,
        });
        assert.equal(revokedAccept.statusCode, 410);

        const revokeAgain = await call(
            "POST",
            `/admin/moderator-invites/${strangerInviteId}/revoke`,
            admin.headers,
        );
        assert.equal(revokeAgain.statusCode, 409);
        assert.equal(revokeAgain.json().error.code, "INVITE_NOT_OPEN");

        // --- Convite vencido: aparece como EXPIRED e pode ser substituído
        const expiredEmail = `team-expired-${suffix}@example.com`;
        emails.push(expiredEmail);
        const toExpire = await call("POST", "/admin/moderator-invites", admin.headers, {
            email: expiredEmail,
        });
        assert.equal(toExpire.statusCode, 201, toExpire.body);
        const expiredId = toExpire.json().data.invite.id as string;
        const expiredToken = tokenFrom(sent[3]);
        await prisma.moderatorInvite.update({
            where: { id: expiredId },
            data: { expires_at: new Date(Date.now() - 1000) },
        });

        const expiredList = await call("GET", "/admin/moderator-invites?status=EXPIRED", admin.headers);
        assert.ok(
            expiredList.json().data.some((invite: { id: string }) => invite.id === expiredId),
        );
        const replaced = await call("POST", "/admin/moderator-invites", admin.headers, {
            email: expiredEmail,
        });
        assert.equal(replaced.statusCode, 201, replaced.body);
        const oldExpired = await prisma.moderatorInvite.findUniqueOrThrow({
            where: { id: expiredId },
        });
        assert.ok(oldExpired.revoked_at, "o sistema encerra o convite vencido");
        assert.equal(oldExpired.revoked_by_id, null);
        assert.ok(expiredToken);

        // --- Equipe
        const team = await call("GET", "/admin/moderators", admin.headers);
        assert.equal(team.statusCode, 200, team.body);
        const promoted = team
            .json()
            .data.find((member: { id: string }) => member.id === invitee.id);
        assert.equal(promoted?.role, "moderator");
        assert.ok(promoted?.joined_at);

        // --- Remoção de moderador
        const noReason = await call(
            "POST",
            `/admin/moderators/${invitee.id}/revoke`,
            admin.headers,
            { reason: "  " },
        );
        assert.equal(noReason.statusCode, 400);
        assert.equal(noReason.json().error.code, "REVOKE_REASON_REQUIRED");

        const self = await call("POST", `/admin/moderators/${admin.id}/revoke`, admin.headers, {
            reason: "teste",
        });
        assert.equal(self.statusCode, 409);
        assert.equal(self.json().error.code, "CANNOT_REVOKE_SELF");

        const otherAdmin = await call(
            "POST",
            `/admin/moderators/${secondAdmin.id}/revoke`,
            admin.headers,
            { reason: "teste" },
        );
        assert.equal(otherAdmin.statusCode, 409);
        assert.equal(otherAdmin.json().error.code, "CANNOT_REVOKE_ADMIN");

        const removed = await call(
            "POST",
            `/admin/moderators/${invitee.id}/revoke`,
            admin.headers,
            { reason: "Fim do período de voluntariado" },
        );
        assert.equal(removed.statusCode, 200, removed.body);
        assert.equal(await auditCount("MODERATOR_ROLE_REVOKED", invitee.id), 1);

        const lostAccess = await call("GET", "/admin/moderation-history", invitee.headers);
        assert.equal(lostAccess.statusCode, 403, "perde acesso na hora");
        const refresh = await call("POST", "/auth/refresh", undefined, {
            refreshToken: invitee.refreshToken,
        });
        assert.equal(refresh.statusCode, 401, "sessões encerradas");

        const removeAgain = await call(
            "POST",
            `/admin/moderators/${invitee.id}/revoke`,
            admin.headers,
            { reason: "teste" },
        );
        assert.equal(removeAgain.statusCode, 409);
        assert.equal(removeAgain.json().error.code, "NOT_A_MODERATOR");

        // --- Auditoria das ações de staff em conteúdo de terceiros
        const report = await call("POST", "/accidents", stranger.headers, {
            tipo_acidente: `team-${suffix}`,
            classificacao_acidente: "sem_vitima",
            condicao_meteorologica: "ceu_claro",
            description: "Texto original",
            latitude: -5.52,
            longitude: -47.47,
            occurredAt: "2026-11-10T12:00:00.000Z",
            severity: "low",
        });
        assert.equal(report.statusCode, 201, report.body);
        const reportId = report.json().data.id as string;
        accidentIds.push(reportId);

        const ownEdit = await call("PATCH", `/accidents/${reportId}`, stranger.headers, {
            severity: "medium",
        });
        assert.equal(ownEdit.statusCode, 200, ownEdit.body);
        assert.equal(await auditCount("REPORT_EDITED_BY_STAFF", reportId), 0);

        const staffEdit = await call("PATCH", `/accidents/${reportId}`, moderator.headers, {
            description: "Texto revisado",
        });
        assert.equal(staffEdit.statusCode, 200, staffEdit.body);
        const editAudit = await prisma.adminAuditLog.findFirstOrThrow({
            where: { action: "REPORT_EDITED_BY_STAFF", target_id: reportId },
        });
        assert.equal(editAudit.actor_id, moderator.id);
        assert.deepEqual(editAudit.metadata, {
            author_id: stranger.id,
            before: { description: "Texto original" },
            after: { description: "Texto revisado" },
        });

        const staffDelete = await call("DELETE", `/accidents/${reportId}`, moderator.headers);
        assert.equal(staffDelete.statusCode, 200, staffDelete.body);
        const deleteAudit = await prisma.adminAuditLog.findFirstOrThrow({
            where: { action: "REPORT_DELETED_BY_STAFF", target_id: reportId },
        });
        assert.equal(
            (deleteAudit.metadata as { snapshot: { description: string } }).snapshot.description,
            "Texto revisado",
        );

        // --- Auditoria é somente-inserção
        await assert.rejects(
            prisma.adminAuditLog.update({
                where: { id: deleteAudit.id },
                data: { target_id: "adulterado" },
            }),
        );
        await assert.rejects(
            prisma.adminAuditLog.delete({ where: { id: deleteAudit.id } }),
        );
    } finally {
        setModeratorInviteMailer(null);
        await purgeStaffTrail(userIds, emails);
        await prisma.accident.deleteMany({ where: { id: { in: accidentIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await app.close();
    }
});
