import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { PrfAccidentData, PrfMappedRecord } from "./prf-sync.types.js";

/** Campos oficiais comparados e atualizados. Moderação e relações ficam de fora. */
export const PRF_MANAGED_FIELDS = [
    "tipo_acidente",
    "classificacao_acidente",
    "condicao_meteorologica",
    "description",
    "latitude",
    "longitude",
    "occurred_at",
    "severity",
    "source_record_id",
    "source_year",
] as const satisfies ReadonlyArray<keyof PrfAccidentData>;

type ManagedField = (typeof PRF_MANAGED_FIELDS)[number];
type ExistingAccident = Pick<PrfAccidentData, ManagedField> & {
    id: string;
    source: "APP" | "PRF";
    source_record_key: string | null;
};

const CHUNK_SIZE = 500;
const TRANSACTION_TIMEOUT_MS = 120_000;

function sameValue(left: unknown, right: unknown) {
    if (left instanceof Date && right instanceof Date) {
        return left.getTime() === right.getTime();
    }
    return left === right;
}

/** Campos que mudaram entre o registro gravado e o dado oficial. */
export function diffManagedFields(
    current: Pick<PrfAccidentData, ManagedField>,
    next: PrfAccidentData,
): Partial<PrfAccidentData> {
    const changes: Partial<PrfAccidentData> = {};
    for (const field of PRF_MANAGED_FIELDS) {
        if (!sameValue(current[field], next[field])) {
            (changes as Record<string, unknown>)[field] = next[field];
        }
    }
    return changes;
}

export interface PersistResult {
    inserted: number;
    updated: number;
    unchanged: number;
    staffEditsOverwritten: string[];
    changedFields: Record<string, number>;
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

/**
 * Grava os registros de um arquivo numa única transação: ou o arquivo
 * inteiro é aplicado, ou nada muda. Registros iguais ao oficial não são
 * tocados (o `updated_at` só avança quando algo mudou de fato), então
 * reexecutar sobre a mesma publicação não produz nenhuma escrita.
 *
 * Em registros existentes só os campos oficiais são atualizados; status de
 * moderação, autoria, comentários, imagens e votos são preservados. Quando o
 * dado oficial sobrescreve uma edição feita por staff (política D1), o id do
 * registro é devolvido para o log da execução.
 */
export async function persistPrfRecords(
    db: PrismaClient,
    records: PrfMappedRecord[],
    options: { dryRun: boolean },
): Promise<PersistResult> {
    const result: PersistResult = {
        inserted: 0,
        updated: 0,
        unchanged: 0,
        staffEditsOverwritten: [],
        changedFields: {},
    };
    if (records.length === 0) return result;

    const plan = async (client: Pick<PrismaClient, "accident" | "adminAuditLog">) => {
        const creates: PrfMappedRecord[] = [];
        const updates: Array<{ id: string; data: Partial<PrfAccidentData> }> = [];

        for (const part of chunk(records, CHUNK_SIZE)) {
            const existing = (await client.accident.findMany({
                where: { source_record_key: { in: part.map((record) => record.key) } },
                select: {
                    id: true,
                    source: true,
                    source_record_key: true,
                    ...Object.fromEntries(PRF_MANAGED_FIELDS.map((field) => [field, true])),
                },
            })) as unknown as ExistingAccident[];
            const byKey = new Map(existing.map((row) => [row.source_record_key, row]));

            for (const record of part) {
                const current = byKey.get(record.key);
                if (!current) {
                    creates.push(record);
                    continue;
                }
                if (current.source !== "PRF") {
                    throw new Error(
                        `Chave ${record.key} pertence a um relato que nao e da PRF; importacao interrompida.`,
                    );
                }
                const changes = diffManagedFields(current, record.data);
                if (Object.keys(changes).length === 0) {
                    result.unchanged++;
                    continue;
                }
                for (const field of Object.keys(changes)) {
                    result.changedFields[field] = (result.changedFields[field] ?? 0) + 1;
                }
                updates.push({ id: current.id, data: changes });
            }
        }

        if (updates.length > 0) {
            const edited = await client.adminAuditLog.findMany({
                where: {
                    action: "REPORT_EDITED_BY_STAFF",
                    target_type: "accident",
                    target_id: { in: updates.map((update) => update.id) },
                },
                select: { target_id: true },
                distinct: ["target_id"],
            });
            result.staffEditsOverwritten = edited
                .map((row) => row.target_id)
                .filter((id): id is string => Boolean(id));
        }

        result.inserted = creates.length;
        result.updated = updates.length;
        return { creates, updates };
    };

    if (options.dryRun) {
        await plan(db);
        return result;
    }

    await db.$transaction(
        async (transaction) => {
            const { creates, updates } = await plan(transaction);

            for (const part of chunk(creates, CHUNK_SIZE)) {
                await transaction.accident.createMany({
                    data: part.map((record) => ({
                        ...record.data,
                        source: "PRF" as const,
                        moderation_status: "APPROVED" as const,
                        source_record_key: record.key,
                    })),
                });
            }

            for (const update of updates) {
                await transaction.accident.update({
                    where: { id: update.id },
                    data: update.data,
                });
            }
        },
        { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
    );

    return result;
}

/** Chaves já importadas de um ano que não aparecem na publicação atual. */
export async function findMissingFromSource(
    db: PrismaClient,
    sourceYear: number,
    seenKeys: Set<string>,
): Promise<string[]> {
    const stored = await db.accident.findMany({
        where: { source: "PRF", source_year: sourceYear },
        select: { source_record_key: true },
    });
    return stored
        .map((row) => row.source_record_key)
        .filter((key): key is string => key !== null && !seenKeys.has(key));
}
