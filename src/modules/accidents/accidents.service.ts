import type {
    Accident as AccidentRecord,
    Prisma,
} from "../../../generated/prisma/client.js";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
    buildPaginationMeta,
    resolvePagination,
} from "../../shared/http/pagination.js";
import type { AuthUser } from "../auth/auth.types.js";
import { can } from "../auth/permissions.js";
import {
    NO_AUDIT_CONTEXT,
    recordAudit,
    type AuditContext,
} from "../audit/audit.service.js";
import {
    accidentNotFoundError,
    auditStaffActionOnContent,
    canManageContent,
} from "./accidents.access.js";
import {
    accidentPeriodAndAreaFilter,
    accidentTextSearchFilter,
} from "./accidents.filters.js";
import { toAccident, toAccidentDetail } from "./accidents.mapper.js";
import type {
    Accident,
    AccidentDetail,
    AccidentListQuery,
    AccidentListResult,
    AccidentMapItem,
    AccidentMapQuery,
    AccidentMapResult,
    AccidentMapVersion,
    AccidentOverview,
    AccidentSeverity,
    CreateAccidentBody,
    UpdateAccidentBody,
} from "./accidents.types.js";

const MAP_MAX_RESULTS = 5000;
const ACCIDENT_OVERVIEW_TIME_ZONE = "America/Sao_Paulo";
const accidentOverviewHourFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: ACCIDENT_OVERVIEW_TIME_ZONE,
});

function parseOccurredAt(value: string): Date {
    const occurredAt = new Date(value);

    if (Number.isNaN(occurredAt.getTime())) {
        throw new AppError(
            "Invalid occurredAt value",
            400,
            "INVALID_OCCURRED_AT",
        );
    }

    return occurredAt;
}

function moderatedAccidentEditError() {
    return new AppError(
        "Moderated accidents cannot be edited",
        409,
        "ACCIDENT_ALREADY_MODERATED",
    );
}

function ensureUpdatePayload(input: UpdateAccidentBody) {
    if (
        input.tipo_acidente === undefined &&
        input.classificacao_acidente === undefined &&
        input.condicao_meteorologica === undefined &&
        input.description === undefined &&
        input.latitude === undefined &&
        input.longitude === undefined &&
        input.occurredAt === undefined &&
        input.severity === undefined
    ) {
        throw new AppError(
            "At least one field must be provided",
            400,
            "INVALID_ACCIDENT_UPDATE",
        );
    }
}

export async function listAccidents(
    query: AccidentListQuery = {},
): Promise<AccidentListResult> {
    const pagination = resolvePagination(query, 10);
    const severity = query.severity;
    const sort = query.sort ?? "newest";

    const where = {
        ...accidentTextSearchFilter(query.search?.trim()),
        ...(severity ? { severity } : {}),
        ...(query.status ? { moderation_status: query.status } : {}),
        ...accidentPeriodAndAreaFilter(query),
    };

    const [total, accidents] = await prisma.$transaction([
        prisma.accident.count({ where }),
        prisma.accident.findMany({
            where,
            orderBy:
                sort === "oldest"
                    ? { occurred_at: "asc" }
                    : { created_at: "desc" },
            skip: pagination.skip,
            take: pagination.limit,
        }),
    ]);

    return {
        data: accidents.map(toAccident),
        pagination: buildPaginationMeta(pagination, total),
    };
}

