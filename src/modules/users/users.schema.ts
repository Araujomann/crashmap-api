import { authUserSchema } from "../auth/auth.schema.js";

export const updateMeBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
        name: { type: "string", minLength: 2, maxLength: 120 },
    },
} as const;

export const meResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: authUserSchema,
    },
} as const;

export const gamificationStatsResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["approved_reports_count"],
            properties: {
                approved_reports_count: { type: "integer", minimum: 0 },
            },
        },
    },
} as const;

const myReportImageSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "image_url", "caption"],
    properties: {
        id: { type: "string" },
        image_url: { type: "string" },
        caption: { type: ["string", "null"] },
    },
} as const;

const myReportSchema = {
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
        "images",
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
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        source: { type: "string", enum: ["APP", "PRF"] },
        moderation_status: {
            type: "string",
            enum: ["PENDING", "APPROVED", "REJECTED"],
        },
        moderation_message: { type: ["string", "null"] },
        moderated_at: { type: ["string", "null"], format: "date-time" },
        created_by_id: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        images: {
            type: "array",
            items: myReportImageSchema,
        },
    },
} as const;

export const myReportsResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data", "pagination"],
    properties: {
        data: {
            type: "array",
            items: myReportSchema,
        },
        pagination: {
            type: "object",
            additionalProperties: false,
            required: ["page", "limit", "total", "totalPages"],
            properties: {
                page: { type: "integer", minimum: 1 },
                limit: { type: "integer", minimum: 1 },
                total: { type: "integer", minimum: 0 },
                totalPages: { type: "integer", minimum: 1 },
            },
        },
    },
} as const;
