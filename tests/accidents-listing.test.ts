import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
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

test("GET /accidents converts query filters and rejects invalid ones", async () => {
    const app = await buildApp({ rateLimit: false });
    await app.ready();

    const marker = `__listing_http_${Date.now()}__`;
    let userId: string | undefined;

    try {
        const register = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                acceptedTermsVersion: "2026-11-15",
                name: "Listing Staff",
                email: `listing-staff-${Date.now()}@example.com`,
                password: "Test12345!",
            },
        });
        assert.equal(register.statusCode, 201, register.body);
        userId = register.json().data.user.id as string;
        await prisma.user.update({
            where: { id: userId },
            data: { role: "moderator", is_email_verified: true },
        });
        const headers = {
            authorization: `Bearer ${register.json().data.tokens.accessToken}`,
        };

        await prisma.accident.createMany({
            data: [
                {
                    tipo_acidente: `${marker} inside`,
                    latitude: -5.5,
                    longitude: -47.5,
                    occurred_at: new Date("2026-08-01T10:00:00.000Z"),
                    severity: "low",
                },
                {
                    tipo_acidente: `${marker} outside`,
                    latitude: -23.5,
                    longitude: -46.6,
                    occurred_at: new Date("2026-08-01T10:00:00.000Z"),
                    severity: "low",
                },
            ],
        });

        // Os números da query chegam convertidos ao filtro (antes: 500).
        const inArea = await app.inject({
            method: "GET",
            url: `/accidents?search=${encodeURIComponent(marker)}&minLat=-6&maxLat=-5&minLng=-48&maxLng=-47&page=1&limit=5`,
            headers,
        });
        assert.equal(inArea.statusCode, 200, inArea.body);
        assert.deepEqual(
            inArea.json().data.map((item: { tipo_acidente: string }) => item.tipo_acidente),
            [`${marker} inside`],
        );
        assert.deepEqual(inArea.json().pagination, {
            page: 1,
            limit: 5,
            total: 1,
            totalPages: 1,
        });

        // page/limit fora da faixa continuam sendo ajustados pelo service.
        const clamped = await app.inject({
            method: "GET",
            url: `/accidents?search=${encodeURIComponent(marker)}&page=0&limit=100`,
            headers,
        });
        assert.equal(clamped.statusCode, 200);
        assert.equal(clamped.json().pagination.page, 1);
        assert.equal(clamped.json().pagination.limit, 50);

        for (const query of ["minLat=abc", "minLat=-91", "status=XYZ", "from=ontem"]) {
            const invalid = await app.inject({
                method: "GET",
                url: `/accidents?${query}`,
                headers,
            });
            assert.equal(invalid.statusCode, 400, query);
            assert.equal(invalid.json().error.code, "VALIDATION_ERROR");
        }
    } finally {
        await prisma.accident.deleteMany({
            where: { tipo_acidente: { contains: marker } },
        });
        if (userId) {
            await prisma.refreshToken.deleteMany({ where: { user_id: userId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await app.close();
    }
});
