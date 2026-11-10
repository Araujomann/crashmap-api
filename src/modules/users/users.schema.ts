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
