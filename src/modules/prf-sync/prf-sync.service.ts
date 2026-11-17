import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import { PrfFormatError, readPrfCsv } from "./prf-csv.js";
import { mapPrfRow } from "./prf-mapper.js";
import { findMissingFromSource, persistPrfRecords } from "./prf-persist.js";
import {
    PRF_CATALOG_URL,
    downloadPrfFile,
    extractPrfCsv,
    fetchWithRetry,
    headRemoteFile,
    parsePrfCatalog,
    sha256File,
    toDownloadUrl,
    yearFromFileName,
    type RetryOptions,
} from "./prf-source.js";
import type {
    FetchLike,
    PrfFileCounters,
    PrfFileDetails,
    PrfMappedRecord,
    PrfSyncLogger,
} from "./prf-sync.types.js";

export type PrfSyncTrigger = "schedule" | "manual" | "file";
export type PrfFileStatus = "IMPORTED" | "UNCHANGED" | "NOT_PUBLISHED" | "FAILED";

export interface PrfSyncOptions {
    trigger: PrfSyncTrigger;
    
    years?: number[];
    
    force?: boolean;
    
    dryRun?: boolean;
    
    sourceUrlOverride?: { year: number; url: string };
    catalogUrl?: string;
    
    localFiles?: Array<{ path: string; year: number }>;
}

export interface PrfSyncDeps {
    db: PrismaClient;
    fetch?: FetchLike;
    logger?: PrfSyncLogger;
    now?: () => Date;
    retry?: Partial<RetryOptions>;
    
    staleAfterMs?: number;
}

export interface PrfFileReport extends PrfFileCounters {
    source_year: number;
    status: PrfFileStatus;
    source_url: string | null;
    file_name: string | null;
    file_sha256: string | null;
    error: string | null;
    details: PrfFileDetails;
}

export interface PrfSyncReport {
    run_id: string;
    status: "SUCCEEDED" | "FAILED";
    dry_run: boolean;
    files: PrfFileReport[];
    error: string | null;
}

export class PrfSyncLockedError extends Error {
    constructor() {
        super("Ja existe uma sincronizacao da PRF em andamento.");
        this.name = "PrfSyncLockedError";
    }
}

const DEFAULT_RETRY: RetryOptions = {
    attempts: 3,
    baseDelayMs: 5_000,
    timeoutMs: 120_000,
};
const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const MAX_SAMPLES = 50;

export const consoleLogger: PrfSyncLogger = {
    info: (message, data) => console.log(JSON.stringify({ level: "info", message, ...data })),
    warn: (message, data) => console.warn(JSON.stringify({ level: "warn", message, ...data })),
    error: (message, data) => console.error(JSON.stringify({ level: "error", message, ...data })),
};

function emptyCounters(): PrfFileCounters {
    return {
        rows_read: 0,
        rows_matched: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        missing_from_source: 0,
        staff_edits_overwritten: 0,
    };
}

function emptyDetails(): PrfFileDetails {
    return {
        rejections: {},
        rejected_samples: [],
        missing_from_source_keys: [],
        staff_edits_overwritten_ids: [],
        warnings: [],
    };
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function isUniqueConstraintError(error: unknown) {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === "P2002"
    );
}

interface PreviousImport {
    file_sha256: string | null;
    file_size: number | null;
    file_name: string | null;
    remote_last_modified: Date | null;
    rows_matched: number;
}

async function findPreviousImport(
    db: PrismaClient,
    sourceYear: number,
): Promise<PreviousImport | null> {
    return db.prfImportFile.findFirst({
        where: {
            source_year: sourceYear,
            status: { in: ["IMPORTED", "UNCHANGED"] },
            file_sha256: { not: null },
            run: { dry_run: false, trigger: { not: "file" } },
        },
        orderBy: { started_at: "desc" },
        select: {
            file_sha256: true,
            file_size: true,
            file_name: true,
            remote_last_modified: true,
            rows_matched: true,
        },
    });
}





