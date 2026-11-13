import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.js";
import {
    PERMISSIONS,
    can,
    permissionsFor,
    type Permission,
} from "../src/modules/auth/permissions.js";
import { prisma } from "../src/shared/database/prisma.js";
import { purgeStaffTrail } from "./helpers/staff-trail.js";

const MODERATOR_PERMISSIONS: Permission[] = [
    "panel:access",
    "reports:read",
    "reports:moderate",
    "moderation_history:read",
    "stats:read",
    "notices:publish",
];

test("role → permission map matches the agreed permission table", () => {
    assert.deepEqual(permissionsFor("user"), []);
    assert.deepEqual(permissionsFor("moderator"), MODERATOR_PERMISSIONS);
    assert.deepEqual(permissionsFor("admin"), [...PERMISSIONS]);

    const adminOnly: Permission[] = [
        "moderators:invite",
        "moderators:revoke",
        "invites:manage",
        "users:manage",
        "audit:read",
        "settings:manage",
    ];
    for (const permission of adminOnly) {
        assert.equal(can({ role: "moderator" }, permission), false, permission);
        assert.equal(can({ role: "admin" }, permission), true, permission);
    }
});

type Actor = "anonymous" | "user" | "unverifiedModerator" | "moderator" | "admin";

interface StaffRoute {
    method: "GET" | "PATCH" | "POST";
    url: string;
    payload?: Record<string, unknown>;
    /** Só ADMIN passa; MODERATOR recebe 403. */
    adminOnly?: boolean;
}

// Toda rota protegida por `staff(...)` precisa estar aqui.
const missingId = randomUUID();
const STAFF_ROUTES: StaffRoute[] = [
    { method: "GET", url: "/accidents/moderation/summary" },
    { method: "GET", url: "/accidents/moderation" },
    { method: "GET", url: `/accidents/moderation/${missingId}` },
    {
        method: "PATCH",
        url: `/accidents/moderation/${missingId}`,
        payload: { description: "Texto revisado" },
    },
    { method: "GET", url: "/accidents" },
    {
        method: "PATCH",
        url: `/accidents/${missingId}/moderation`,
        payload: { status: "APPROVED" },
    },
    {
        // Mensagem só com espaços: passa no schema, é recusada pelo serviço
        // (400) e não cria aviso nem dispara push.
        method: "POST",
        url: "/notifications/administrative-notices",
        payload: { message: "   " },
    },
    { method: "GET", url: "/admin/moderation-history" },
    { method: "GET", url: "/admin/moderation-history/moderators" },
    // Exclusivas de ADMIN. Nenhuma cria convite nem envia e-mail: as que
    // alteram algo usam um id inexistente (404 para quem tem permissão).
    { method: "GET", url: "/admin/moderator-invites", adminOnly: true },
    {
        method: "POST",
        url: `/admin/moderator-invites/${missingId}/resend`,
        adminOnly: true,
    },
    { method: "GET", url: "/admin/users", adminOnly: true },
    { method: "GET", url: `/admin/users/${missingId}`, adminOnly: true },
    {
        method: "POST",
        url: `/admin/users/${missingId}/suspend`,
        payload: { reason: "teste" },
        adminOnly: true,
    },
    { method: "POST", url: `/admin/users/${missingId}/reactivate`, adminOnly: true },
    { method: "POST", url: `/admin/users/${missingId}/sessions/revoke`, adminOnly: true },
    { method: "GET", url: "/admin/audit-logs", adminOnly: true },
    { method: "GET", url: "/admin/settings", adminOnly: true },
    // PATCH /admin/settings fica em admin-panel.test.ts: aqui ele alteraria
    // a configuração real do banco local.
    {
        method: "POST",
        url: `/admin/moderator-invites/${missingId}/revoke`,
        adminOnly: true,
    },
    { method: "GET", url: "/admin/moderators", adminOnly: true },
    {
        method: "POST",
        url: `/admin/moderators/${missingId}/revoke`,
        payload: { reason: "teste" },
        adminOnly: true,
    },
];

