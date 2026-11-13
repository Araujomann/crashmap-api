import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";
import { setModeratorInviteMailer } from "../src/modules/team/invite-email.js";
import { GrantRoleError, grantRole } from "../src/modules/users/grant-role.js";
import { purgeStaffTrail } from "./helpers/staff-trail.js";

test("user management, audit log, platform settings and grant-role script", async () => {
    const app = await buildApp();
    await app.ready();
    setModeratorInviteMailer(async () => true);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const password = "Test12345!";
    const userIds: string[] = [];
    const emails: string[] = [];
    const settingsSnapshot = await prisma.platformSetting.findMany();

    async function register(label: string, role: "user" | "moderator" | "admin", verified = true) {
        const email = `panel-${label}-${suffix}@example.com`;
        emails.push(email);
        const response = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { name: `Panel ${label}`, email, password },
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
        method: "GET" | "POST" | "PATCH",
        url: string,
        headers?: Record<string, string>,
        payload?: Record<string, unknown>,
    ) => app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    const login = (email: string, pw = password) =>
        call("POST", "/auth/login", undefined, { email, password: pw });

    try {
        const admin = await register("admin", "admin");
        const otherAdmin = await register("admin2", "admin");
        const moderator = await register("moderator", "moderator");
        const target = await register("target", "user");
        const multi = await register("multi", "user");
        const unverified = await register("unverified", "user", false);

        // --- Listagem e detalhe
        const listed = await call("GET", `/admin/users?search=${suffix}`, admin.headers);
        assert.equal(listed.statusCode, 200, listed.body);
        assert.equal(listed.json().pagination.total, 6);
        const onlyMods = await call("GET", `/admin/users?search=${suffix}&role=moderator`, admin.headers);
        assert.deepEqual(
            onlyMods.json().data.map((user: { id: string }) => user.id),
            [moderator.id],
        );
        const detail = await call("GET", `/admin/users/${target.id}`, admin.headers);
        assert.equal(detail.statusCode, 200, detail.body);
        assert.equal(detail.json().data.active_sessions, 1);
        assert.equal(detail.json().data.suspended_at, null);

        const asModerator = await call("GET", "/admin/users", moderator.headers);
        assert.equal(asModerator.statusCode, 403);

        // --- Suspensão: regras
        const noReason = await call("POST", `/admin/users/${target.id}/suspend`, admin.headers, { reason: " " });
        assert.equal(noReason.statusCode, 400);
        assert.equal(noReason.json().error.code, "SUSPEND_REASON_REQUIRED");
        const self = await call("POST", `/admin/users/${admin.id}/suspend`, admin.headers, { reason: "teste" });
        assert.equal(self.json().error.code, "CANNOT_TARGET_SELF");
        const onAdmin = await call("POST", `/admin/users/${otherAdmin.id}/suspend`, admin.headers, { reason: "teste" });
        assert.equal(onAdmin.json().error.code, "CANNOT_TARGET_ADMIN");

        // --- Suspensão: efeito
        const suspended = await call("POST", `/admin/users/${target.id}/suspend`, admin.headers, {
            reason: "Relatos falsos repetidos",
        });
        assert.equal(suspended.statusCode, 200, suspended.body);
        assert.ok(suspended.json().data.suspended_at);
        assert.equal(suspended.json().data.suspended_by.id, admin.id);
        assert.equal(suspended.json().data.active_sessions, 0);

        const blockedMe = await call("GET", "/auth/me", target.headers);
        assert.equal(blockedMe.statusCode, 403, "access token já emitido deixa de valer");
        assert.equal(blockedMe.json().error.code, "AUTH_ACCOUNT_SUSPENDED");
        const blockedLogin = await login(target.email);
        assert.equal(blockedLogin.statusCode, 403);
        assert.equal(blockedLogin.json().error.code, "AUTH_ACCOUNT_SUSPENDED");
        const wrongPassword = await login(target.email, "wrong-password");
        assert.equal(wrongPassword.statusCode, 401, "sem a senha, não revela a suspensão");
        const blockedRefresh = await call("POST", "/auth/refresh", undefined, {
            refreshToken: target.refreshToken,
        });
        assert.equal(blockedRefresh.statusCode, 401);

        const again = await call("POST", `/admin/users/${target.id}/suspend`, admin.headers, { reason: "de novo" });
        assert.equal(again.json().error.code, "USER_ALREADY_SUSPENDED");
        const suspendedList = await call("GET", `/admin/users?search=${suffix}&status=suspended`, admin.headers);
        assert.deepEqual(
            suspendedList.json().data.map((user: { id: string }) => user.id),
            [target.id],
        );

        // --- Moderador suspenso perde o painel na hora
        await call("POST", `/admin/users/${moderator.id}/suspend`, admin.headers, { reason: "Investigação" });
        const modBlocked = await call("GET", "/admin/moderation-history", moderator.headers);
        assert.equal(modBlocked.statusCode, 403);
        assert.equal(modBlocked.json().error.code, "AUTH_ACCOUNT_SUSPENDED");
        await call("POST", `/admin/users/${moderator.id}/reactivate`, admin.headers);

        // --- Reativação
        const reactivated = await call("POST", `/admin/users/${target.id}/reactivate`, admin.headers);
        assert.equal(reactivated.statusCode, 200, reactivated.body);
        assert.equal(reactivated.json().data.suspended_at, null);
        assert.equal((await login(target.email)).statusCode, 200);
        const reactivateAgain = await call("POST", `/admin/users/${target.id}/reactivate`, admin.headers);
        assert.equal(reactivateAgain.json().error.code, "USER_NOT_SUSPENDED");

        // --- Encerrar sessões
        await login(multi.email);
        const revoked = await call("POST", `/admin/users/${multi.id}/sessions/revoke`, admin.headers);
        assert.equal(revoked.statusCode, 200, revoked.body);
        assert.equal(revoked.json().data.revoked_sessions, 2);
        const multiRefresh = await call("POST", "/auth/refresh", undefined, {
            refreshToken: multi.refreshToken,
        });
        assert.equal(multiRefresh.statusCode, 401);

        // --- Auditoria
        const audit = await call(
            "GET",
            `/admin/audit-logs?actorId=${admin.id}&targetId=${target.id}`,
            admin.headers,
        );
        assert.equal(audit.statusCode, 200, audit.body);
        const actions = audit.json().data.map((entry: { action: string }) => entry.action);
        assert.deepEqual(actions, ["USER_REACTIVATED", "USER_SUSPENDED"], "mais recente primeiro");
        const suspendEntry = audit.json().data[1];
        assert.equal(suspendEntry.metadata.reason, "Relatos falsos repetidos");
        assert.equal(suspendEntry.actor.id, admin.id);
        assert.equal(suspendEntry.target_type, "user");

        const byAction = await call(
            "GET",
            `/admin/audit-logs?action=USER_SESSIONS_REVOKED&targetId=${multi.id}`,
            admin.headers,
        );
        assert.equal(byAction.json().pagination.total, 1);
        assert.equal(byAction.json().data[0].metadata.revoked_sessions, 2);
        assert.equal((await call("GET", "/admin/audit-logs", moderator.headers)).statusCode, 403);

        // --- Configurações
        const settings = await call("GET", "/admin/settings", admin.headers);
        assert.equal(settings.statusCode, 200, settings.body);
        const keys = settings.json().data.map((item: { key: string }) => item.key);
        assert.deepEqual(keys, ["invite_ttl_hours", "invite_max_sends_per_day"]);
        const ttlBefore = settings.json().data[0].value as number;

        const tooBig = await call("PATCH", "/admin/settings", admin.headers, { invite_ttl_hours: 500 });
        assert.equal(tooBig.statusCode, 400);
        const unknown = await call("PATCH", "/admin/settings", admin.headers, { foo: 1 });
        assert.equal(unknown.statusCode, 400);
        assert.equal(
            (await call("PATCH", "/admin/settings", moderator.headers, { invite_ttl_hours: 24 })).statusCode,
            403,
        );

        const newTtl = ttlBefore === 24 ? 48 : 24;
        const changed = await call("PATCH", "/admin/settings", admin.headers, { invite_ttl_hours: newTtl });
        assert.equal(changed.statusCode, 200, changed.body);
        assert.equal(changed.json().data[0].value, newTtl);
        assert.equal(changed.json().data[0].updated_by.id, admin.id);
        const settingsAudit = await prisma.adminAuditLog.findFirstOrThrow({
            where: { action: "SETTINGS_UPDATED", actor_id: admin.id },
        });
        assert.deepEqual(settingsAudit.metadata, {
            before: { invite_ttl_hours: ttlBefore },
            after: { invite_ttl_hours: newTtl },
        });

        // O convite passa a usar a nova validade.
        const inviteEmail = `panel-invitee-${suffix}@example.com`;
        emails.push(inviteEmail);
        const invite = await call("POST", "/admin/moderator-invites", admin.headers, { email: inviteEmail });
        assert.equal(invite.statusCode, 201, invite.body);
        const hours = (new Date(invite.json().data.invite.expires_at).getTime() - Date.now()) / 3_600_000;
        assert.ok(Math.abs(hours - newTtl) < 0.1, `validade ${hours}h, esperado ${newTtl}h`);

        // --- Script de papel
        const granted = await grantRole(multi.email, "moderator", "teste");
        assert.equal(granted.changed, true);
        assert.equal(granted.previousRole, "user");
        const scriptAudit = await prisma.adminAuditLog.findFirstOrThrow({
            where: { action: "ROLE_GRANTED_BY_SCRIPT", target_id: multi.id },
        });
        assert.equal(scriptAudit.actor_id, null);
        assert.equal((scriptAudit.metadata as { operator: string }).operator, "teste");

        const noop = await grantRole(multi.email.toUpperCase(), "moderator", "teste");
        assert.equal(noop.changed, false);

        await login(multi.email);
        const demoted = await grantRole(multi.email, "user", "teste");
        assert.equal(demoted.revokedSessions, 1, "quem perde poder sai das sessões");

        await assert.rejects(grantRole(unverified.email, "moderator", "teste"), GrantRoleError);
        await assert.rejects(grantRole(target.email, "owner", "teste"), GrantRoleError);
    } finally {
        setModeratorInviteMailer(null);
        await prisma.platformSetting.deleteMany();
        for (const row of settingsSnapshot) {
            await prisma.platformSetting.create({
                data: {
                    key: row.key,
                    value: row.value ?? {},
                    updated_by_id: row.updated_by_id,
                },
            });
        }
        await purgeStaffTrail(userIds, emails);
        await prisma.user.updateMany({
            where: { id: { in: userIds } },
            data: { suspended_by_id: null },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await app.close();
    }
});
