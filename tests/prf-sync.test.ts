import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/shared/database/prisma.js";
import { listAccidentsForMap } from "../src/modules/accidents/accidents.service.js";
import {
    getAccidentForModeration,
    listAccidentsForModeration,
} from "../src/modules/accidents/accident-moderation.service.js";
import { parseYearList } from "../src/modules/prf-sync/prf-sync.cli.js";
import { mapPrfRow, parseDateAndHour } from "../src/modules/prf-sync/prf-mapper.js";
import { parsePrfCatalog, toDownloadUrl } from "../src/modules/prf-sync/prf-source.js";
import {
    PrfSyncLockedError,
    runPrfSync,
    type PrfSyncDeps,
} from "../src/modules/prf-sync/prf-sync.service.js";
import type { PrfSyncLogger } from "../src/modules/prf-sync/prf-sync.types.js";

// Anos fictícios, para não tocar nos dados reais da PRF na base de teste.
const YEAR = 2099;
const OTHER_YEAR = 2098;
const CATALOG_URL = "https://prf.test/catalogo";

const HEADER =
    '"id";"data_inversa";"dia_semana";"horario";"uf";"br";"km";"municipio";"causa_acidente";"tipo_acidente";"classificacao_acidente";"fase_dia";"sentido_via";"condicao_metereologica";"tipo_pista";"tracado_via";"uso_solo";"pessoas";"mortos";"feridos_leves";"feridos_graves";"ilesos";"ignorados";"feridos";"veiculos";"latitude";"longitude";"regional";"delegacia";"uop"';

interface RowInput {
    id: string;
    date?: string;
    time?: string;
    uf?: string;
    municipio?: string;
    causa?: string;
    tipo?: string;
    clima?: string;
    mortos?: number;
    leves?: number;
    graves?: number;
    veiculos?: number;
    lat?: string;
    lng?: string;
}

function csvRow(row: RowInput, year = YEAR): string {
    return [
        row.id,
        row.date ?? `${year}-03-09`,
        '"segunda-feira"',
        `"${row.time ?? "12:15:00"}"`,
        `"${row.uf ?? "MA"}"`,
        "10",
        "252,4",
        `"${row.municipio ?? "IMPERATRIZ"}"`,
        `"${row.causa ?? "Reação tardia ou ineficiente do condutor"}"`,
        `"${row.tipo ?? "Colisão traseira"}"`,
        '"Sem Vítimas"',
        '"Pleno dia"',
        '"Crescente"',
        `"${row.clima ?? "Céu Claro"}"`,
        '"Múltipla"',
        '"Reta;Retorno Regulamentado"',
        '"Sim"',
        "2",
        String(row.mortos ?? 0),
        String(row.leves ?? 0),
        String(row.graves ?? 0),
        "2",
        "0",
        "0",
        String(row.veiculos ?? 2),
        row.lat ?? "-5,5267534",
        row.lng ?? "-47,4714984",
        '"SPRF-MA"',
        '"DEL04-MA"',
        '"UOP01-DEL04-MA"',
    ].join(";");
}

/** CSV como a PRF publica: Windows-1252, CRLF. */
function prfCsv(rows: string[], header = HEADER): Buffer {
    return Buffer.from([header, ...rows].join("\r\n") + "\r\n", "latin1");
}

function catalogHtml(links: Record<number, string>): string {
    const rows = Object.entries(links)
        .map(
            ([year, id]) =>
                `<tr class=""><td class="left aligned"><p>Documento CSV de Acidentes ${year} (Agrupados por ocorrência)</p></td>` +
                `<td><p><a href="https://drive.google.com/file/d/${id}/view?usp=sharing/download" target="_blank" class="external">Baixar planilha</a></p></td></tr>` +
                `<tr class=""><td><p>Documento CSV de Acidentes ${year} (Agrupados por pessoa)</p></td>` +
                `<td><p><a href="https://drive.google.com/file/d/pessoa${year}/view">Baixar planilha</a></p></td></tr>`,
        )
        .join("");
    return `<html><body><table><tbody>${rows}</tbody></table></body></html>`;
}

interface FakeFile {
    body: Buffer | string;
    fileName: string;
    lastModified: string;
    contentType?: string;
    status?: number;
}