async function importCsvFile(
    db: PrismaClient,
    csvPath: string,
    sourceYear: number,
    options: { dryRun: boolean; previousMatched: number | null },
    report: PrfFileReport,
): Promise<void> {
    const records: PrfMappedRecord[] = [];
    const seenKeys = new Set<string>();

    for await (const row of readPrfCsv(fs.createReadStream(csvPath))) {
        report.rows_read++;
        const mapped = mapPrfRow(row, sourceYear);
        if (mapped.kind === "skipped") continue;
        report.rows_matched++;

        let rejection =
            mapped.kind === "rejected"
                ? { reason: mapped.reason, id: mapped.sourceRecordId }
                : null;
        if (mapped.kind === "accepted") {
            if (seenKeys.has(mapped.record.key)) {
                rejection = { reason: "duplicated_id", id: mapped.record.data.source_record_id };
            } else {
                seenKeys.add(mapped.record.key);
                records.push(mapped.record);
            }
        }

        if (rejection) {
            report.rejected++;
            report.details.rejections[rejection.reason] =
                (report.details.rejections[rejection.reason] ?? 0) + 1;
            if (report.details.rejected_samples.length < MAX_SAMPLES) {
                report.details.rejected_samples.push(
                    rejection.id ? { reason: rejection.reason, id: rejection.id } : { reason: rejection.reason },
                );
            }
        }
    }

    if (report.rows_read === 0) {
        throw new PrfFormatError("O CSV da PRF nao possui linhas de dados.");
    }
    if (
        report.rows_matched > 0 &&
        records.length === 0 &&
        report.details.rejections.year_mismatch === report.rows_matched
    ) {
        throw new PrfFormatError(
            `Nenhuma ocorrencia do arquivo pertence a ${sourceYear}; o link publicado pode ser de outro ano.`,
        );
    }
    if (report.rows_matched === 0 && (options.previousMatched ?? 0) > 0) {
        throw new PrfFormatError(
            `Arquivo de ${sourceYear} sem ocorrencias de Imperatriz-MA, mas a importacao anterior tinha ${options.previousMatched}; nada foi gravado.`,
        );
    }

    const persisted = await persistPrfRecords(db, records, { dryRun: options.dryRun });
    report.inserted = persisted.inserted;
    report.updated = persisted.updated;
    report.unchanged = persisted.unchanged;
    report.staff_edits_overwritten = persisted.staffEditsOverwritten.length;
    report.details.staff_edits_overwritten_ids = persisted.staffEditsOverwritten.slice(0, MAX_SAMPLES);
    report.details.changed_fields = persisted.changedFields;

    
    const missing = await findMissingFromSource(db, sourceYear, seenKeys);
    report.missing_from_source = missing.length;
    report.details.missing_from_source_keys = missing.slice(0, MAX_SAMPLES);
}

function newFileReport(sourceYear: number, sourceUrl: string | null): PrfFileReport {
    return {
        source_year: sourceYear,
        status: "FAILED",
        source_url: sourceUrl,
        file_name: null,
        file_sha256: null,
        error: null,
        details: emptyDetails(),
        ...emptyCounters(),
    };
}


