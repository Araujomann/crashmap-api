import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/shared/database/prisma.js";

test("moderation keeps app reports private until approved and audits decisions", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const marker = `moderation-${uniqueSuffix}`;
    const email = `${marker}@example.com`;
    const password = "Test12345!";
    let userId: string | undefined;
    let pendingAccidentId: string | undefined;
    let approvedAccidentId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: { name: `Moderator ${uniqueSuffix}`, email, password },
        });

        assert.equal(registerResponse.statusCode, 201);
        const user = registerResponse.json().data.user;
        const accessToken = registerResponse.json().data.tokens
            .accessToken as string;
        userId = user.id as string;

        await prisma.user.update({
            where: { id: userId },
            data: { role: "moderator", is_email_verified: true },
        });
        const headers = { authorization: `Bearer ${accessToken}` };

        const pushTokenRegistration = await app.inject({
            method: "PUT",
            url: "/notifications/push-token",
            headers,
            payload: {
                token: `ExponentPushToken[${marker}]`,
                platform: "ios",
            },
        });
        assert.equal(pushTokenRegistration.statusCode, 200);

        const pendingCreate = await app.inject({
            method: "POST",
            url: "/accidents",
            headers,
            payload: {
                tipo_acidente: `${marker}-pending`,
                classificacao_acidente: "sem_vitima",
                condicao_meteorologica: "ceu_claro",
                description: "Relato privado até aprovação",
                latitude: -23.55,
                longitude: -46.63,
                occurredAt: "2026-11-09T12:00:00.000Z",
                severity: "medium",
            },
        });

        assert.equal(pendingCreate.statusCode, 201);
        pendingAccidentId = pendingCreate.json().data.id as string;
        assert.equal(pendingCreate.json().data.moderation_status, "PENDING");

        const pendingMap = await app.inject({
            method: "GET",
            url: "/accidents/map",
        });
        assert.equal(
            pendingMap.json().data.some(
                (accident: { id: string }) => accident.id === pendingAccidentId,
            ),
            false,
        );

        const pendingPublicDetail = await app.inject({
            method: "GET",
            url: `/accidents/${pendingAccidentId}`,
        });
        assert.equal(pendingPublicDetail.statusCode, 404);

        const pendingList = await app.inject({
            method: "GET",
            url: "/accidents/moderation?status=PENDING&search=moderation-",
            headers,
        });
        assert.equal(pendingList.statusCode, 200);
        assert.ok(
            pendingList
                .json()
                .data.some(
                    (accident: { id: string }) =>
                        accident.id === pendingAccidentId,
                ),
        );

        const edited = await app.inject({
            method: "PATCH",
            url: `/accidents/moderation/${pendingAccidentId}`,
            headers,
            payload: {
                tipo_acidente: `${marker}-corrigido`,
                description: "Descrição revisada pela moderação.",
            },
        });
        assert.equal(edited.statusCode, 200);
        assert.equal(
            edited.json().data.tipo_acidente,
            `${marker}-corrigido`,
        );
        assert.equal(
            edited.json().data.description,
            "Descrição revisada pela moderação.",
        );
        assert.equal(edited.json().data.moderation_status, "PENDING");
        assert.equal(edited.json().data.moderation_history.length, 0);

        const rejected = await app.inject({
            method: "PATCH",
            url: `/accidents/${pendingAccidentId}/moderation`,
            headers,
            payload: {
                status: "REJECTED",
                publicMessage: "Não há informações suficientes para confirmar.",
                internalNote: "Conferir divergência com equipe local.",
            },
        });
        assert.equal(rejected.statusCode, 200);
        assert.equal(rejected.json().data.moderation_status, "REJECTED");
        assert.equal(
            rejected.json().data.moderation_history[0].internal_note,
            "Conferir divergência com equipe local.",
        );
        assert.equal(rejected.json().data.moderation_history.length, 1);

        const editAfterDecision = await app.inject({
            method: "PATCH",
            url: `/accidents/moderation/${pendingAccidentId}`,
            headers,
            payload: { description: "Edição após decisão." },
        });
        assert.equal(editAfterDecision.statusCode, 409);

        const myRejectedReports = await app.inject({
            method: "GET",
            url: "/users/me/reports?status=REJECTED",
            headers,
        });
        assert.equal(myRejectedReports.statusCode, 200);
        const myRejectedReport = myRejectedReports
            .json()
            .data.find(
                (report: { id: string }) => report.id === pendingAccidentId,
            );
        assert.equal(
            myRejectedReport.moderation_message,
            "Não há informações suficientes para confirmar.",
        );
        assert.equal("moderation_internal_note" in myRejectedReport, false);

        const duplicateDecision = await app.inject({
            method: "PATCH",
            url: `/accidents/${pendingAccidentId}/moderation`,
            headers,
            payload: {
                status: "APPROVED",
                publicMessage: "Decisão duplicada",
            },
        });
        assert.equal(duplicateDecision.statusCode, 409);

        const approvedCreate = await app.inject({
            method: "POST",
            url: "/accidents",
            headers,
            payload: {
                tipo_acidente: `${marker}-approved`,
                classificacao_acidente: "com_vitima",
                condicao_meteorologica: "chuva",
                description: "Relato aprovado para o mapa",
                latitude: -23.56,
                longitude: -46.64,
                occurredAt: "2026-11-09T12:30:00.000Z",
                severity: "high",
            },
        });
        assert.equal(approvedCreate.statusCode, 201);
        approvedAccidentId = approvedCreate.json().data.id as string;

        const pushedMessages: Array<{
            data?: { type?: string; accidentId?: string };
        }> = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (
            input: RequestInfo | URL,
            init?: RequestInit,
        ) => {
            if (String(input) !== "https://exp.host/--/api/v2/push/send") {
                return originalFetch(input, init);
            }

            const messages = JSON.parse(
                String(init?.body),
            ) as typeof pushedMessages;
            pushedMessages.push(...messages);
            return new Response(
                JSON.stringify({
                    data: messages.map(() => ({ status: "ok" })),
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            );
        };
        try {
            const approved = await app.inject({
                method: "PATCH",
                url: `/accidents/${approvedAccidentId}/moderation`,
                headers,
                payload: {
                    status: "APPROVED",
                    internalNote: "Verificado pela equipe.",
                },
            });
            assert.equal(approved.statusCode, 200);
            assert.equal(approved.json().data.moderation_status, "APPROVED");
        } finally {
            globalThis.fetch = originalFetch;
        }
        assert.ok(pushedMessages.length > 0);
        assert.ok(
            pushedMessages.every(
                (message) =>
                    message.data?.type === "ACCIDENT_APPROVED" &&
                    message.data.accidentId === approvedAccidentId,
            ),
        );

        const myApprovedReports = await app.inject({
            method: "GET",
            url: "/users/me/reports?status=APPROVED",
            headers,
        });
        assert.equal(myApprovedReports.statusCode, 200);
        assert.ok(
            myApprovedReports
                .json()
                .data.some(
                    (report: { id: string }) =>
                        report.id === approvedAccidentId,
                ),
        );

        const map = await app.inject({
            method: "GET",
            url: "/accidents/map",
        });
        assert.ok(
            map.json().data.some(
                (accident: { id: string }) => accident.id === approvedAccidentId,
            ),
        );
        assert.equal(
            map.json().data.some(
                (accident: { id: string }) => accident.id === pendingAccidentId,
            ),
            false,
        );

        const publicDetail = await app.inject({
            method: "GET",
            url: `/accidents/${approvedAccidentId}`,
        });
        assert.equal(publicDetail.statusCode, 200);
        assert.equal(
            "moderation_internal_note" in publicDetail.json().data,
            false,
        );

        const missingAuth = await app.inject({
            method: "GET",
            url: "/users/me/reports",
        });
        assert.equal(missingAuth.statusCode, 401);
    } finally {
        const accidentIds = [pendingAccidentId, approvedAccidentId].filter(
            (id): id is string => Boolean(id),
        );
        if (accidentIds.length > 0) {
            await prisma.accidentModerationHistory.deleteMany({
                where: { accident_id: { in: accidentIds } },
            });
            await prisma.accidentComment.deleteMany({
                where: { accident_id: { in: accidentIds } },
            });
            await prisma.accidentImage.deleteMany({
                where: { accident_id: { in: accidentIds } },
            });
            await prisma.accident.deleteMany({
                where: { id: { in: accidentIds } },
            });
        }
        if (userId) {
            await prisma.refreshToken.deleteMany({ where: { user_id: userId } });
            await prisma.pushToken.deleteMany({ where: { user_id: userId } });
            await prisma.user.delete({ where: { id: userId } });
        }
        await app.close();
    }
});