/** Fonte PRF simulada: catálogo + arquivos do "Google Drive". */
class FakePrf {
    catalog: string | Error | number = catalogHtml({ [YEAR]: `file${YEAR}` });
    files = new Map<string, FakeFile | Error>();
    calls: Array<{ method: string; url: string }> = [];

    fetch: NonNullable<PrfSyncDeps["fetch"]> = async (url, init) => {
        const method = init?.method ?? "GET";
        this.calls.push({ method, url });

        if (url === CATALOG_URL) {
            if (this.catalog instanceof Error) throw this.catalog;
            if (typeof this.catalog === "number") return new Response("erro", { status: this.catalog });
            return new Response(this.catalog, { headers: { "content-type": "text/html" } });
        }

        const id = new URL(url).searchParams.get("id") ?? "";
        const file = this.files.get(id);
        if (file instanceof Error) throw file;
        if (!file) return new Response("not found", { status: 404 });
        const headers = {
            "content-type": file.contentType ?? "application/octet-stream",
            "content-disposition": `attachment; filename="${file.fileName}"`,
            "content-length": String(Buffer.byteLength(file.body)),
            "last-modified": file.lastModified,
        };
        if (file.status && file.status >= 400) return new Response("erro", { status: file.status });
        return new Response(method === "HEAD" ? null : file.body, { headers });
    };

    publish(year: number, rows: string[], lastModified: string, options: Partial<FakeFile> = {}) {
        this.files.set(`file${year}`, {
            body: prfCsv(rows),
            fileName: `datatran${year}.csv`,
            lastModified,
            ...options,
        });
    }

    downloads(year: number) {
        return this.calls.filter((call) => call.method === "GET" && call.url.includes(`id=file${year}`)).length;
    }
}

const silentLogger: PrfSyncLogger = { info() {}, warn() {}, error() {} };

function deps(fake: FakePrf, extra: Partial<PrfSyncDeps> = {}): PrfSyncDeps {
    return {
        db: prisma,
        fetch: fake.fetch,
        logger: silentLogger,
        retry: { attempts: 3, baseDelayMs: 1, timeoutMs: 5_000, sleep: async () => {} },
        ...extra,
    };
}

const syncOptions = (years = [YEAR], extra = {}) => ({
    trigger: "manual" as const,
    years,
    catalogUrl: CATALOG_URL,
    ...extra,
});

async function cleanup() {
    const years = [YEAR, OTHER_YEAR];
    const accidents = await prisma.accident.findMany({
        where: { source_year: { in: years } },
        select: { id: true },
    });
    const ids = accidents.map((accident) => accident.id);
    if (ids.length > 0) {
        await prisma.$transaction(async (transaction) => {
            await transaction.$executeRaw`SELECT set_config('crashmap.allow_audit_purge', 'on', true)`;
            await transaction.adminAuditLog.deleteMany({ where: { target_id: { in: ids } } });
        });
    }
    await prisma.accident.deleteMany({ where: { id: { in: ids } } });
    await prisma.accident.deleteMany({
        where: { source_record_key: { startsWith: `${YEAR}:` } },
    });
    await prisma.prfImportRun.deleteMany({
        where: {
            OR: [
                { files: { some: { source_year: { in: years } } } },
                { status: "RUNNING", trigger: "test-lock" },
            ],
        },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: "prf-sync-test-" } } });
}

test.beforeEach(cleanup);
test.after(async () => {
    await cleanup();
});

// ---------------------------------------------------------------- unidades

test("catalog parser picks the 'Agrupados por ocorrência' link of each year", () => {
    const links = parsePrfCatalog(catalogHtml({ 2026: "abc", 2025: "def" }));
    assert.equal(links.get(2026), "https://drive.google.com/file/d/abc/view?usp=sharing/download");
    assert.equal(links.get(2025), "https://drive.google.com/file/d/def/view?usp=sharing/download");
    assert.equal(
        toDownloadUrl(links.get(2026)!),
        "https://drive.google.com/uc?export=download&id=abc",
    );
    assert.equal(parsePrfCatalog("<html>layout novo</html>").size, 0);
});

