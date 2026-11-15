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
    // Só os registros deste teste: outros testes criam e apagam acidentes
    // aprovados em paralelo no mesmo banco, o que distorceria totais globais.
    const scope = { tipo_acidente: { startsWith: marker } };

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

        const overview = await getAccidentOverview(now, scope);

        assert.equal(overview.approved_accidents_count, 2);
        assert.equal(overview.accidents_with_victims_count, 1);
        assert.equal(overview.high_severity_accidents_count, 2);
        assert.equal(overview.current_30_days_count, 1);
        assert.equal(overview.previous_30_days_count, 1);
        assert.equal(
            overview.time_of_day.reduce((total, period) => total + period.count, 0),
            1,
        );
        assert.deepEqual(
            overview.recent_accidents.map((accident) => accident.tipo_acidente),
            [`${marker} current`, `${marker} previous`],
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
