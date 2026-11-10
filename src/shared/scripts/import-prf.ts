import fs from "node:fs";
import { basename, resolve } from "node:path";
import csvParser from "csv-parser";
import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../database/prisma.js";

interface PrfCsvRow {
    id?: string;
    data_inversa?: string;
    horario?: string;
    uf?: string;
    br?: string;
    km?: string;
    municipio?: string;
    causa_acidente?: string;
    tipo_acidente?: string;
    condicao_metereologica?: string;
    condicao_meteorologica?: string;
    mortos?: string;
    feridos_leves?: string;
    feridos_graves?: string;
    veiculos?: string;
    latitude?: string;
    longitude?: string;
}

interface ImportStats {
    processedRows: number;
    filteredRows: number;
    insertedRows: number;
    updatedRows: number;
    invalidRows: number;
}

const BATCH_SIZE = 500;

function parseNumber(value: string | undefined): number | null {
    const parsed = Number.parseFloat((value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
}

function parseDateAndHour(
    dateValue: string | undefined,
    timeValue: string | undefined,
): Date | null {
    const normalizedDate = (dateValue ?? "").trim();
    const dateMatch = normalizedDate.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    const isoDateMatch = normalizedDate.match(
        /^(\d{4})[\/-](\d{2})[\/-](\d{2})$/,
    );
    if (!dateMatch && !isoDateMatch) return null;

    const [, day, month, year] = dateMatch ?? [
        "",
        isoDateMatch?.[3],
        isoDateMatch?.[2],
        isoDateMatch?.[1],
    ];
    const time = (timeValue ?? "00:00:00").trim();
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;

    const [hours, minutes, seconds = "00"] = time.split(":").map(Number);
    const date = new Date(
        Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            hours,
            minutes,
            Number(seconds),
        ),
    );

    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day) ||
        hours > 23 ||
        minutes > 59 ||
        Number(seconds) > 59
    ) {
        return null;
    }

    return date;
}

function mapSeverity(
    mortos: number,
    graves: number,
    leves: number,
): "low" | "medium" | "high" | "critical" {
    if (mortos > 0) return "critical";
    if (graves > 0) return "high";
    if (leves > 0) return "medium";
    return "low";
}

function mapCondicaoTempo(
    value: string | undefined,
): "ceu_claro" | "chuva" | "nublado" | "garoa" {
    const normalized = (value ?? "").toLowerCase();
    if (normalized.includes("chuva")) return "chuva";
    if (normalized.includes("nublado")) return "nublado";
    if (normalized.includes("garoa") || normalized.includes("chuvisco"))
        return "garoa";
    return "ceu_claro";
}

function mapClassificacao(
    mortos: number,
    graves: number,
    leves: number,
): "com_vitima" | "sem_vitima" {
    return mortos > 0 || graves > 0 || leves > 0 ? "com_vitima" : "sem_vitima";
}

function inferSourceYear(csvPath: string): number {
    const year = basename(csvPath).match(/20\d{2}/)?.[0];
    if (!year)
        throw new Error(
            `Nao foi possivel inferir o ano PRF do arquivo: ${csvPath}. Use --year=AAAA.`,
        );
    return Number(year);
}

function getArguments(): { inputFiles: string[]; sourceYear?: number } {
    const argumentsList = process.argv.slice(2);
    const yearArgument = argumentsList.find((argument) =>
        argument.startsWith("--year="),
    );
    const sourceYear = yearArgument
        ? Number(yearArgument.slice("--year=".length))
        : undefined;
    const inputFiles = argumentsList.filter(
        (argument) => !argument.startsWith("--"),
    );

    if (
        sourceYear !== undefined &&
        (!Number.isInteger(sourceYear) ||
            sourceYear < 2000 ||
            sourceYear > 2100)
    ) {
        throw new Error(
            "O argumento --year deve ser um ano valido entre 2000 e 2100.",
        );
    }

    return { inputFiles, sourceYear };
}

async function persistBatch(
    rows: Array<{ key: string; data: Prisma.AccidentUncheckedCreateInput }>,
): Promise<{ inserted: number; updated: number }> {
    const uniqueRows = [...new Map(rows.map((row) => [row.key, row])).values()];
    const keys = uniqueRows.map((row) => row.key);
    const existing = await prisma.accident.findMany({
        where: { source_record_key: { in: keys } },
        select: { source_record_key: true },
    });
    const existingKeys = new Set(existing.map((row) => row.source_record_key));

    await prisma.$transaction(
        uniqueRows.map((row) =>
            prisma.accident.upsert({
                where: { source_record_key: row.key },
                create: row.data,
                update: row.data,
            }),
        ),
    );

    return {
        inserted: uniqueRows.filter((row) => !existingKeys.has(row.key)).length,
        updated: uniqueRows.filter((row) => existingKeys.has(row.key)).length,
    };
}

