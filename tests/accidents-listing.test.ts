import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/shared/database/prisma.js";
import { listAccidents } from "../src/modules/accidents/accidents.service.js";

test("listAccidents supports pagination, search, and severity filters", async () => {
    const marker = "__pagination_test__";

    await prisma.accident.deleteMany({
        where: {
            OR: [
                { tipo_acidente: { contains: marker } },
                { description: { contains: marker } },
            ],
        },
    });

    await prisma.accident.createMany({
        data: [
            {
                tipo_acidente: `${marker} one`,
                classificacao_acidente: "com_vitima",
                condicao_meteorologica: "ceu_claro",
                description: `${marker} description`,
                latitude: -23.5,
                longitude: -46.6,
                occurred_at: new Date("2026-08-01T10:00:00.000Z"),
                severity: "medium",
            },
            {
                tipo_acidente: `${marker} two`,
                classificacao_acidente: "sem_vitima",
                condicao_meteorologica: "chuva",
                description: `${marker} description`,
                latitude: -22.9,
                longitude: -47.1,
                occurred_at: new Date("2026-08-02T10:00:00.000Z"),
                severity: "high",
            },
        ],
    });

    try {
        const result = await listAccidents({
            page: 1,
            limit: 1,
            search: marker,
            severity: "medium",
            sort: "newest",
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-01T23:59:59.000Z",
            minLat: -24,
            maxLat: -23,
            minLng: -47,
            maxLng: -46,
        });

        assert.equal(result.data.length, 1);
        assert.equal(result.pagination.page, 1);
        assert.equal(result.pagination.limit, 1);
        assert.equal(result.pagination.total, 1);
        assert.equal(result.pagination.totalPages, 1);
        assert.ok(result.data[0].tipo_acidente.includes(marker));
        assert.equal(result.data[0].severity, "medium");
    } finally {
        await prisma.accident.deleteMany({
            where: {
                OR: [
                    { tipo_acidente: { contains: marker } },
                    { description: { contains: marker } },
                ],
            },
        });
    }
});
