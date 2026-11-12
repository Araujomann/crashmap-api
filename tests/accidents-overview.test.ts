import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { getAccidentOverview } from "../src/modules/accidents/accidents.service.js";
import { prisma } from "../src/shared/database/prisma.js";

test("getAccidentOverview aggregates only approved accidents", async () => {
    const marker = "__overview_test__";
    await prisma.accident.deleteMany({
        where: { tipo_acidente: { startsWith: marker } },
    });

    const now = new Date();
    const before = await getAccidentOverview(now);

    try {
        await prisma.accident.createMany({
            data: [
                {
                    tipo_acidente: `${marker} current`,
                    classificacao_acidente: "com_vitima",
                    condicao_meteorologica: "ceu_claro",
                    latitude: -5.52693,
                    longitude: -47.47812,
                    occurred_at: new Date(now.getTime() - 60 * 60 * 1000),
                    severity: "critical",
                    moderation_status: "APPROVED",
                },
                {
                    tipo_acidente: `${marker} previous`,
                    classificacao_acidente: "sem_vitima",
                    condicao_meteorologica: "chuva",
                    latitude: -5.52693,
                    longitude: -47.47812,
                    occurred_at: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
                    severity: "high",
                    moderation_status: "APPROVED",
                },
                {
                    tipo_acidente: `${marker} pending`,
                    classificacao_acidente: "com_vitima",
                    condicao_meteorologica: "nublado",
                    latitude: -5.52693,
                    longitude: -47.47812,
                    occurred_at: new Date(now.getTime() - 30 * 60 * 1000),
                    severity: "medium",
                    moderation_status: "PENDING",
                },
            ],
        });

        const after = await getAccidentOverview(now);

        assert.equal(
            after.approved_accidents_count - before.approved_accidents_count,
            2,
        );
        assert.equal(
            after.accidents_with_victims_count -
                before.accidents_with_victims_count,
            1,
        );
        assert.equal(
            after.high_severity_accidents_count -
                before.high_severity_accidents_count,
            2,
        );
        assert.equal(
            after.current_30_days_count - before.current_30_days_count,
            1,
        );
        assert.equal(
            after.previous_30_days_count - before.previous_30_days_count,
            1,
        );
        assert.equal(
            after.time_of_day.reduce((total, period) => total + period.count, 0) -
                before.time_of_day.reduce(
                    (total, period) => total + period.count,
                    0,
                ),
            1,
        );
        assert.ok(
            after.recent_accidents.some((accident) =>
                accident.tipo_acidente.includes(`${marker} current`),
            ),
        );
        assert.ok(
            !after.recent_accidents.some((accident) =>
                accident.tipo_acidente.includes(`${marker} pending`),
            ),
        );
    } finally {
        await prisma.accident.deleteMany({
            where: { tipo_acidente: { startsWith: marker } },
        });
    }
});

test("GET /accidents/overview returns the public dashboard response", async () => {
    const app = await buildApp();

    try {
        const response = await app.inject({
            method: "GET",
            url: "/accidents/overview",
        });
        const body = response.json() as {
            data?: {
                time_of_day?: unknown[];
                recent_accidents?: unknown[];
            };
        };

        assert.equal(response.statusCode, 200);
        assert.equal(body.data?.time_of_day?.length, 8);
        assert.ok(Array.isArray(body.data?.recent_accidents));
    } finally {
        await app.close();
    }
});
