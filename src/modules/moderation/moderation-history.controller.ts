import type { FastifyPluginAsync } from "fastify";
import { buildDataResponseSchema } from "../../shared/http/api-response.js";
import {
    listModerationHistory,
    listModerationHistoryModerators,
} from "./moderation-history.service.js";
import type { ModerationHistoryQuery } from "./moderation-history.types.js";

const moderationStatusSchema = {
    type: "string",
    enum: ["PENDING", "APPROVED", "REJECTED"],
} as const;

const actorSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "email", "is_deleted"],
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        is_deleted: { type: "boolean" },
    },
} as const;

const historyEntrySchema = {
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
        "accident",
    ],
    properties: {
        id: { type: "string" },
        previous_status: moderationStatusSchema,
        new_status: moderationStatusSchema,
        public_message: { type: ["string", "null"] },
        internal_note: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        moderated_by: actorSchema,
        accident: {
            type: "object",
            additionalProperties: false,
            required: ["id", "tipo_acidente", "severity"],
            properties: {
                id: { type: "string" },
                tipo_acidente: { type: "string" },
                severity: {
                    type: "string",
                    enum: ["low", "medium", "high", "critical"],
                },
            },
        },
    },
} as const;

const historyListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data", "pagination"],
    properties: {
        data: { type: "array", items: historyEntrySchema },
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

const moderatorsResponseSchema = buildDataResponseSchema({
    type: "array",
    items: {
        type: "object",
        additionalProperties: false,
        required: [...actorSchema.required, "decisions_count"],
        properties: {
            ...actorSchema.properties,
            decisions_count: { type: "integer" },
        },
    },
} as const);

// Registradas dentro de `adminPlugin`: os guards vêm de `config.permission`.
export const moderationHistoryRoutes: FastifyPluginAsync = async (app) => {
    app.get<{ Querystring: ModerationHistoryQuery }>(
        "/",
        {
            config: { permission: "moderation_history:read" },
            schema: {
                tags: ["Moderation"],
                summary: "Histórico global de decisões de moderação",
                security: [{ bearerAuth: [] }],
                querystring: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        page: { type: "integer", minimum: 1 },
                        limit: { type: "integer", minimum: 1, maximum: 50 },
                        moderatorId: { type: "string", format: "uuid" },
                        accidentId: { type: "string", format: "uuid" },
                        status: { type: "string", enum: ["APPROVED", "REJECTED"] },
                        from: { type: "string", format: "date" },
                        to: { type: "string", format: "date" },
                    },
                },
                response: { 200: historyListResponseSchema },
            },
        },
        async (request, reply) => {
            const result = await listModerationHistory(request.query);

            return reply.code(200).send(result);
        },
    );

    app.get(
        "/moderators",
        {
            config: { permission: "moderation_history:read" },
            schema: {
                tags: ["Moderation"],
                summary: "Pessoas que já registraram decisões de moderação",
                security: [{ bearerAuth: [] }],
                response: { 200: moderatorsResponseSchema },
            },
        },
        async (_, reply) => {
            const moderators = await listModerationHistoryModerators();

            return reply.code(200).send({ data: moderators });
        },
    );
};
