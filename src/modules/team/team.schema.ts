import { authUserSchema } from "../auth/auth.schema.js";

const personSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "name"],
    properties: {
        id: { type: "string" },
        name: { type: "string" },
    },
} as const;

const nullablePersonSchema = {
    ...personSchema,
    type: ["object", "null"],
} as const;

export const inviteSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "email",
        "status",
        "expires_at",
        "created_at",
        "last_sent_at",
        "send_count",
        "invited_by",
        "accepted_at",
        "accepted_by",
        "revoked_at",
        "revoked_by",
    ],
    properties: {
        id: { type: "string" },
        email: { type: "string" },
        status: {
            type: "string",
            enum: ["PENDING", "EXPIRED", "ACCEPTED", "REVOKED"],
        },
        expires_at: { type: "string", format: "date-time" },
        created_at: { type: "string", format: "date-time" },
        last_sent_at: { type: "string", format: "date-time" },
        send_count: { type: "integer" },
        invited_by: personSchema,
        accepted_at: { type: ["string", "null"], format: "date-time" },
        accepted_by: nullablePersonSchema,
        revoked_at: { type: ["string", "null"], format: "date-time" },
        revoked_by: nullablePersonSchema,
    },
} as const;

export const inviteListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data", "pagination"],
    properties: {
        data: { type: "array", items: inviteSchema },
        pagination: {
            type: "object",
            additionalProperties: false,
            required: ["page", "limit", "total", "totalPages"],
            properties: {
                page: { type: "integer" },
                limit: { type: "integer" },
                total: { type: "integer" },
                totalPages: { type: "integer" },
            },
        },
    },
} as const;

export const inviteResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: { data: inviteSchema },
} as const;

export const inviteDeliveryResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["invite", "email_sent"],
            properties: {
                invite: inviteSchema,
                email_sent: { type: "boolean" },
            },
        },
    },
} as const;

export const inviteIdParamsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
} as const;

export const createInviteBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["email"],
    properties: {
        email: { type: "string", format: "email", maxLength: 254 },
    },
} as const;

export const listInvitesQuerySchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        status: {
            type: "string",
            enum: ["PENDING", "EXPIRED", "ACCEPTED", "REVOKED"],
        },
        page: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
    },
} as const;

export const acceptInviteBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["token"],
    properties: {
        token: { type: "string", minLength: 20, maxLength: 200 },
    },
} as const;

export const acceptInviteResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: { data: authUserSchema },
} as const;

export const teamListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "id",
                    "name",
                    "email",
                    "role",
                    "decisions_count",
                    "created_at",
                    "joined_at",
                ],
                properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    email: { type: "string" },
                    role: { type: "string", enum: ["moderator", "admin"] },
                    decisions_count: { type: "integer" },
                    created_at: { type: "string", format: "date-time" },
                    joined_at: { type: ["string", "null"], format: "date-time" },
                },
            },
        },
    },
} as const;

export const revokeModeratorBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: {
        reason: { type: "string", minLength: 1, maxLength: 500 },
    },
} as const;

export const revokeModeratorResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["revoked"],
            properties: { revoked: { type: "boolean" } },
        },
    },
} as const;
