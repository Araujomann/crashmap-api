import { admin_audit_action } from "../../../generated/prisma/enums.js";
import { paginationMetaSchema } from "../../shared/http/api-response.js";

export const auditLogQuerySchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        actorId: { type: "string", format: "uuid" },
        action: { type: "string", enum: Object.values(admin_audit_action) },
        targetType: {
            type: "string",
            enum: ["invite", "user", "accident", "comment", "image", "settings"],
        },
        targetId: { type: "string", maxLength: 100 },
        from: { type: "string", format: "date" },
        to: { type: "string", format: "date" },
        page: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
    },
} as const;

const auditLogEntrySchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "action",
        "target_type",
        "target_id",
        "metadata",
        "ip",
        "user_agent",
        "created_at",
        "actor",
    ],
    properties: {
        id: { type: "string" },
        action: { type: "string" },
        target_type: { type: "string" },
        target_id: { type: ["string", "null"] },
        metadata: { type: "object", additionalProperties: true },
        ip: { type: ["string", "null"] },
        user_agent: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        actor: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["id", "name", "email", "is_deleted"],
            properties: {
                id: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
                is_deleted: { type: "boolean" },
            },
        },
    },
} as const;

export const auditLogListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data", "pagination"],
    properties: {
        data: {
            type: "array",
            items: auditLogEntrySchema,
        },
        pagination: paginationMetaSchema,
    },
} as const;
