

export interface PrfCliArguments {
    positional: string[];
    years?: number[];
    force: boolean;
    dryRun: boolean;
    sourceUrl?: string;
}

function parseYear(value: string): number {
    const year = Number(value.trim());
    if (!Number.isInteger(year) || year < 2007 || year > 2100) {
        throw new Error(`Ano invalido: "${value}". Use AAAA (2007 em diante).`);
    }
    return year;
}


export function parseYearList(value: string | undefined): number[] | undefined {
    const text = value?.trim();
    if (!text) return undefined;

    const years = new Set<number>();
    for (const part of text.split(",")) {
        const range = part.trim().match(/^(\d{4})\s*-\s*(\d{4})$/);
        if (range) {
            const start = parseYear(range[1]);
            const end = parseYear(range[2]);
            if (end < start) throw new Error(`Intervalo de anos invalido: "${part}".`);
            for (let year = start; year <= end; year++) years.add(year);
        } else if (part.trim()) {
            years.add(parseYear(part));
        }
    }
    return [...years].sort((a, b) => a - b);
}

export function parsePrfCliArguments(argv: string[]): PrfCliArguments {
    const result: PrfCliArguments = { positional: [], force: false, dryRun: false };
    for (const argument of argv) {
        if (argument === "--force") result.force = true;
        else if (argument === "--dry-run") result.dryRun = true;
        else if (argument.startsWith("--year=")) result.years = parseYearList(argument.slice(7));
        else if (argument.startsWith("--source-url=")) result.sourceUrl = argument.slice(13);
        else if (argument.startsWith("--")) throw new Error(`Opcao desconhecida: ${argument}`);
        else result.positional.push(argument);
    }
    return result;
}
