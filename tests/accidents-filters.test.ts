import assert from "node:assert/strict";
import test from "node:test";
import {
    accidentPeriodAndAreaFilter,
    accidentTextSearchFilter,
} from "../src/modules/accidents/accidents.filters.js";

test("accidentTextSearchFilter searches title and description", () => {
    assert.deepEqual(accidentTextSearchFilter(undefined), {});
    assert.deepEqual(accidentTextSearchFilter(""), {});
    assert.deepEqual(accidentTextSearchFilter("colisão"), {
        OR: [
            { tipo_acidente: { contains: "colisão", mode: "insensitive" } },
            { description: { contains: "colisão", mode: "insensitive" } },
        ],
    });
});

test("accidentPeriodAndAreaFilter only adds the informed bounds", () => {
    assert.deepEqual(accidentPeriodAndAreaFilter({}), {});

    assert.deepEqual(
        accidentPeriodAndAreaFilter({
            from: "2026-01-01T00:00:00.000Z",
            minLat: -6,
            maxLng: -47,
        }),
        {
            occurred_at: { gte: new Date("2026-01-01T00:00:00.000Z") },
            latitude: { gte: -6 },
            longitude: { lte: -47 },
        },
    );

    assert.deepEqual(
        accidentPeriodAndAreaFilter({
            from: "2026-01-01T00:00:00.000Z",
            to: "2026-02-01T00:00:00.000Z",
            minLat: 0,
            maxLat: 0,
            minLng: -48,
            maxLng: -47,
        }),
        {
            occurred_at: {
                gte: new Date("2026-01-01T00:00:00.000Z"),
                lte: new Date("2026-02-01T00:00:00.000Z"),
            },
            latitude: { gte: 0, lte: 0 },
            longitude: { gte: -48, lte: -47 },
        },
    );
});
