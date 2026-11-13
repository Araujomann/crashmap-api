import {
    paginationMetaSchema,
    personRefOrNullSchema,
} from "../../shared/http/api-response.js";

const userSummaryProperties = {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    role: { type: "string", enum: ["user", "moderator", "admin"] },
    is_email_verified: { type: "boolean" },
    created_at: { type: "string", format: "date-time" },
    suspended_at: { type: ["string", "null"], format: "date-time" },
    suspended_reason: { type: ["string", "null"] },
    suspended_by: personRefOrNullSchema,
} as const;

const userSummarySchema = {
    type: "object",
    additionalProperties: false,
    required: Object.keys(userSummaryProperties),
    properties: userSummaryProperties,
} as const;

const userDetailProperties = {
    ...userSummaryProperties,
    reports_count: { type: "integer" },
    comments_count: { type: "integer" },
    decisions_count: { type: "integer" },
    active_sessions: { type: "integer" },
} as const;

export const adminUsersQuerySchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        search: { type: "string", maxLength: 120 },
        role: { type: "string", enum: ["user", "moderator", "admin"] },
        status: { type: "string", enum: ["active", "suspended"] },
        page: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
    },
} as const;

export const adminUsersListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data", "pagination"],
    properties: {
        data: { type: "array", items: userSummarySchema },
        pagination: paginationMetaSchema,
    },
} as const;

export const adminUserDetailResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: Object.keys(userDetailProperties),
            properties: userDetailProperties,
        },
    },
} as const;

export const suspendUserBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: { reason: { type: "string", minLength: 1, maxLength: 500 } },
} as const;

export const revokeUserSessionsResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["revoked_sessions"],
            properties: { revoked_sessions: { type: "integer" } },
        },
    },
} as const;
