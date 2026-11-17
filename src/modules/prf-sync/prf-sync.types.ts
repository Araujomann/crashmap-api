import type { Prisma } from "../../../generated/prisma/client.js";


export interface PrfCsvRow {
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

export type PrfRejectionReason =
    | "missing_id"
    | "invalid_date"
    | "invalid_coordinates"
    | "year_mismatch"
    | "duplicated_id";


export interface PrfAccidentData {
    tipo_acidente: string;
    classificacao_acidente: "com_vitima" | "sem_vitima";
    condicao_meteorologica: "ceu_claro" | "chuva" | "nublado" | "garoa";
    description: string;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: "low" | "medium" | "high" | "critical";
    source_record_id: string;
    source_year: number;
}

export interface PrfMappedRecord {
    key: string;
    data: PrfAccidentData;
}

export type PrfMapResult =
    | { kind: "skipped" }
    | { kind: "rejected"; reason: PrfRejectionReason; sourceRecordId?: string }
    | { kind: "accepted"; record: PrfMappedRecord };

export interface PrfFileCounters {
    rows_read: number;
    rows_matched: number;
    inserted: number;
    updated: number;
    unchanged: number;
    rejected: number;
    missing_from_source: number;
    staff_edits_overwritten: number;
}

export interface PrfFileDetails {
    rejections: Partial<Record<PrfRejectionReason, number>>;
    rejected_samples: Array<{ reason: PrfRejectionReason; id?: string }>;
    missing_from_source_keys: string[];
    staff_edits_overwritten_ids: string[];
    warnings: string[];
    [key: string]: Prisma.JsonValue;
}

export interface PrfSyncLogger {
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
}

export type FetchLike = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;
