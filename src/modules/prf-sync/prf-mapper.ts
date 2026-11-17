import type {
    PrfAccidentData,
    PrfCsvRow,
    PrfMapResult,
} from "./prf-sync.types.js";





export const PRF_TARGET_UF = "MA";
export const PRF_TARGET_MUNICIPALITY = "IMPERATRIZ";

function normalizeText(value: string | undefined): string {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toUpperCase();
}

export function isTargetMunicipality(row: PrfCsvRow): boolean {
    return (
        normalizeText(row.uf) === PRF_TARGET_UF &&
        normalizeText(row.municipio) === PRF_TARGET_MUNICIPALITY
    );
}

export function parseDecimal(value: string | undefined): number | null {
    const text = (value ?? "").trim();
    if (!/^-?\d+([.,]\d+)?$/.test(text)) return null;
    const parsed = Number.parseFloat(text.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
}

function parseCount(value: string | undefined): number {
    return Number.parseInt(value ?? "0", 10) || 0;
}


export const PRF_TIME_ZONE = "America/Sao_Paulo";

const prfWallClockFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PRF_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});


function prfWallClockAsUtc(instant: Date): number {
    const parts = Object.fromEntries(
        prfWallClockFormatter
            .formatToParts(instant)
            .map((part) => [part.type, part.value]),
    );

    return Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
    );
}


export function prfLocalYear(instant: Date): number {
    return new Date(prfWallClockAsUtc(instant)).getUTCFullYear();
}





export function parseDateAndHour(
    dateValue: string | undefined,
    timeValue: string | undefined,
): Date | null {
    const wallClock = parseWallClock(dateValue, timeValue);
    if (wallClock === null) return null;

    
    
    
    let instant = wallClock.getTime();
    for (let i = 0; i < 2; i++) {
        const offset = prfWallClockAsUtc(new Date(instant)) - instant;
        instant = wallClock.getTime() - offset;
    }

    return new Date(instant);
}


function parseWallClock(
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

    const [hours, minutes, seconds = 0] = time.split(":").map(Number);
    const date = new Date(
        Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            hours,
            minutes,
            seconds,
        ),
    );

    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day) ||
        hours > 23 ||
        minutes > 59 ||
        seconds > 59
    ) {
        return null;
    }

    return date;
}

function mapSeverity(
    mortos: number,
    graves: number,
    leves: number,
): PrfAccidentData["severity"] {
    if (mortos > 0) return "critical";
    if (graves > 0) return "high";
    if (leves > 0) return "medium";
    return "low";
}

function mapCondicaoTempo(
    value: string | undefined,
): PrfAccidentData["condicao_meteorologica"] {
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
): PrfAccidentData["classificacao_acidente"] {
    return mortos > 0 || graves > 0 || leves > 0 ? "com_vitima" : "sem_vitima";
}

export function buildSourceRecordKey(sourceYear: number, id: string): string {
    return `${sourceYear}:${id}`;
}






export function mapPrfRow(row: PrfCsvRow, sourceYear: number): PrfMapResult {
    if (!isTargetMunicipality(row)) return { kind: "skipped" };

    const sourceRecordId = row.id?.trim();
    if (!sourceRecordId) return { kind: "rejected", reason: "missing_id" };

    const occurredAt = parseDateAndHour(row.data_inversa, row.horario);
    if (occurredAt === null) {
        return { kind: "rejected", reason: "invalid_date", sourceRecordId };
    }
    if (prfLocalYear(occurredAt) !== sourceYear) {
        return { kind: "rejected", reason: "year_mismatch", sourceRecordId };
    }

    const latitude = parseDecimal(row.latitude);
    const longitude = parseDecimal(row.longitude);
    if (
        latitude === null ||
        longitude === null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
    ) {
        return {
            kind: "rejected",
            reason: "invalid_coordinates",
            sourceRecordId,
        };
    }

    const mortos = parseCount(row.mortos);
    const graves = parseCount(row.feridos_graves);
    const leves = parseCount(row.feridos_leves);
    const veiculos = parseCount(row.veiculos);
    const causa = row.causa_acidente || "Nao informada";

    return {
        kind: "accepted",
        record: {
            key: buildSourceRecordKey(sourceYear, sourceRecordId),
            data: {
                tipo_acidente: row.tipo_acidente || "Acidente nao especificado",
                classificacao_acidente: mapClassificacao(mortos, graves, leves),
                condicao_meteorologica: mapCondicaoTempo(
                    row.condicao_metereologica ?? row.condicao_meteorologica,
                ),
                description: `Causa: ${causa} | ${mortos} morto(s) e ${veiculos} veiculo(s) envolvido(s) | BR-${row.br ?? ""} Km ${row.km ?? ""} (${row.municipio} - ${row.uf})`,
                latitude,
                longitude,
                occurred_at: occurredAt,
                severity: mapSeverity(mortos, graves, leves),
                source_record_id: sourceRecordId,
                source_year: sourceYear,
            },
        },
    };
}