test("year lists accept single years, lists and ranges", () => {
    assert.deepEqual(parseYearList("2026"), [2026]);
    assert.deepEqual(parseYearList("2026, 2024"), [2024, 2026]);
    assert.deepEqual(parseYearList("2022-2024"), [2022, 2023, 2024]);
    assert.equal(parseYearList(""), undefined);
    assert.throws(() => parseYearList("26"));
});

test("mapper keeps the existing transformation rules and filters Imperatriz-MA exactly", () => {
    const base = {
        id: "1",
        data_inversa: `${YEAR}-01-15`,
        horario: "06:40:00",
        uf: "MA",
        br: "10",
        km: "289,6",
        municipio: "IMPERATRIZ",
        causa_acidente: "Ultrapassagem Indevida",
        tipo_acidente: "Tombamento",
        condicao_metereologica: "Garoa/Chuvisco",
        mortos: "0",
        feridos_leves: "2",
        feridos_graves: "0",
        veiculos: "4",
        latitude: "-5,201382",
        longitude: "-47,519152",
    };
    const result = mapPrfRow(base, YEAR);
    assert.equal(result.kind, "accepted");
    if (result.kind !== "accepted") return;
    assert.equal(result.record.key, `${YEAR}:1`);
    assert.equal(result.record.data.severity, "medium");
    assert.equal(result.record.data.classificacao_acidente, "com_vitima");
    assert.equal(result.record.data.condicao_meteorologica, "garoa");
    assert.equal(result.record.data.latitude, -5.201382);
    // 06:40 em Brasília (UTC−3) é 09:40 UTC.
    assert.equal(result.record.data.occurred_at.toISOString(), `${YEAR}-01-15T09:40:00.000Z`);
    assert.equal(
        result.record.data.description,
        "Causa: Ultrapassagem Indevida | 0 morto(s) e 4 veiculo(s) envolvido(s) | BR-10 Km 289,6 (IMPERATRIZ - MA)",
    );

    assert.equal(mapPrfRow({ ...base, uf: "SC", municipio: "SANTO AMARO DA IMPERATRIZ" }, YEAR).kind, "skipped");
    assert.equal(mapPrfRow({ ...base, municipio: "SANTO AMARO DA IMPERATRIZ" }, YEAR).kind, "skipped");
    assert.equal(mapPrfRow({ ...base, municipio: "SAO LUIS" }, YEAR).kind, "skipped");
});

// ---------------------------------------------------------- 1. inserção

test("PRF date and time are Brasília local time and are stored as the real instant", () => {
    const iso = (date: string, time: string) => parseDateAndHour(date, time)?.toISOString();

    assert.equal(iso("15/01/2026", "06:40:00"), "2026-01-15T09:40:00.000Z");
    // Madrugada: em UTC já é o dia seguinte, mas continua sendo a ocorrência do dia 31.
    assert.equal(iso("31/12/2025", "23:30:00"), "2026-01-01T02:30:00.000Z");
    // Antes de 2019 havia horário de verão (UTC−2).
    assert.equal(iso("15/01/2018", "06:40:00"), "2018-01-15T08:40:00.000Z");
    assert.equal(parseDateAndHour("31/02/2026", "10:00:00"), null);
    assert.equal(parseDateAndHour("15/01/2026", "24:00:00"), null);
});

test("a late-night occurrence on 31/12 belongs to its file's year", () => {
    const row = {
        id: "9",
        data_inversa: `31/12/${YEAR}`,
        horario: "23:30:00",
        uf: "MA",
        municipio: "IMPERATRIZ",
        latitude: "-5,2",
        longitude: "-47,5",
    } as Parameters<typeof mapPrfRow>[0];

    assert.equal(mapPrfRow(row, YEAR).kind, "accepted");
});

