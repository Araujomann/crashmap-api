import "dotenv/config.js";
import fs from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import unzipper from "unzipper";

const configuredSourceUrl = process.env.PRF_SOURCE_URL;
const sourceYear =
    process.env.PRF_SOURCE_YEAR ?? new Date().getUTCFullYear().toString();

if (!configuredSourceUrl) {
    throw new Error("Missing required environment variable: PRF_SOURCE_URL");
}

function normalizeSourceUrl(value: string): string {
    const url = new URL(value);
    const match = url.pathname.match(/^\/file\/d\/([^/]+)/);

    if (url.hostname === "drive.google.com" && match) {
        return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(match[1])}`;
    }

    return value;
}

const sourceUrl = normalizeSourceUrl(configuredSourceUrl);

function runImporter(csvPath: string): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(
            process.execPath,
            [
                resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
                resolve(process.cwd(), "src/shared/scripts/import-prf.ts"),
                csvPath,
                `--year=${sourceYear}`,
            ],
            {
                stdio: "inherit",
                shell: false,
            },
        );

        child.on("error", rejectPromise);
        child.on("exit", (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(
                new Error(
                    `Importador PRF terminou com codigo ${code ?? "desconhecido"}.`,
                ),
            );
        });
    });
}

async function downloadSource(directory: string): Promise<string> {
    const response = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body) {
        throw new Error(`Download PRF falhou: HTTP ${response.status}`);
    }

    const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";
    const contentDisposition =
        response.headers.get("content-disposition")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) {
        throw new Error(
            "PRF_SOURCE_URL aponta para uma pagina HTML; use o link direto de Baixar planilha.",
        );
    }

    const isZip =
        new URL(sourceUrl).pathname.toLowerCase().endsWith(".zip") ||
        contentType.includes("zip") ||
        contentDisposition.includes(".zip");
    const extension = isZip ? ".zip" : ".csv";
    const downloadedPath = join(directory, `prf-source${extension}`);
    await pipeline(
        Readable.fromWeb(response.body as never),
        fs.createWriteStream(downloadedPath),
    );
    return downloadedPath;
}

async function extractCsv(
    archivePath: string,
    directory: string,
): Promise<string> {
    if (!archivePath.toLowerCase().endsWith(".zip")) return archivePath;

    const zip = await unzipper.Open.file(archivePath);
    const csvEntries = zip.files.filter((entry) =>
        entry.path.toLowerCase().endsWith(".csv"),
    );
    const entry =
        csvEntries.find((item) => item.path.toLowerCase().includes("ocorr")) ??
        csvEntries[0];
    if (!entry) throw new Error("O arquivo ZIP da PRF nao contem nenhum CSV.");

    const csvPath = join(directory, basename(entry.path));
    await pipeline(entry.stream(), fs.createWriteStream(csvPath));
    return csvPath;
}

async function main(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "crashmap-prf-"));
    try {
        const downloadedPath = await downloadSource(directory);
        const downloadedStats = await stat(downloadedPath);
        if (downloadedStats.size === 0)
            throw new Error("O arquivo baixado da PRF esta vazio.");

        const csvPath = await extractCsv(downloadedPath, directory);
        await runImporter(csvPath);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
