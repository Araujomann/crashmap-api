import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import type { AuthUser } from "../auth/auth.types.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";

/**
 * Chaves conhecidas. Só estas podem ser gravadas; valor ausente ou inválido no
 * banco cai no padrão. Para uma configuração nova, basta acrescentar aqui.
 */
export const SETTING_DEFINITIONS = {
    invite_ttl_hours: {
        default: 72,
        min: 1,
        max: 168,
        description: "Validade do link de convite de moderador, em horas",
    },
    invite_max_sends_per_day: {
        default: 5,
        min: 1,
        max: 20,
        description: "Máximo de convites enviados para o mesmo e-mail em 24 horas",
    },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type PlatformSettings = Record<SettingKey, number>;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

function isValid(key: SettingKey, value: unknown): value is number {
    const definition = SETTING_DEFINITIONS[key];
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= definition.min &&
        value <= definition.max
    );
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Valores efetivos (banco + padrões). */
export async function getSettings(db: Db = prisma): Promise<PlatformSettings> {
    const rows = await db.platformSetting.findMany({
        where: { key: { in: SETTING_KEYS } },
    });
    const stored = new Map(rows.map((row) => [row.key, row.value]));

    return Object.fromEntries(
        SETTING_KEYS.map((key) => {
            const value = stored.get(key);
            return [key, isValid(key, value) ? value : SETTING_DEFINITIONS[key].default];
        }),
    ) as PlatformSettings;
}

export interface SettingDetail {
    key: SettingKey;
    value: number;
    default: number;
    min: number;
    max: number;
    description: string;
    updated_at: Date | null;
    updated_by: { id: string; name: string } | null;
}

export async function listSettings(): Promise<SettingDetail[]> {
    const [values, rows] = await Promise.all([
        getSettings(),
        prisma.platformSetting.findMany({
            where: { key: { in: SETTING_KEYS } },
            include: { updated_by: { select: { id: true, name: true } } },
        }),
    ]);
    const rowsByKey = new Map(rows.map((row) => [row.key, row]));

    return SETTING_KEYS.map((key) => {
        const definition = SETTING_DEFINITIONS[key];
        const row = rowsByKey.get(key);
        return {
            key,
            value: values[key],
            default: definition.default,
            min: definition.min,
            max: definition.max,
            description: definition.description,
            updated_at: row?.updated_at ?? null,
            updated_by: row?.updated_by ?? null,
        };
    });
}

export async function updateSettings(
    actor: AuthUser,
    patch: Partial<Record<string, unknown>>,
    context: AuditContext,
): Promise<SettingDetail[]> {
    const entries = Object.entries(patch);
    if (entries.length === 0) {
        throw new AppError("Nenhuma configuração informada", 400, "SETTINGS_EMPTY");
    }

    for (const [key, value] of entries) {
        if (!(key in SETTING_DEFINITIONS)) {
            throw new AppError(`Configuração desconhecida: ${key}`, 400, "SETTING_UNKNOWN");
        }
        if (!isValid(key as SettingKey, value)) {
            const { min, max } = SETTING_DEFINITIONS[key as SettingKey];
            throw new AppError(
                `${key} deve ser um número inteiro entre ${min} e ${max}`,
                400,
                "SETTING_OUT_OF_RANGE",
            );
        }
    }

    await prisma.$transaction(async (transaction) => {
        const current = await getSettings(transaction);
        const before: Record<string, number> = {};
        const after: Record<string, number> = {};

        for (const [key, value] of entries as Array<[SettingKey, number]>) {
            if (current[key] === value) continue;
            before[key] = current[key];
            after[key] = value;
            await transaction.platformSetting.upsert({
                where: { key },
                create: { key, value, updated_by_id: actor.id },
                update: { value, updated_by_id: actor.id },
            });
        }

        if (Object.keys(after).length > 0) {
            await recordAudit(
                transaction,
                {
                    actorId: actor.id,
                    action: "SETTINGS_UPDATED",
                    targetType: "settings",
                    targetId: null,
                    metadata: { before, after },
                },
                context,
            );
        }
    });

    return listSettings();
}