test("imports new Imperatriz-MA occurrences, decoded from Windows-1252, outside moderation", async () => {
    const fake = new FakePrf();
    fake.publish(
        YEAR,
        [
            csvRow({ id: "9000001", mortos: 1, tipo: "Colisão traseira prf-sync-marker" }),
            csvRow({ id: "9000002", leves: 1, clima: "Chuva" }),
            csvRow({ id: "9000003", uf: "SC", municipio: "SANTO AMARO DA IMPERATRIZ" }),
            csvRow({ id: "9000004", municipio: "SAO LUIS" }),
        ],
        "Sat, 31 Oct 2099 02:05:17 GMT",
    );

    const report = await runPrfSync(syncOptions(), deps(fake));

    assert.equal(report.status, "SUCCEEDED");
    const file = report.files[0];
    assert.equal(file.status, "IMPORTED");
    assert.equal(file.rows_read, 4);
    assert.equal(file.rows_matched, 2);
    assert.equal(file.inserted, 2);
    assert.equal(file.updated, 0);
    assert.equal(file.rejected, 0);

    const stored = await prisma.accident.findMany({
        where: { source_year: YEAR },
        orderBy: { source_record_id: "asc" },
    });
    assert.deepEqual(stored.map((row) => row.source_record_key), [`${YEAR}:9000001`, `${YEAR}:9000002`]);
    assert.equal(stored[0].tipo_acidente, "Colisão traseira prf-sync-marker");
    assert.match(stored[0].description ?? "", /^Causa: Reação tardia/);
    assert.equal(stored[0].severity, "critical");
    assert.equal(stored[1].condicao_meteorologica, "chuva");
    for (const row of stored) {
        assert.equal(row.source, "PRF");
        assert.equal(row.moderation_status, "APPROVED");
        assert.equal(row.created_by_id, null);
    }

    // Não entram na fila de moderação, mas aparecem no mapa público.
    const moderation = await listAccidentsForModeration({ search: "prf-sync-marker" });
    assert.equal(moderation.pagination.total, 0);
    await assert.rejects(getAccidentForModeration(stored[0].id), /Accident not found/);
    const map = await listAccidentsForMap({ source: "PRF", source_year: YEAR });
    assert.equal(map.total, 2);

    const run = await prisma.prfImportRun.findUniqueOrThrow({
        where: { id: report.run_id },
        include: { files: true },
    });
    assert.equal(run.status, "SUCCEEDED");
    assert.ok(run.finished_at);
    assert.equal(run.files[0].inserted, 2);
    assert.equal(run.files[0].file_name, `datatran${YEAR}.csv`);
    assert.match(run.files[0].file_sha256 ?? "", /^[0-9a-f]{64}$/);
});

// ------------------------------------------------------ 2. reexecução

test("re-running the same publication writes nothing and creates no duplicates", async () => {
    const fake = new FakePrf();
    fake.publish(YEAR, [csvRow({ id: "9000001" }), csvRow({ id: "9000002" })], "Sat, 31 Oct 2099 02:05:17 GMT");

    await runPrfSync(syncOptions(), deps(fake));
    const before = await prisma.accident.findMany({
        where: { source_year: YEAR },
        orderBy: { id: "asc" },
        select: { id: true, updated_at: true },
    });
    assert.equal(fake.downloads(YEAR), 1);

    // Mesmo arquivo: os metadados remotos bastam e nada é baixado.
    const second = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(second.files[0].status, "UNCHANGED");
    assert.equal(second.files[0].details.change_detection, "remote_metadata");
    assert.equal(fake.downloads(YEAR), 1);

    // Metadados diferentes, mesmo conteúdo: baixa, compara o SHA-256 e para.
    fake.publish(YEAR, [csvRow({ id: "9000001" }), csvRow({ id: "9000002" })], "Sun, 01 Nov 2099 00:00:00 GMT");
    const third = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(third.files[0].status, "UNCHANGED");
    assert.equal(third.files[0].details.change_detection, "sha256");

    // Forçado: processa tudo, mas nenhuma linha muda.
    const forced = await runPrfSync(syncOptions([YEAR], { force: true }), deps(fake));
    assert.equal(forced.files[0].status, "IMPORTED");
    assert.equal(forced.files[0].inserted, 0);
    assert.equal(forced.files[0].updated, 0);
    assert.equal(forced.files[0].unchanged, 2);

    const after = await prisma.accident.findMany({
        where: { source_year: YEAR },
        orderBy: { id: "asc" },
        select: { id: true, updated_at: true },
    });
    assert.deepEqual(after, before);
});

