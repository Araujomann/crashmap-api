export const accidentSeveritySchema = {
    type: "string",
    enum: ["low", "medium", "high", "critical"],
} as const;

export const accidentModerationStatusSchema = {
    type: "string",
    enum: ["PENDING", "APPROVED", "REJECTED"],
} as const;

export const accidentSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "tipo_acidente",
        "classificacao_acidente",
        "condicao_meteorologica",
        "description",
        "latitude",
        "longitude",
        "occurred_at",
        "severity",
        "source",
        "moderation_status",
        "moderation_message",
        "moderated_at",
        "created_by_id",
        "created_at",
        "updated_at",
    ],
    properties: {
        id: { type: "string" },
        tipo_acidente: { type: "string" },
        classificacao_acidente: {
            type: "string",
            enum: ["com_vitima", "sem_vitima"],
        },
        condicao_meteorologica: {
            type: "string",
            enum: ["ceu_claro", "chuva", "nublado", "garoa"],
        },
        description: { type: ["string", "null"] },
        latitude: { type: "number" },
        longitude: { type: "number" },
        occurred_at: { type: "string", format: "date-time" },
        severity: accidentSeveritySchema,
        source: { type: "string", enum: ["APP", "PRF"] },
        moderation_status: accidentModerationStatusSchema,
        moderation_message: { type: ["string", "null"] },
        moderated_at: { type: ["string", "null"], format: "date-time" },
        created_by_id: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
    },
} as const;

export const accidentCommentSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "accident_id",
        "created_by_id",
        "author_name",
        "body",
        "created_at",
        "updated_at",
    ],
    properties: {
        id: { type: "string" },
        accident_id: { type: "string" },
        created_by_id: { type: "string" },
        author_name: { type: ["string", "null"] },
        body: { type: "string" },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
    },
} as const;

export const accidentImageSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "accident_id",
        "created_by_id",
        "image_url",
        "caption",
        "created_at",
        "updated_at",
    ],
    properties: {
        id: { type: "string" },
        accident_id: { type: "string" },
        created_by_id: { type: "string" },
        image_url: { type: "string" },
        caption: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
    },
} as const;

export const accidentDetailSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        ...accidentSchema.required,
        "trusted_count",
        "comments",
        "images",
    ],
    properties: {
        ...accidentSchema.properties,
        trusted_count: { type: "integer", minimum: 0 },
        comments: {
            type: "array",
            items: accidentCommentSchema,
        },
        images: {
            type: "array",
            items: accidentImageSchema,
        },
    },
} as const;

export const createAccidentBodySchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "tipo_acidente",
        "classificacao_acidente",
        "condicao_meteorologica",
        "latitude",
        "longitude",
        "occurredAt",
        "severity",
    ],
    properties: {
        tipo_acidente: { type: "string", minLength: 3, maxLength: 180 },
        classificacao_acidente: {
            type: "string",
            enum: ["com_vitima", "sem_vitima"],
        },
        condicao_meteorologica: {
            type: "string",
            enum: ["ceu_claro", "chuva", "nublado", "garoa"],
        },
        description: { type: "string", maxLength: 4000 },
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        occurredAt: { type: "string", format: "date-time" },
        severity: accidentSeveritySchema,
    },
} as const;

export const createAccidentCommentBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["body"],
    properties: {
        body: { type: "string", minLength: 1, maxLength: 2000 },
    },
} as const;

export const updateAccidentBodySchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        tipo_acidente: { type: "string", minLength: 3, maxLength: 180 },
        classificacao_acidente: {
            type: "string",
            enum: ["com_vitima", "sem_vitima"],
        },
        condicao_meteorologica: {
            type: "string",
            enum: ["ceu_claro", "chuva", "nublado", "garoa"],
        },
        description: { type: ["string", "null"], maxLength: 4000 },
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        occurredAt: { type: "string", format: "date-time" },
        severity: accidentSeveritySchema,
    },
} as const;

export const accidentMapItemSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "tipo_acidente",
        "classificacao_acidente",
        "condicao_meteorologica",
        "latitude",
        "longitude",
        "occurred_at",
        "severity",
        "source",
    ],
    properties: {
        id: { type: "string" },
        tipo_acidente: { type: "string" },
        classificacao_acidente: {
            type: "string",
            enum: ["com_vitima", "sem_vitima"],
        },
        condicao_meteorologica: {
            type: "string",
            enum: ["ceu_claro", "chuva", "nublado", "garoa"],
        },
        latitude: { type: "number" },
        longitude: { type: "number" },
        occurred_at: { type: "string", format: "date-time" },
        severity: accidentSeveritySchema,
        source: { type: "string", enum: ["APP", "PRF"] },
    },
} as const;

export const accidentsMapResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data", "total"],
    properties: {
        data: {
            type: "array",
            items: accidentMapItemSchema,
        },
        total: { type: "number" },
    },
} as const;

export const accidentsListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data", "pagination"],
    properties: {
        data: {
            type: "array",
            items: accidentSchema,
        },
        pagination: {
            type: "object",
            additionalProperties: false,
            required: ["page", "limit", "total", "totalPages"],
            properties: {
                page: { type: "number" },
                limit: { type: "number" },
                total: { type: "number" },
                totalPages: { type: "number" },
            },
        },
    },
} as const;

export const accidentModerationHistoryItemSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "previous_status",
        "new_status",
        "public_message",
        "internal_note",
        "created_at",
        "moderated_by",
    ],
    properties: {
        id: { type: "string" },
        previous_status: accidentModerationStatusSchema,
        new_status: accidentModerationStatusSchema,
        public_message: { type: ["string", "null"] },
        internal_note: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        moderated_by: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "email"],
            properties: {
                id: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
            },
        },
    },
} as const;

export const moderationAccidentSchema = {
    ...accidentDetailSchema,
    required: [
        ...accidentDetailSchema.required,
        "moderation_internal_note",
        "created_by",
        "moderation_history",
    ],
    properties: {
        ...accidentDetailSchema.properties,
        moderation_internal_note: { type: ["string", "null"] },
        created_by: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["id", "name", "email"],
            properties: {
                id: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
            },
        },
        moderation_history: {
            type: "array",
            items: accidentModerationHistoryItemSchema,
        },
    },
} as const;

export const moderationAccidentListItemSchema = {
    ...accidentSchema,
    required: [...accidentSchema.required, "created_by"],
    properties: {
        ...accidentSchema.properties,
        created_by: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["id", "name", "email"],
            properties: {
                id: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
            },
        },
    },
} as const;

export const accidentModerationListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data", "pagination"],
    properties: {
        data: { type: "array", items: moderationAccidentListItemSchema },
        pagination: accidentsListResponseSchema.properties.pagination,
    },
} as const;

export const accidentModerationSummaryResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["total", "pending", "approved", "rejected"],
            properties: {
                total: { type: "number" },
                pending: { type: "number" },
                approved: { type: "number" },
                rejected: { type: "number" },
            },
        },
    },
} as const;

const accidentOverviewRecentItemSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "tipo_acidente",
        "classificacao_acidente",
        "occurred_at",
        "severity",
        "source",
    ],
    properties: {
        id: { type: "string" },
        tipo_acidente: { type: "string" },
        classificacao_acidente: {
            type: "string",
            enum: ["com_vitima", "sem_vitima"],
        },
        occurred_at: { type: "string", format: "date-time" },
        severity: accidentSeveritySchema,
        source: { type: "string", enum: ["APP", "PRF"] },
    },
} as const;

export const accidentOverviewResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: [
                "approved_accidents_count",
                "accidents_with_victims_count",
                "high_severity_accidents_count",
                "current_30_days_count",
                "previous_30_days_count",
                "severity_distribution",
                "time_of_day",
                "recent_accidents",
            ],
            properties: {
                approved_accidents_count: { type: "integer", minimum: 0 },
                accidents_with_victims_count: { type: "integer", minimum: 0 },
                high_severity_accidents_count: { type: "integer", minimum: 0 },
                current_30_days_count: { type: "integer", minimum: 0 },
                previous_30_days_count: { type: "integer", minimum: 0 },
                severity_distribution: {
                    type: "object",
                    additionalProperties: false,
                    required: ["low", "medium", "high", "critical"],
                    properties: {
                        low: { type: "integer", minimum: 0 },
                        medium: { type: "integer", minimum: 0 },
                        high: { type: "integer", minimum: 0 },
                        critical: { type: "integer", minimum: 0 },
                    },
                },
                time_of_day: {
                    type: "array",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["start_hour", "count"],
                        properties: {
                            start_hour: {
                                type: "integer",
                                minimum: 0,
                                maximum: 21,
                                multipleOf: 3,
                            },
                            count: { type: "integer", minimum: 0 },
                        },
                    },
                },
                recent_accidents: {
                    type: "array",
                    items: accidentOverviewRecentItemSchema,
                },
            },
        },
    },
} as const;

export const moderateAccidentBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: {
        status: { type: "string", enum: ["APPROVED", "REJECTED"] },
        publicMessage: { type: "string", maxLength: 2000 },
        internalNote: { type: "string", maxLength: 4000 },
    },
} as const;

export const editPendingAccidentBodySchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
        tipo_acidente: { type: "string", minLength: 3, maxLength: 180 },
        description: { type: ["string", "null"], maxLength: 4000 },
    },
} as const;

export const accidentResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: accidentDetailSchema,
    },
} as const;

export const accidentCreateResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: accidentSchema,
    },
} as const;

export const moderationAccidentResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: { data: moderationAccidentSchema },
} as const;

export const accidentCommentsListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "array",
            items: accidentCommentSchema,
        },
    },
} as const;

export const accidentTrustResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["trusted_count", "trusted_by_me"],
            properties: {
                trusted_count: { type: "integer", minimum: 0 },
                trusted_by_me: { type: "boolean" },
            },
        },
    },
} as const;

export const accidentImagesListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "array",
            items: accidentImageSchema,
        },
    },
} as const;

export const deletedAccidentResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["deleted"],
            properties: {
                deleted: { type: "boolean" },
            },
        },
    },
} as const;

export const accidentIdParamsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
        id: { type: "string", format: "uuid" },
    },
} as const;
