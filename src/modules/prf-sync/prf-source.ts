import { createHash } from "node:crypto";
import fs from "node:fs";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";
import type { FetchLike, PrfSyncLogger } from "./prf-sync.types.js";


export const PRF_CATALOG_URL =
    "https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf";

const USER_AGENT = "crashmap-prf-sync/1.0";

export class PrfSourceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PrfSourceError";
    }
}

export interface RetryOptions {
    attempts: number;
    baseDelayMs: number;
    timeoutMs: number;
    sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));

function isRetryableStatus(status: number) {
    return status === 408 || status === 429 || status >= 500;
}





export async function fetchWithRetry(
    fetchImpl: FetchLike,
    url: string,
    init: RequestInit,
    options: RetryOptions,
    logger?: PrfSyncLogger,
): Promise<Response> {
    const sleep = options.sleep ?? defaultSleep;
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.attempts; attempt++) {
        let response: Response | undefined;
        try {
            response = await fetchImpl(url, {
                ...init,
                redirect: "follow",
                headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) },
                signal: AbortSignal.timeout(options.timeoutMs),
            });
        } catch (error) {
            
            lastError = error;
        }

        if (response?.ok) return response;
        if (response) {
            const error = new PrfSourceError(
                `Fonte PRF respondeu HTTP ${response.status} para ${url}.`,
            );
            if (!isRetryableStatus(response.status)) throw error;
            lastError = error;
        }

        if (attempt < options.attempts) {
            const delay = options.baseDelayMs * 2 ** (attempt - 1);
            logger?.warn("prf.fetch.retry", {
                url,
                attempt,
                delay_ms: delay,
                error: lastError instanceof Error ? lastError.message : String(lastError),
            });
            await sleep(delay);
        }
    }

    const reason =
        lastError instanceof Error ? lastError.message : String(lastError);
    throw new PrfSourceError(
        `Fonte PRF indisponivel apos ${options.attempts} tentativa(s): ${reason}`,
    );
}

function decodeHtmlEntities(value: string) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&ecirc;/gi, "ê")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, code: string) =>
            String.fromCharCode(Number(code)),
        );
}






export function parsePrfCatalog(html: string): Map<number, string> {
    const links = new Map<number, string>();
    const rows = html.split(/<tr[\s>]/i);

    for (const rawRow of rows) {
        const row = decodeHtmlEntities(rawRow.split(/<\/tr>/i)[0] ?? "");
        const text = row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const label = text.match(
            /Documento CSV de Acidentes (\d{4}) \(Agrupados por ocorr[eê]ncia\)/i,
        );
        if (!label) continue;

        const year = Number(label[1]);
        if (links.has(year)) continue;

        const href = row.match(/<a\s[^>]*href="([^"]+)"/i)?.[1];
        if (href) links.set(year, href);
    }

    return links;
}

/** Converte links de visualização do Google Drive em links de download. */
export function toDownloadUrl(value: string): string {
    const url = new URL(value);
    const match = url.pathname.match(/^\/file\/d\/([^/]+)/);
    if (url.hostname === "drive.google.com" && match) {
        return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(match[1])}`;
    }
    return value;
}

export function driveFileId(value: string): string | null {
    try {
        const url = new URL(value);
        return (
            url.pathname.match(/^\/file\/d\/([^/]+)/)?.[1] ??
            url.searchParams.get("id")
        );
    } catch {
        return null;
    }
}

export interface RemoteFileInfo {
    fileName: string | null;
    size: number | null;
    lastModified: Date | null;
}

function fileNameFromDisposition(value: string | null): string | null {
    if (!value) return null;
    const star = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (star) return decodeURIComponent(star);
    return value.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function readRemoteInfo(response: Response): RemoteFileInfo {
    const length = Number(response.headers.get("content-length"));
    const lastModified = response.headers.get("last-modified");
    const parsedDate = lastModified ? new Date(lastModified) : null;
    return {
        fileName: fileNameFromDisposition(
            response.headers.get("content-disposition"),
        ),
        size: Number.isFinite(length) && length > 0 ? length : null,
        lastModified:
            parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
    };
}


export async function headRemoteFile(
    fetchImpl: FetchLike,
    url: string,
    options: RetryOptions,
    logger?: PrfSyncLogger,
): Promise<RemoteFileInfo | null> {
    try {
        const response = await fetchWithRetry(
            fetchImpl,
            url,
            { method: "HEAD" },
            { ...options, attempts: 1 },
            logger,
        );
        if ((response.headers.get("content-type") ?? "").includes("text/html")) {
            return null;
        }
        return readRemoteInfo(response);
    } catch (error) {
        logger?.warn("prf.head.failed", {
            url,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export interface DownloadedFile extends RemoteFileInfo {
    path: string;
    sha256: string;
    bytes: number;
}


export async function downloadPrfFile(
    fetchImpl: FetchLike,
    url: string,
    directory: string,
    options: RetryOptions,
    logger?: PrfSyncLogger,
): Promise<DownloadedFile> {
    const response = await fetchWithRetry(fetchImpl, url, {}, options, logger);
    if (!response.body) {
        throw new PrfSourceError("Resposta da PRF sem conteudo.");
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) {
        throw new PrfSourceError(
            "A fonte retornou uma pagina HTML em vez do arquivo (link invalido ou confirmacao do Google Drive).",
        );
    }

    const info = readRemoteInfo(response);
    const hash = createHash("sha256");
    let bytes = 0;
    const path = join(directory, "prf-source.bin");

    await pipeline(
        Readable.fromWeb(response.body as never),
        new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                hash.update(chunk);
                bytes += chunk.length;
                callback(null, chunk);
            },
        }),
        fs.createWriteStream(path),
    );

    if (bytes === 0) throw new PrfSourceError("O arquivo baixado da PRF esta vazio.");

    return { ...info, path, sha256: hash.digest("hex"), bytes };
}

export async function sha256File(path: string): Promise<string> {
    const hash = createHash("sha256");
    await pipeline(fs.createReadStream(path), hash);
    return hash.digest("hex");
}

async function isZipFile(path: string): Promise<boolean> {
    const handle = await fs.promises.open(path, "r");
    try {
        const buffer = Buffer.alloc(4);
        await handle.read(buffer, 0, 4, 0);
        return buffer[0] === 0x50 && buffer[1] === 0x4b;
    } finally {
        await handle.close();
    }
}

export interface ExtractedCsv {
    path: string;
    entryName: string;
}





export async function extractPrfCsv(
    filePath: string,
    directory: string,
): Promise<ExtractedCsv> {
    if (!(await isZipFile(filePath))) {
        return { path: filePath, entryName: basename(filePath) };
    }

    const zip = await unzipper.Open.file(filePath);
    const csvEntries = zip.files.filter(
        (entry) => entry.type === "File" && entry.path.toLowerCase().endsWith(".csv"),
    );
    const entry =
        csvEntries.find((item) => /datatran/i.test(basename(item.path))) ??
        csvEntries.find((item) => /ocorr/i.test(basename(item.path))) ??
        (csvEntries.length === 1 ? csvEntries[0] : undefined);
    if (!entry) {
        throw new PrfSourceError(
            "O arquivo ZIP da PRF nao contem o CSV de ocorrencias.",
        );
    }

    const entryName = basename(entry.path);
    const csvPath = join(directory, "prf-source.csv");
    await pipeline(entry.stream(), fs.createWriteStream(csvPath));
    return { path: csvPath, entryName };
}


export function yearFromFileName(name: string | null | undefined): number | null {
    const match = (name ?? "").match(/(20\d{2})/);
    return match ? Number(match[1]) : null;
}