// ------------------------------------------------------- 3. atualização

test("corrections update only official fields and preserve relations, moderation and missing records", async () => {
    const fake = new FakePrf();
    fake.publish(
        YEAR,
        [csvRow({ id: "9000001" }), csvRow({ id: "9000002" }), csvRow({ id: "9000003" })],
        "Sat, 31 Oct 2099 02:05:17 GMT",
    );
    await runPrfSync(syncOptions(), deps(fake));

    const target = await prisma.accident.findUniqueOrThrow({ where: { source_record_key: `${YEAR}:9000001` } });
    const user = await prisma.user.create({
        data: { name: "PRF sync test", email: `prf-sync-test-${Date.now()}@example.com` },
    });
    await prisma.accidentComment.create({
        data: { accident_id: target.id, created_by_id: user.id, body: "comentario preservado" },
    });
    await prisma.accidentTrustVote.create({ data: { accident_id: target.id, created_by_id: user.id } });
    // Edição anterior feita por staff (registrada na auditoria).
    await prisma.adminAuditLog.create({
        data: { action: "REPORT_EDITED_BY_STAFF", target_type: "accident", target_id: target.id },
    });
    const untouched = await prisma.accident.findUniqueOrThrow({ where: { source_record_key: `${YEAR}:9000002` } });

    // Nova publicação: 9000001 corrigido (1 morto), 9000003 removido, 9000005 novo.
    fake.publish(
        YEAR,
        [csvRow({ id: "9000001", mortos: 1 }), csvRow({ id: "9000002" }), csvRow({ id: "9000005" })],
        "Mon, 30 Nov 2099 02:05:17 GMT",
    );
    const report = await runPrfSync(syncOptions(), deps(fake));
    const file = report.files[0];

    assert.equal(file.status, "IMPORTED");
    assert.equal(file.inserted, 1);
    assert.equal(file.updated, 1);
    assert.equal(file.unchanged, 1);
    assert.equal(file.missing_from_source, 1);
    assert.deepEqual(file.details.missing_from_source_keys, [`${YEAR}:9000003`]);
    assert.equal(file.staff_edits_overwritten, 1);
    assert.deepEqual(file.details.staff_edits_overwritten_ids, [target.id]);

    const updated = await prisma.accident.findUniqueOrThrow({
        where: { id: target.id },
        include: { comments: true, trust_votes: true },
    });
    assert.equal(updated.severity, "critical");
    assert.equal(updated.classificacao_acidente, "com_vitima");
    assert.match(updated.description ?? "", /1 morto\(s\)/);
    assert.equal(updated.moderation_status, "APPROVED");
    assert.equal(updated.comments.length, 1);
    assert.equal(updated.trust_votes.length, 1);

    const stillUntouched = await prisma.accident.findUniqueOrThrow({ where: { id: untouched.id } });
    assert.equal(stillUntouched.updated_at.getTime(), untouched.updated_at.getTime());

    // Registro que sumiu da fonte não é apagado.
    assert.ok(await prisma.accident.findUnique({ where: { source_record_key: `${YEAR}:9000003` } }));
});

// ---------------------------------------------------- 4. dados inválidos

test("invalid rows are rejected and counted while valid rows are imported", async () => {
    const fake = new FakePrf();
    fake.publish(
        YEAR,
        [
            csvRow({ id: "9000001" }),
            csvRow({ id: "" }),
            csvRow({ id: "9000002", date: `${YEAR}-02-30` }),
            csvRow({ id: "9000003", lat: "", lng: "" }),
            csvRow({ id: "9000004", lat: "-95,1" }),
            csvRow({ id: "9000005", date: `${YEAR - 1}-12-31` }),
            csvRow({ id: "9000001" }),
            csvRow({ id: "9000006", time: "25:00:00" }),
        ],
        "Sat, 31 Oct 2099 02:05:17 GMT",
    );

    const report = await runPrfSync(syncOptions(), deps(fake));
    const file = report.files[0];
    assert.equal(report.status, "SUCCEEDED");
    assert.equal(file.rows_matched, 8);
    assert.equal(file.inserted, 1);
    assert.equal(file.rejected, 7);
    assert.deepEqual(file.details.rejections, {
        missing_id: 1,
        invalid_date: 2,
        invalid_coordinates: 2,
        year_mismatch: 1,
        duplicated_id: 1,
    });
    assert.equal(await prisma.accident.count({ where: { source_year: YEAR } }), 1);
});

