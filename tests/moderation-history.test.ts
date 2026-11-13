import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";
import { purgeModerationHistory } from "./helpers/moderation-history.js";

function isoDay(offsetDays: number) {
    return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
}

test("moderation history is queryable, append-only and survives account removal", async () => {
    const app = await buildApp();
    await app.ready();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const password = "Test12345!";
    const emails: string[] = [];
    const accidentIds: string[] = [];
    const userIds: string[] = [];

    async function register(
        label: string,
        role: "user" | "moderator" | "admin",
    ) {
        const email = `history-${label}-${suffix}@example.com`;
        emails.push(email);
        const response = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { name: `History ${label}`, email, password },
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

    try {
        const reporter = await register("reporter", "user");
        const moderator = await register("moderator", "moderator");
        const admin = await register("admin", "admin");

        // Dois relatos rejeitados pelo mesmo moderador. Rejeitar (e não
        // aprovar) evita disparar notificações push durante o teste.
        for (const label of ["first", "second"]) {
            const created = await app.inject({
                method: "POST",
                url: "/accidents",
                headers: reporter.headers,
                payload: {
                    tipo_acidente: `history-${label}-${suffix}`,
                    classificacao_acidente: "sem_vitima",
                    condicao_meteorologica: "ceu_claro",
                    latitude: -5.52,
                    longitude: -47.47,
                    occurredAt: "2026-11-10T12:00:00.000Z",
                    severity: "medium",
                },
            });
            assert.equal(created.statusCode, 201, created.body);
            const accidentId = created.json().data.id as string;
            accidentIds.push(accidentId);

            const decision = await app.inject({
                method: "PATCH",
                url: `/accidents/${accidentId}/moderation`,
                headers: moderator.headers,
                payload: {
                    status: "REJECTED",
                    publicMessage: `Motivo ${label}`,
                    internalNote: `Nota ${label}`,
                },
            });
            assert.equal(decision.statusCode, 200, decision.body);
        }

        const historyUrl = `/admin/moderation-history?moderatorId=${moderator.id}`;

        // Autorização
        const anonymous = await app.inject({ method: "GET", url: historyUrl });
        assert.equal(anonymous.statusCode, 401);
        for (const url of [historyUrl, "/admin/moderation-history/moderators"]) {
            const forbidden = await app.inject({
                method: "GET",
                url,
                headers: reporter.headers,
            });
            assert.equal(forbidden.statusCode, 403, url);
            assert.equal(forbidden.json().error.code, "AUTH_MISSING_PERMISSION");
        }

        // Listagem e filtros
        const all = await app.inject({
            method: "GET",
            url: historyUrl,
            headers: moderator.headers,
        });
        assert.equal(all.statusCode, 200, all.body);
        const allBody = all.json();
        assert.equal(allBody.pagination.total, 2);
        assert.deepEqual(
            allBody.data.map((entry: { accident: { id: string } }) => entry.accident.id),
            [...accidentIds].reverse(),
            "mais recentes primeiro",
        );
        const [latest] = allBody.data;
        assert.equal(latest.previous_status, "PENDING");
        assert.equal(latest.new_status, "REJECTED");
        assert.equal(latest.public_message, "Motivo second");
        assert.equal(latest.internal_note, "Nota second");
        assert.deepEqual(latest.moderated_by, {
            id: moderator.id,
            name: "History moderator",
            email: emails[1],
            is_deleted: false,
        });
        assert.equal(latest.accident.tipo_acidente, `history-second-${suffix}`);

        const filtered = async (query: string) => {
            const response = await app.inject({
                method: "GET",
                url: `${historyUrl}&${query}`,
                headers: admin.headers,
            });
            assert.equal(response.statusCode, 200, `${query}: ${response.body}`);
            return response.json().pagination.total as number;
        };
        assert.equal(await filtered("status=APPROVED"), 0);
        assert.equal(await filtered("status=REJECTED"), 2);
        assert.equal(await filtered(`accidentId=${accidentIds[0]}`), 1);
        assert.equal(await filtered(`from=${isoDay(-1)}&to=${isoDay(1)}`), 2);
        assert.equal(await filtered(`to=${isoDay(-2)}`), 0);
        assert.equal(await filtered("limit=1&page=2"), 2);

        const invalidRange = await app.inject({
            method: "GET",
            url: `${historyUrl}&from=${isoDay(1)}&to=${isoDay(-1)}`,
            headers: admin.headers,
        });
        assert.equal(invalidRange.statusCode, 400);
        assert.equal(invalidRange.json().error.code, "INVALID_DATE_RANGE");

        const moderators = await app.inject({
            method: "GET",
            url: "/admin/moderation-history/moderators",
            headers: moderator.headers,
        });
        assert.equal(moderators.statusCode, 200, moderators.body);
        const listed = moderators
            .json()
            .data.find((item: { id: string }) => item.id === moderator.id);
        assert.equal(listed?.decisions_count, 2);

        // Somente-inserção no banco
        await assert.rejects(
            prisma.accidentModerationHistory.updateMany({
                where: { accident_id: accidentIds[0] },
                data: { public_message: "adulterado" },
            }),
        );
        await assert.rejects(
            prisma.accidentModerationHistory.deleteMany({
                where: { accident_id: accidentIds[0] },
            }),
        );

        // Ex-moderador que apaga a conta é anonimizado, sem erro 500, e a
        // autoria das decisões continua rastreável.
        await prisma.user.update({
            where: { id: moderator.id },
            data: { role: "user" },
        });
        const deleted = await app.inject({
            method: "DELETE",
            url: "/users/me",
            headers: moderator.headers,
            payload: { password },
        });
        assert.equal(deleted.statusCode, 204, deleted.body);

        const anonymized = await prisma.user.findUniqueOrThrow({
            where: { id: moderator.id },
        });
        assert.equal(anonymized.name, "Conta removida");
        assert.equal(anonymized.email, `deleted+${moderator.id}@invalid.local`);
        assert.equal(anonymized.password_hash, null);
        assert.ok(anonymized.deleted_at);
        assert.equal(
            await prisma.refreshToken.count({ where: { user_id: moderator.id } }),
            0,
        );

        const staleToken = await app.inject({
            method: "GET",
            url: "/auth/me",
            headers: moderator.headers,
        });
        assert.equal(staleToken.statusCode, 401);

        const afterRemoval = await app.inject({
            method: "GET",
            url: historyUrl,
            headers: admin.headers,
        });
        assert.equal(afterRemoval.json().pagination.total, 2);
        assert.deepEqual(afterRemoval.json().data[0].moderated_by, {
            id: moderator.id,
            name: "Conta removida",
            email: `deleted+${moderator.id}@invalid.local`,
            is_deleted: true,
        });
    } finally {
        await purgeModerationHistory(accidentIds);
        await prisma.accident.deleteMany({ where: { id: { in: accidentIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await app.close();
    }
});