export async function runPrfSync(
    options: PrfSyncOptions,
    deps: PrfSyncDeps,
): Promise<PrfSyncReport> {
    const db = deps.db;
    const fetchImpl = deps.fetch ?? fetch;
    const logger = deps.logger ?? consoleLogger;
    const now = deps.now ?? (() => new Date());
    const retry: RetryOptions = { ...DEFAULT_RETRY, ...deps.retry };
    const dryRun = options.dryRun ?? false;
    const force = options.force ?? false;

    const staleBefore = new Date(now().getTime() - (deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS));
    const abandoned = await db.prfImportRun.updateMany({
        where: { status: "RUNNING", started_at: { lt: staleBefore } },
        data: { status: "FAILED", finished_at: now(), error: "Execucao abandonada (sem termino registrado)." },
    });
    if (abandoned.count > 0) logger.warn("prf.sync.abandoned_runs_closed", { count: abandoned.count });

    let runId: string;
    try {
        const run = await db.prfImportRun.create({
            data: { trigger: options.trigger, dry_run: dryRun, forced: force },
            select: { id: true },
        });
        runId = run.id;
    } catch (error) {
        if (isUniqueConstraintError(error)) throw new PrfSyncLockedError();
        throw error;
    }

    logger.info("prf.sync.started", { run_id: runId, trigger: options.trigger, dry_run: dryRun, force });
    const files: PrfFileReport[] = [];
    const tempDirectory = await mkdtemp(join(tmpdir(), "crashmap-prf-"));
    let runError: string | null = null;

    const saveFile = async (report: PrfFileReport, extra: Partial<Prisma.PrfImportFileUncheckedCreateInput>) => {
        files.push(report);
        await db.prfImportFile.create({
            data: {
                run_id: runId,
                source_year: report.source_year,
                source_url: report.source_url,
                file_name: report.file_name,
                file_sha256: report.file_sha256,
                status: report.status,
                error: report.error,
                rows_read: report.rows_read,
                rows_matched: report.rows_matched,
                inserted: report.inserted,
                updated: report.updated,
                unchanged: report.unchanged,
                rejected: report.rejected,
                missing_from_source: report.missing_from_source,
                staff_edits_overwritten: report.staff_edits_overwritten,
                details: report.details as Prisma.InputJsonValue,
                finished_at: now(),
                ...extra,
            },
        });
        const level = report.status === "FAILED" ? "error" : "info";
        logger[level]("prf.sync.file", {
            run_id: runId,
            source_year: report.source_year,
            status: report.status,
            file_name: report.file_name,
            rows_read: report.rows_read,
            rows_matched: report.rows_matched,
            inserted: report.inserted,
            updated: report.updated,
            unchanged: report.unchanged,
            rejected: report.rejected,
            missing_from_source: report.missing_from_source,
            staff_edits_overwritten: report.staff_edits_overwritten,
            error: report.error,
        });
    };

    try {
        if (options.localFiles) {
            for (const file of options.localFiles) {
                const report = newFileReport(file.year, null);
                const startedAt = now();
                const workDirectory = await mkdtemp(join(tempDirectory, `${file.year}-`));
                try {
                    report.file_sha256 = await sha256File(file.path);
                    const csv = await extractPrfCsv(file.path, workDirectory);
                    report.file_name = csv.entryName;
                    await importCsvFile(db, csv.path, file.year, { dryRun, previousMatched: null }, report);
                    report.status = "IMPORTED";
                } catch (error) {
                    report.status = "FAILED";
                    report.error = errorMessage(error);
                }
                await saveFile(report, { started_at: startedAt });
            }
        } else {
            const years = options.years?.length
                ? [...new Set(options.years)].sort((a, b) => a - b)
                : await defaultYears(db, now());
            const override = options.sourceUrlOverride;

            let catalog: Map<number, string> | null = null;
            let catalogError: string | null = null;
            if (years.some((year) => override?.year !== year)) {
                try {
                    const response = await fetchWithRetry(
                        fetchImpl,
                        options.catalogUrl ?? PRF_CATALOG_URL,
                        {},
                        { ...retry, timeoutMs: Math.min(retry.timeoutMs, 60_000) },
                        logger,
                    );
                    catalog = parsePrfCatalog(await response.text());
                    if (catalog.size === 0) {
                        catalogError = "Catalogo da PRF sem links de 'Agrupados por ocorrencia'; o layout da pagina pode ter mudado.";
                    }
                } catch (error) {
                    catalogError = `Catalogo da PRF indisponivel: ${errorMessage(error)}`;
                }
            }

            for (const year of years) {
                const sourceUrl = override?.year === year ? override.url : (catalog?.get(year) ?? null);
                const report = newFileReport(year, sourceUrl);
                const startedAt = now();
                const extra: Partial<Prisma.PrfImportFileUncheckedCreateInput> = { started_at: startedAt };

                if (!sourceUrl) {
                    if (catalogError && override?.year !== year) {
                        report.error = catalogError;
                    } else {
                        report.status = "NOT_PUBLISHED";
                        report.details.warnings.push(`Catalogo da PRF nao lista o arquivo de ${year}.`);
                    }
                    await saveFile(report, extra);
                    continue;
                }

                const workDirectory = await mkdtemp(join(tempDirectory, `${year}-`));
                try {
                    const downloadUrl = toDownloadUrl(sourceUrl);
                    const previous = await findPreviousImport(db, year);
                    const remote = await headRemoteFile(fetchImpl, downloadUrl, retry, logger);
                    extra.file_size = remote?.size ?? null;
                    extra.remote_last_modified = remote?.lastModified ?? null;
                    report.file_name = remote?.fileName ?? null;

                    const metadataUnchanged =
                        !force &&
                        previous !== null &&
                        remote !== null &&
                        remote.size !== null &&
                        remote.lastModified !== null &&
                        remote.size === previous.file_size &&
                        remote.fileName === previous.file_name &&
                        remote.lastModified.getTime() === previous.remote_last_modified?.getTime();

                    if (metadataUnchanged) {
                        report.status = "UNCHANGED";
                        report.file_sha256 = previous.file_sha256;
                        report.rows_matched = previous.rows_matched;
                        report.details.change_detection = "remote_metadata";
                    } else {
                        const downloaded = await downloadPrfFile(fetchImpl, downloadUrl, workDirectory, retry, logger);
                        report.file_sha256 = downloaded.sha256;
                        report.file_name = downloaded.fileName ?? report.file_name;
                        extra.file_size = downloaded.bytes;
                        extra.remote_last_modified = downloaded.lastModified ?? extra.remote_last_modified;

                        if (!force && previous?.file_sha256 === downloaded.sha256) {
                            report.status = "UNCHANGED";
                            report.rows_matched = previous.rows_matched;
                            report.details.change_detection = "sha256";
                        } else {
                            const csv = await extractPrfCsv(downloaded.path, workDirectory);
                            for (const name of [report.file_name, csv.entryName]) {
                                const fileYear = yearFromFileName(name);
                                if (fileYear !== null && fileYear !== year) {
                                    throw new PrfFormatError(
                                        `O link do catalogo para ${year} entregou o arquivo ${name} (ano ${fileYear}).`,
                                    );
                                }
                            }
                            report.file_name = report.file_name ?? csv.entryName;
                            await importCsvFile(
                                db,
                                csv.path,
                                year,
                                { dryRun, previousMatched: previous?.rows_matched ?? null },
                                report,
                            );
                            report.status = "IMPORTED";
                        }
                    }
                } catch (error) {
                    report.status = "FAILED";
                    report.error = errorMessage(error);
                }
                await saveFile(report, extra);
            }
        }
    } catch (error) {
        runError = errorMessage(error);
    } finally {
        await rm(tempDirectory, { recursive: true, force: true });
    }

    const failed = runError !== null || files.some((file) => file.status === "FAILED");
    const status = failed ? "FAILED" : "SUCCEEDED";
    const summary = runError ?? (failed ? "Um ou mais arquivos falharam; veja prf_import_files." : null);
    await db.prfImportRun.update({
        where: { id: runId },
        data: { status, finished_at: now(), error: summary },
    });
    logger[failed ? "error" : "info"]("prf.sync.finished", { run_id: runId, status, error: summary });

    return { run_id: runId, status, dry_run: dryRun, files, error: summary };
}


async function defaultYears(db: PrismaClient, today: Date): Promise<number[]> {
    const stored = await db.accident.findMany({
        where: { source: "PRF", source_year: { not: null } },
        distinct: ["source_year"],
        select: { source_year: true },
    });
    const years = new Set<number>([today.getUTCFullYear()]);
    for (const row of stored) if (row.source_year) years.add(row.source_year);
    return [...years].sort((a, b) => a - b);
}