test("a file with an unexpected layout fails before anything is written", async () => {
    const fake = new FakePrf();
    fake.files.set(`file${YEAR}`, {
        body: prfCsv([csvRow({ id: "9000001" })], HEADER.replace('"latitude"', '"lat"')),
        fileName: `datatran${YEAR}.csv`,
        lastModified: "Sat, 31 Oct 2099 02:05:17 GMT",
    });

    const report = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(report.status, "FAILED");
    assert.equal(report.files[0].status, "FAILED");
    assert.match(report.files[0].error ?? "", /colunas ausentes: latitude/);
    assert.equal(await prisma.accident.count({ where: { source_year: YEAR } }), 0);
});

test("a link that delivers another year's file is refused", async () => {
    const fake = new FakePrf();
    fake.publish(YEAR, [csvRow({ id: "9000001" })], "Sat, 31 Oct 2099 02:05:17 GMT", {
        fileName: `datatran${OTHER_YEAR}.csv`,
    });

    const report = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(report.files[0].status, "FAILED");
    assert.match(report.files[0].error ?? "", new RegExp(`ano ${OTHER_YEAR}`));
    assert.equal(await prisma.accident.count({ where: { source_year: YEAR } }), 0);
});

// ------------------------------------------- 5. indisponibilidade da fonte

test("an unavailable catalog is retried, then the run fails cleanly without writing", async () => {
    const fake = new FakePrf();
    fake.catalog = 503;

    const report = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(report.status, "FAILED");
    assert.match(report.files[0].error ?? "", /Catalogo da PRF indisponivel.*3 tentativa/);
    assert.equal(fake.calls.filter((call) => call.url === CATALOG_URL).length, 3);

    const run = await prisma.prfImportRun.findUniqueOrThrow({ where: { id: report.run_id } });
    assert.equal(run.status, "FAILED");
    assert.ok(run.finished_at);
});

test("network errors and HTML pages instead of the file are reported as failures", async () => {
    const fake = new FakePrf();
    fake.files.set(`file${YEAR}`, new TypeError("fetch failed"));
    const networkFailure = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(networkFailure.files[0].status, "FAILED");
    assert.match(networkFailure.files[0].error ?? "", /indisponivel apos 3 tentativa/);

    fake.files.set(`file${YEAR}`, {
        body: "<html>Google Drive - aviso de verificação</html>",
        fileName: "",
        lastModified: "Sat, 31 Oct 2099 02:05:17 GMT",
        contentType: "text/html; charset=utf-8",
    });
    const htmlPage = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(htmlPage.files[0].status, "FAILED");
    assert.match(htmlPage.files[0].error ?? "", /pagina HTML/);
    assert.equal(await prisma.accident.count({ where: { source_year: YEAR } }), 0);
});

test("a year not yet listed in the catalog is reported as not published, not as a failure", async () => {
    const fake = new FakePrf();
    fake.catalog = catalogHtml({ [OTHER_YEAR]: `file${OTHER_YEAR}` });
    fake.publish(OTHER_YEAR, [csvRow({ id: "8000001" }, OTHER_YEAR)], "Sat, 31 Oct 2099 02:05:17 GMT");

    const report = await runPrfSync(syncOptions([OTHER_YEAR, YEAR]), deps(fake));
    assert.equal(report.status, "SUCCEEDED");
    assert.equal(report.files.find((file) => file.source_year === YEAR)?.status, "NOT_PUBLISHED");
    assert.equal(report.files.find((file) => file.source_year === OTHER_YEAR)?.status, "IMPORTED");
});

// --------------------------------------- 6. falha parcial e recuperação