test("staff routes enforce authentication, verified email and permissions", async () => {
    const app = await buildApp();
    await app.ready();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const emails: string[] = [];
    const headers: Partial<Record<Actor, Record<string, string>>> = {
        anonymous: {},
    };
    let otherUserHeaders: Record<string, string> = {};
    let accidentId: string | undefined;

    async function registerAs(
        label: string,
        role: "user" | "moderator" | "admin",
        verified: boolean,
    ) {
        const email = `perm-${label}-${suffix}@example.com`;
        emails.push(email);
        const response = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { name: `Perm ${label}`, email, password: "Test12345!" },
        });
        assert.equal(response.statusCode, 201, response.body);
        const { user, tokens } = response.json().data;
        await prisma.user.update({
            where: { id: user.id },
            data: { role, is_email_verified: verified },
        });
        return { authorization: `Bearer ${tokens.accessToken}` };
    }

    try {
        headers.user = await registerAs("user", "user", true);
        headers.unverifiedModerator = await registerAs(
            "unverified-mod",
            "moderator",
            false,
        );
        headers.moderator = await registerAs("moderator", "moderator", true);
        headers.admin = await registerAs("admin", "admin", true);
        otherUserHeaders = await registerAs("other", "user", true);

        // /auth/me expõe as permissões calculadas a partir do papel do banco.
        const expectedMe: Array<[Actor, Permission[]]> = [
            ["user", []],
            ["moderator", MODERATOR_PERMISSIONS],
            ["admin", [...PERMISSIONS]],
        ];
        for (const [actor, permissions] of expectedMe) {
            const me = await app.inject({
                method: "GET",
                url: "/auth/me",
                headers: headers[actor],
            });
            assert.equal(me.statusCode, 200, `${actor}: ${me.body}`);
            assert.deepEqual(me.json().data.permissions, permissions, actor);
        }

        for (const route of STAFF_ROUTES) {
            const label = `${route.method} ${route.url}`;
            const call = (actor: Actor) =>
                app.inject({
                    method: route.method,
                    url: route.url,
                    headers: headers[actor],
                    ...(route.payload ? { payload: route.payload } : {}),
                });

            const anonymous = await call("anonymous");
            assert.equal(anonymous.statusCode, 401, `anonymous ${label}`);

            const user = await call("user");
            assert.equal(user.statusCode, 403, `user ${label}`);
            assert.equal(
                user.json().error.code,
                "AUTH_MISSING_PERMISSION",
                `user ${label}`,
            );

            const unverified = await call("unverifiedModerator");
            assert.equal(unverified.statusCode, 403, `unverified ${label}`);
            assert.equal(
                unverified.json().error.code,
                "AUTH_EMAIL_NOT_VERIFIED",
                `unverified ${label}`,
            );

            const moderatorResponse = await call("moderator");
            if (route.adminOnly) {
                assert.equal(moderatorResponse.statusCode, 403, `moderator ${label}`);
                assert.equal(
                    moderatorResponse.json().error.code,
                    "AUTH_MISSING_PERMISSION",
                    `moderator ${label}`,
                );
            } else {
                assert.ok(
                    moderatorResponse.statusCode !== 401 &&
                        moderatorResponse.statusCode !== 403,
                    `moderator ${label} → ${moderatorResponse.statusCode} ${moderatorResponse.body}`,
                );
            }

            const adminResponse = await call("admin");
            assert.ok(
                adminResponse.statusCode !== 401 && adminResponse.statusCode !== 403,
                `admin ${label} → ${adminResponse.statusCode} ${adminResponse.body}`,
            );
        }

        // Staff mantém o poder de editar relato de terceiros pela rota pública;
        // outro usuário comum continua sem poder.
        const created = await app.inject({
            method: "POST",
            url: "/accidents",
            headers: headers.user,
            payload: {
                tipo_acidente: `perm-${suffix}`,
                classificacao_acidente: "sem_vitima",
                condicao_meteorologica: "ceu_claro",
                description: "Relato para teste de permissões",
                latitude: -5.52,
                longitude: -47.47,
                occurredAt: "2026-11-10T12:00:00.000Z",
                severity: "low",
            },
        });
        assert.equal(created.statusCode, 201, created.body);
        accidentId = created.json().data.id as string;

        const strangerEdit = await app.inject({
            method: "PATCH",
            url: `/accidents/${accidentId}`,
            headers: otherUserHeaders,
            payload: { description: "Tentativa indevida" },
        });
        assert.equal(strangerEdit.statusCode, 403);
        assert.equal(strangerEdit.json().error.code, "ACCIDENT_FORBIDDEN");

        const moderatorEdit = await app.inject({
            method: "PATCH",
            url: `/accidents/${accidentId}`,
            headers: headers.moderator,
            payload: { description: "Revisado pela moderação" },
        });
        assert.equal(moderatorEdit.statusCode, 200, moderatorEdit.body);
    } finally {
        if (accidentId) {
            await prisma.accident.deleteMany({ where: { id: accidentId } });
        }
        // A edição feita pelo moderador gera auditoria, que referencia a conta.
        const testUsers = await prisma.user.findMany({
            where: { email: { in: emails } },
            select: { id: true },
        });
        await purgeStaffTrail(testUsers.map((user) => user.id));
        await prisma.user.deleteMany({ where: { email: { in: emails } } });
        await app.close();
    }
});
