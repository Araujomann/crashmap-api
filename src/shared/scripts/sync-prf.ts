











import "dotenv/config.js";
import { prisma } from "../database/prisma.js";
import { parsePrfCliArguments, parseYearList } from "../../modules/prf-sync/prf-sync.cli.js";
import {
    PrfSyncLockedError,
    runPrfSync,
    type PrfSyncTrigger,
} from "../../modules/prf-sync/prf-sync.service.js";

async function main(): Promise<number> {
    const args = parsePrfCliArguments(process.argv.slice(2));
    const years = args.years ?? parseYearList(process.env.PRF_SYNC_YEARS);

    const overrideUrl = args.sourceUrl ?? process.env.PRF_SOURCE_URL?.trim();
    let sourceUrlOverride: { year: number; url: string } | undefined;
    if (overrideUrl) {
        const overrideYear =
            (args.sourceUrl && years?.length === 1 ? years[0] : undefined) ??
            parseYearList(process.env.PRF_SOURCE_YEAR)?.[0];
        if (!overrideYear) {
            throw new Error(
                "Link fixo informado sem ano: use --year=AAAA ou PRF_SOURCE_YEAR.",
            );
        }
        sourceUrlOverride = { year: overrideYear, url: overrideUrl };
    }

    const trigger: PrfSyncTrigger =
        process.env.PRF_SYNC_TRIGGER === "schedule" ? "schedule" : "manual";

    const report = await runPrfSync(
        {
            trigger,
            years,
            force: args.force,
            dryRun: args.dryRun,
            sourceUrlOverride,
            catalogUrl: process.env.PRF_CATALOG_URL?.trim() || undefined,
        },
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
        if (error instanceof PrfSyncLockedError) {
            console.error(error.message);
            process.exitCode = 75;
            return;
        }
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