export async function listAccidentsForMap(
    query: AccidentMapQuery = {},
): Promise<AccidentMapResult> {
    const severity = query.severity;
    const classificacao = query.classificacao;
    const condicaoMeteorologica = query.condicao_meteorologica;
    const source = query.source;
    const sourceYear = query.source_year;

    const where = {
        moderation_status: "APPROVED" as const,
        ...accidentTextSearchFilter(query.search?.trim()),
        ...(severity ? { severity } : {}),
        ...(classificacao
            ? { classificacao_acidente: classificacao }
            : {}),
        ...(condicaoMeteorologica
            ? { condicao_meteorologica: condicaoMeteorologica }
            : {}),
        ...(source ? { source } : {}),
        ...(sourceYear !== undefined ? { source_year: sourceYear } : {}),
        ...accidentPeriodAndAreaFilter(query),
    };

    const accidents = await prisma.accident.findMany({
        where,
        select: {
            id: true,
            tipo_acidente: true,
            classificacao_acidente: true,
            condicao_meteorologica: true,
            latitude: true,
            longitude: true,
            occurred_at: true,
            severity: true,
            source: true,
        },
        orderBy: { occurred_at: "desc" },
        take: MAP_MAX_RESULTS,
    });

    const data: AccidentMapItem[] = accidents.map((a) => ({
        id: a.id,
        tipo_acidente: a.tipo_acidente,
        classificacao_acidente: a.classificacao_acidente,
        condicao_meteorologica: a.condicao_meteorologica,
        latitude: a.latitude,
        longitude: a.longitude,
        occurred_at: a.occurred_at,
        severity: a.severity,
        source: a.source,
    }));

    return { data, total: data.length };
}

/**
 * Lightweight fingerprint of the approved accidents shown on the map.
 * Clients compare it with the version they cached to decide whether
 * the map payload needs to be downloaded again.
 */
export async function getAccidentsMapVersion(): Promise<AccidentMapVersion> {
    const result = await prisma.accident.aggregate({
        where: { moderation_status: "APPROVED" },
        _count: { _all: true },
        _max: { updated_at: true },
    });

    const total = result._count._all;
    const lastUpdatedAt = result._max.updated_at ?? null;

    return {
        version: `${total}:${lastUpdatedAt?.getTime() ?? 0}`,
        total,
        last_updated_at: lastUpdatedAt,
    };
}

/**
 * Resumo público dos acidentes aprovados. `scope` restringe o universo
 * (a rota pública não usa; os testes usam para medir só os próprios
 * registros, sem depender de outros testes que rodam em paralelo no mesmo
 * banco).
 */
export async function getAccidentOverview(
    now = new Date(),
    scope: Prisma.AccidentWhereInput = {},
): Promise<AccidentOverview> {
    const currentPeriodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previousPeriodStart = new Date(
        now.getTime() - 60 * 24 * 60 * 60 * 1000,
    );
    const approvedFilter = { ...scope, moderation_status: "APPROVED" as const };

    const [
        approvedCount,
        victimCounts,
        severityCounts,
        currentPeriodCount,
        previousPeriodCount,
        hourlyCounts,
        recentAccidents,
    ] = await Promise.all([
        prisma.accident.count({ where: approvedFilter }),
        prisma.accident.count({
            where: {
                ...approvedFilter,
                classificacao_acidente: "com_vitima",
            },
        }),
        prisma.accident.groupBy({
            by: ["severity"],
            where: approvedFilter,
            _count: { _all: true },
        }),
        prisma.accident.count({
            where: {
                ...approvedFilter,
                occurred_at: { gte: currentPeriodStart, lte: now },
            },
        }),
        prisma.accident.count({
            where: {
                ...approvedFilter,
                occurred_at: {
                    gte: previousPeriodStart,
                    lt: currentPeriodStart,
                },
            },
        }),
        prisma.accident.findMany({
            where: {
                ...approvedFilter,
                occurred_at: { gte: currentPeriodStart, lte: now },
            },
            select: { occurred_at: true },
        }),
        prisma.accident.findMany({
            where: approvedFilter,
            select: {
                id: true,
                tipo_acidente: true,
                classificacao_acidente: true,
                occurred_at: true,
                severity: true,
                source: true,
            },
            orderBy: { occurred_at: "desc" },
            take: 5,
        }),
    ]);

    const severityDistribution: Record<AccidentSeverity, number> = {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
    };

    for (const item of severityCounts) {
        severityDistribution[item.severity] = item._count._all;
    }

    const timeOfDayCounts = Array.from({ length: 8 }, () => 0);
    for (const accident of hourlyCounts) {
        const hour = Number(accidentOverviewHourFormatter.format(accident.occurred_at));
        timeOfDayCounts[Math.floor(hour / 3)] += 1;
    }

    return {
        approved_accidents_count: approvedCount,
        accidents_with_victims_count: victimCounts,
        high_severity_accidents_count:
            severityDistribution.high + severityDistribution.critical,
        current_30_days_count: currentPeriodCount,
        previous_30_days_count: previousPeriodCount,
        severity_distribution: severityDistribution,
        time_of_day: timeOfDayCounts.map((count, index) => ({
            start_hour: index * 3,
            count,
        })),
        recent_accidents: recentAccidents,
    };
}

