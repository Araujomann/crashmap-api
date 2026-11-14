/**
 * Importa arquivos da PRF já baixados (CSV ou ZIP), sem acessar a internet.
 *
 *   pnpm import:prf ./datatran2026.zip
 *   pnpm import:prf ./acidentes.csv --year=2026
 *   pnpm import:prf ./datatran2026.csv --dry-run
 *
 * Usa as mesmas regras, validações e registro de execução de `sync:prf`.
 */
import "dotenv/config.js";
import fs from "node:fs";
import { basename, resolve } from "node:path";
import { prisma } from "../database/prisma.js";
import { parsePrfCliArguments } from "../../modules/prf-sync/prf-sync.cli.js";
import { yearFromFileName } from "../../modules/prf-sync/prf-source.js";
import {
    PrfSyncLockedError,
    runPrfSync,
} from "../../modules/prf-sync/prf-sync.service.js";

async function main(): Promise<number> {
    const args = parsePrfCliArguments(process.argv.slice(2));
    if (args.positional.length === 0) {
        throw new Error(
            "Informe ao menos um arquivo. Exemplo: pnpm import:prf ./datatran2026.zip",
        );
    }
    if (args.years && args.years.length > 1) {
        throw new Error("No modo arquivo, --year aceita um unico ano.");
    }

    const localFiles = args.positional.map((file) => {
        const path = resolve(process.cwd(), file);
        if (!fs.existsSync(path)) throw new Error(`Arquivo nao encontrado: ${path}`);
        const year = args.years?.[0] ?? yearFromFileName(basename(path));
        if (!year) {
            throw new Error(
                `Nao foi possivel inferir o ano de ${file}. Use --year=AAAA.`,
            );
        }
        return { path, year };
    });

    const report = await runPrfSync(
        { trigger: "file", localFiles, dryRun: args.dryRun, force: true },
        { db: prisma },
    );

    console.log(JSON.stringify({ source: "PRF", municipality: "IMPERATRIZ-MA", ...report }, null, 2));
    return report.status === "SUCCEEDED" ? 0 : 1;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = error instanceof PrfSyncLockedError ? 75 : 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
