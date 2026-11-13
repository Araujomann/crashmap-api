import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/shared/errors/app-error.js";
import {
    buildPaginationMeta,
    resolvePagination,
} from "../src/shared/http/pagination.js";
import {
    generateSixDigitCode,
    hmacSha256Hex,
    sha256Hex,
} from "../src/shared/security/crypto.js";
import {
    DAY_MS,
    dayRangeFilter,
    parseUtcDay,
    resolveUtcDayRange,
} from "../src/shared/utils/date-range.js";
import { normalizeEmail } from "../src/shared/utils/email.js";
import { escapeHtml } from "../src/shared/utils/html.js";

test("resolvePagination clamps page and limit and computes skip", () => {
    assert.deepEqual(resolvePagination({}, 20), { page: 1, limit: 20, skip: 0 });
    assert.deepEqual(resolvePagination({ page: 3, limit: 10 }, 20), {
        page: 3,
        limit: 10,
        skip: 20,
    });
    assert.deepEqual(resolvePagination({ page: 0, limit: 0 }, 20), {
        page: 1,
        limit: 1,
        skip: 0,
    });
    assert.deepEqual(resolvePagination({ page: -2, limit: 500 }, 10), {
        page: 1,
        limit: 50,
        skip: 0,
    });
});

test("buildPaginationMeta always reports at least one page", () => {
    assert.deepEqual(buildPaginationMeta({ page: 1, limit: 10 }, 0), {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 1,
    });
    assert.deepEqual(buildPaginationMeta({ page: 2, limit: 10 }, 21), {
        page: 2,
        limit: 10,
        total: 21,
        totalPages: 3,
    });
});

test("parseUtcDay and resolveUtcDayRange keep inclusive UTC days", () => {
    assert.equal(parseUtcDay("2026-01-31")?.toISOString(), "2026-01-31T00:00:00.000Z");
    assert.equal(parseUtcDay("not-a-date"), null);

    const range = resolveUtcDayRange({ from: "2026-01-01", to: "2026-01-01" }, () => {
        throw new Error("unexpected");
    });
    assert.equal(range.from?.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(range.toExclusive?.getTime(), range.from!.getTime() + DAY_MS);
    assert.deepEqual(dayRangeFilter(range), {
        gte: range.from,
        lt: range.toExclusive,
    });
    assert.equal(dayRangeFilter({}), undefined);
    assert.deepEqual(resolveUtcDayRange({}, () => new Error("unused")), {
        from: undefined,
        toExclusive: undefined,
    });
});

test("resolveUtcDayRange delegates invalid dates and rejects inverted ranges", () => {
    assert.throws(
        () =>
            resolveUtcDayRange({ from: "2026-01-01", to: "bad" }, (field) =>
                new AppError(`Invalid ${field} date`, 400, "INVALID_DATE_RANGE"),
            ),
        { message: "Invalid to date", code: "INVALID_DATE_RANGE" },
    );
    assert.throws(
        () =>
            resolveUtcDayRange(
                { from: "2026-02-01", to: "2026-01-01" },
                () => new Error("unused"),
            ),
        {
            message: "The start date must be before the end date",
            statusCode: 400,
            code: "INVALID_DATE_RANGE",
        },
    );
});

test("escapeHtml, normalizeEmail and crypto helpers", () => {
    assert.equal(
        escapeHtml(`<a href="x">Tom & 'Jerry'</a>`),
        "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
    assert.equal(normalizeEmail("  Ana@Exemplo.COM "), "ana@exemplo.com");
    assert.equal(
        hmacSha256Hex("secret", "data"),
        "1b2c16b75bd2a870c114153ccda5bcfca63314bc722fa160d690de133ccbb9db",
    );
    assert.equal(
        sha256Hex("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    for (let i = 0; i < 50; i += 1) {
        assert.match(generateSixDigitCode(), /^\d{6}$/);
    }
});