export async function getAccident(
    accidentId: string,
): Promise<AccidentDetail> {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, moderation_status: "APPROVED" },
        include: {
            comments: {
                orderBy: { created_at: "asc" },
                include: { created_by: { select: { name: true } } },
            },
            images: {
                orderBy: { created_at: "asc" },
            },
            _count: { select: { trust_votes: true } },
        },
    });

    if (!accident) {
        throw accidentNotFoundError();
    }

    return toAccidentDetail(accident);
}

export async function createAccident(
    user: AuthUser,
    input: CreateAccidentBody,
): Promise<Accident> {
    const accident = await prisma.accident.create({
        data: {
            tipo_acidente: input.tipo_acidente.trim(),
            classificacao_acidente: input.classificacao_acidente,
            condicao_meteorologica: input.condicao_meteorologica,
            description: input.description?.trim() || null,
            latitude: input.latitude,
            longitude: input.longitude,
            occurred_at: parseOccurredAt(input.occurredAt),
            severity: input.severity,
            created_by_id: user.id,
        },
    });

    return toAccident(accident);
}

/** Campos do relato comparados na auditoria de edição feita por staff. */
const AUDITED_ACCIDENT_FIELDS = [
    "tipo_acidente",
    "classificacao_acidente",
    "condicao_meteorologica",
    "description",
    "latitude",
    "longitude",
    "occurred_at",
    "severity",
] as const;

function auditValue(value: unknown): string | number | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "number" || typeof value === "string") return value;
    return null;
}

/** Só os campos auditados que mudaram, com o valor antes e depois. */
function auditedFieldChanges(previous: AccidentRecord, next: AccidentRecord) {
    const before: Record<string, string | number | null> = {};
    const after: Record<string, string | number | null> = {};

    for (const field of AUDITED_ACCIDENT_FIELDS) {
        const previousValue = auditValue(previous[field]);
        const nextValue = auditValue(next[field]);
        if (previousValue !== nextValue) {
            before[field] = previousValue;
            after[field] = nextValue;
        }
    }

    return { before, after };
}

function accidentSnapshot(accident: AccidentRecord) {
    return {
        tipo_acidente: accident.tipo_acidente,
        description: accident.description,
        severity: accident.severity,
        moderation_status: accident.moderation_status,
        latitude: accident.latitude,
        longitude: accident.longitude,
        occurred_at: accident.occurred_at.toISOString(),
        created_by_id: accident.created_by_id,
    };
}