async function processCsv(
    csvPath: string,
    sourceYear: number,
): Promise<ImportStats> {
    const stats: ImportStats = {
        processedRows: 0,
        filteredRows: 0,
        insertedRows: 0,
        updatedRows: 0,
        invalidRows: 0,
    };
    const batch: Array<{
        key: string;
        data: Prisma.AccidentUncheckedCreateInput;
    }> = [];
    const parser = fs.createReadStream(csvPath).pipe(
        csvParser({
            separator: ";",
            mapHeaders: ({ header }) => header.trim().toLowerCase(),
        }),
    );

    for await (const rowValue of parser) {
        stats.processedRows++;
        const row = rowValue as PrfCsvRow;
        const uf = row.uf?.trim().toUpperCase();
        const municipio = row.municipio?.trim().toUpperCase();

        if (uf !== "MA" || !municipio?.includes("IMPERATRIZ")) continue;
        stats.filteredRows++;

        const sourceRecordId = row.id?.trim();
        const latitude = parseNumber(row.latitude);
        const longitude = parseNumber(row.longitude);
        const occurredAt = parseDateAndHour(row.data_inversa, row.horario);

        if (
            !sourceRecordId ||
            latitude === null ||
            longitude === null ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180 ||
            occurredAt === null
        ) {
            stats.invalidRows++;
            continue;
        }

        const mortos = Number.parseInt(row.mortos ?? "0", 10) || 0;
        const graves = Number.parseInt(row.feridos_graves ?? "0", 10) || 0;
        const leves = Number.parseInt(row.feridos_leves ?? "0", 10) || 0;
        const veiculos = Number.parseInt(row.veiculos ?? "0", 10) || 0;
        const key = `${sourceYear}:${sourceRecordId}`;
        const causa = row.causa_acidente || "Nao informada";
        const description = `Causa: ${causa} | ${mortos} morto(s) e ${veiculos} veiculo(s) envolvido(s) | BR-${row.br ?? ""} Km ${row.km ?? ""} (${row.municipio} - ${row.uf})`;
        const data: Prisma.AccidentUncheckedCreateInput = {
            tipo_acidente: row.tipo_acidente || "Acidente nao especificado",
            classificacao_acidente: mapClassificacao(mortos, graves, leves),
            condicao_meteorologica: mapCondicaoTempo(
                row.condicao_metereologica ?? row.condicao_meteorologica,
            ),
            description,
            latitude,
            longitude,
            occurred_at: occurredAt,
            severity: mapSeverity(mortos, graves, leves),
            source: "PRF",
            moderation_status: "APPROVED",
            source_record_id: sourceRecordId,
            source_year: sourceYear,
            source_record_key: key,
        };

        batch.push({ key, data });
        if (batch.length >= BATCH_SIZE) {
            const result = await persistBatch(batch.splice(0, batch.length));
            stats.insertedRows += result.inserted;
            stats.updatedRows += result.updated;
        }
    }

    if (batch.length > 0) {
        const result = await persistBatch(batch);
        stats.insertedRows += result.inserted;
        stats.updatedRows += result.updated;
    }

    return stats;
}

async function importPrfAccidents(): Promise<void> {
    const { inputFiles, sourceYear } = getArguments();
    if (inputFiles.length === 0) {
        throw new Error(
            "Informe ao menos um CSV. Exemplo: pnpm import:prf ./acidentes-2026.csv --year=2026",
        );
    }

    let total: ImportStats = {
        processedRows: 0,
        filteredRows: 0,
        insertedRows: 0,
        updatedRows: 0,
        invalidRows: 0,
    };
    for (const file of inputFiles) {
        const csvPath = resolve(process.cwd(), file);
        if (!fs.existsSync(csvPath))
            throw new Error(`Arquivo nao encontrado: ${csvPath}`);
        const stats = await processCsv(
            csvPath,
            sourceYear ?? inferSourceYear(csvPath),
        );
        total = {
            processedRows: total.processedRows + stats.processedRows,
            filteredRows: total.filteredRows + stats.filteredRows,
            insertedRows: total.insertedRows + stats.insertedRows,
            updatedRows: total.updatedRows + stats.updatedRows,
            invalidRows: total.invalidRows + stats.invalidRows,
        };
    }

    console.log(
        JSON.stringify({
            source: "PRF",
            municipality: "IMPERATRIZ-MA",
            ...total,
        }),
    );
}

importPrfAccidents()
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