test("a failure in one year keeps the others and the next run recovers", async () => {
    const fake = new FakePrf();
    fake.catalog = catalogHtml({ [YEAR]: `file${YEAR}`, [OTHER_YEAR]: `file${OTHER_YEAR}` });
    fake.publish(YEAR, [csvRow({ id: "9000001" })], "Sat, 31 Oct 2099 02:05:17 GMT");
    fake.publish(OTHER_YEAR, [csvRow({ id: "8000001" }, OTHER_YEAR)], "Sat, 31 Oct 2099 02:05:17 GMT", {
        status: 503,
    });

    const first = await runPrfSync(syncOptions([OTHER_YEAR, YEAR]), deps(fake));
    assert.equal(first.status, "FAILED");
    assert.equal(first.files.find((file) => file.source_year === OTHER_YEAR)?.status, "FAILED");
    assert.equal(first.files.find((file) => file.source_year === YEAR)?.status, "IMPORTED");
    assert.equal(await prisma.accident.count({ where: { source_year: OTHER_YEAR } }), 0);

    fake.publish(OTHER_YEAR, [csvRow({ id: "8000001" }, OTHER_YEAR)], "Sat, 31 Oct 2099 02:05:17 GMT");
    const second = await runPrfSync(syncOptions([OTHER_YEAR, YEAR]), deps(fake));
    assert.equal(second.status, "SUCCEEDED");
    assert.equal(second.files.find((file) => file.source_year === OTHER_YEAR)?.status, "IMPORTED");
    assert.equal(second.files.find((file) => file.source_year === YEAR)?.status, "UNCHANGED");
    assert.equal(await prisma.accident.count({ where: { source_year: { in: [YEAR, OTHER_YEAR] } } }), 2);
});

test("a file that cannot be fully applied writes nothing (single transaction)", async () => {
    // Um relato do app ocupando uma chave da PRF força a falha no meio do arquivo.
    await prisma.accident.create({
        data: {
            tipo_acidente: "relato do app",
            latitude: -5.5,
            longitude: -47.4,
            occurred_at: new Date(`${YEAR}-03-09T12:00:00Z`),
            severity: "low",
            source: "APP",
            source_record_key: `${YEAR}:9000002`,
        },
    });
    const fake = new FakePrf();
    fake.publish(
        YEAR,
        [csvRow({ id: "9000001" }), csvRow({ id: "9000002" }), csvRow({ id: "9000003" })],
        "Sat, 31 Oct 2099 02:05:17 GMT",
    );

    const report = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(report.files[0].status, "FAILED");
    assert.match(report.files[0].error ?? "", /nao e da PRF/);
    assert.equal(await prisma.accident.count({ where: { source: "PRF", source_record_key: { startsWith: `${YEAR}:` } } }), 0);
});

test("dry-run validates and compares without writing occurrences", async () => {
    const fake = new FakePrf();
    fake.publish(YEAR, [csvRow({ id: "9000001" })], "Sat, 31 Oct 2099 02:05:17 GMT");

    const report = await runPrfSync(syncOptions([YEAR], { dryRun: true }), deps(fake));
    assert.equal(report.files[0].inserted, 1);
    assert.equal(await prisma.accident.count({ where: { source_year: YEAR } }), 0);

    // Uma simulação não conta como importação anterior.
    const real = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(real.files[0].status, "IMPORTED");
    assert.equal(await prisma.accident.count({ where: { source_year: YEAR } }), 1);
});

// --------------------------------------------- execuções simultâneas

test("a second concurrent run is refused, and abandoned runs are released", async () => {
    const fake = new FakePrf();
    fake.publish(YEAR, [csvRow({ id: "9000001" })], "Sat, 31 Oct 2099 02:05:17 GMT");

    const running = await prisma.prfImportRun.create({ data: { trigger: "test-lock" } });
    await assert.rejects(runPrfSync(syncOptions(), deps(fake)), PrfSyncLockedError);
    assert.equal(fake.calls.length, 0);

    // Mais velha que o limite: tratada como abandonada e liberada.
    await prisma.prfImportRun.update({
        where: { id: running.id },
        data: { started_at: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    });
    const report = await runPrfSync(syncOptions(), deps(fake));
    assert.equal(report.status, "SUCCEEDED");
    const abandoned = await prisma.prfImportRun.findUniqueOrThrow({ where: { id: running.id } });
    assert.equal(abandoned.status, "FAILED");
    await prisma.prfImportRun.delete({ where: { id: running.id } });
});