export async function updateAccident(
    user: AuthUser,
    accidentId: string,
    input: UpdateAccidentBody,
    auditContext: AuditContext = NO_AUDIT_CONTEXT,
): Promise<Accident> {
    ensureUpdatePayload(input);

    const currentAccident = await prisma.accident.findUnique({
        where: { id: accidentId },
    });

    if (!currentAccident) {
        throw accidentNotFoundError();
    }

    if (!canManageContent(user, currentAccident.created_by_id)) {
        throw new AppError(
            "You cannot modify this accident",
            403,
            "ACCIDENT_FORBIDDEN",
        );
    }

    // O autor só edita enquanto o relato aguarda moderação: depois da decisão,
    // uma edição mudaria o conteúdo público sem nova revisão. A staff continua
    // podendo corrigir relatos moderados (a edição é auditada abaixo).
    // Permissão antes do status, como na exclusão.
    const authorEditOnly = !can(user, "reports:moderate");

    if (authorEditOnly && currentAccident.moderation_status !== "PENDING") {
        throw moderatedAccidentEditError();
    }

    const accident = await prisma.$transaction(async (transaction) => {
        // Condição no próprio UPDATE: se a moderação decidir entre a leitura
        // acima e esta escrita, a edição do autor é recusada.
        const changed = await transaction.accident.updateMany({
            where: {
                id: accidentId,
                ...(authorEditOnly ? { moderation_status: "PENDING" as const } : {}),
            },
            data: {
                tipo_acidente: input.tipo_acidente?.trim(),
                classificacao_acidente: input.classificacao_acidente,
                condicao_meteorologica: input.condicao_meteorologica,
                description:
                    input.description === undefined
                        ? undefined
                        : input.description?.trim() || null,
                latitude: input.latitude,
                longitude: input.longitude,
                occurred_at:
                    input.occurredAt === undefined
                        ? undefined
                        : parseOccurredAt(input.occurredAt),
                severity: input.severity,
            },
        });

        if (changed.count !== 1) {
            throw authorEditOnly
                ? moderatedAccidentEditError()
                : accidentNotFoundError();
        }

        const updated = await transaction.accident.findUniqueOrThrow({
            where: { id: accidentId },
        });

        const staffEditEntry = {
            action: "REPORT_EDITED_BY_STAFF" as const,
            targetType: "accident" as const,
            targetId: accidentId,
            metadata: {
                author_id: currentAccident.created_by_id,
                ...auditedFieldChanges(currentAccident, updated),
            },
        };

        // Relato já moderado só é editável pela staff, inclusive quando ela é
        // a autora: essa edição muda conteúdo revisado e sempre vai para a
        // auditoria. O status é o do momento da escrita (`updated`).
        if (updated.moderation_status !== "PENDING") {
            await recordAudit(
                transaction,
                { actorId: user.id, ...staffEditEntry },
                auditContext,
            );
        } else {
            await auditStaffActionOnContent(
                transaction,
                user,
                currentAccident.created_by_id,
                staffEditEntry,
                auditContext,
            );
        }

        return updated;
    });

    return toAccident(accident);
}

export async function deleteAccident(
    user: AuthUser,
    accidentId: string,
    auditContext: AuditContext = NO_AUDIT_CONTEXT,
): Promise<void> {
    const currentAccident = await prisma.accident.findUnique({
        where: { id: accidentId },
    });

    if (!currentAccident) {
        throw accidentNotFoundError();
    }

    // Permissão antes do status: quem não pode apagar o relato recebe 403,
    // sem descobrir se ele já foi moderado.
    if (!canManageContent(user, currentAccident.created_by_id)) {
        throw new AppError(
            "You cannot delete this accident",
            403,
            "ACCIDENT_FORBIDDEN",
        );
    }

    if (currentAccident.moderation_status !== "PENDING") {
        throw new AppError(
            "Moderated accidents cannot be deleted",
            409,
            "ACCIDENT_MODERATED_CANNOT_DELETE",
        );
    }

    await prisma.$transaction(async (transaction) => {
        await transaction.accident.delete({
            where: { id: accidentId },
        });

        await auditStaffActionOnContent(
            transaction,
            user,
            currentAccident.created_by_id,
            {
                action: "REPORT_DELETED_BY_STAFF",
                targetType: "accident",
                targetId: accidentId,
                metadata: { snapshot: accidentSnapshot(currentAccident) },
            },
            auditContext,
        );
    });
}
