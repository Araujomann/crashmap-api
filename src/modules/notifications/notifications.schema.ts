import { MAX_ADMINISTRATIVE_NOTICE_LENGTH } from "./administrative-notices.service.js";

const administrativeNoticeSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "message", "created_at"],
    properties: {
        id: { type: "string" },
        message: { type: "string" },
        created_at: { type: "string", format: "date-time" },
    },
} as const;

export const administrativeNoticesResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "array",
            items: administrativeNoticeSchema,
        },
    },
} as const;

export const administrativeNoticeResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: administrativeNoticeSchema,
    },
} as const;

export const administrativeNoticeBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["message"],
    properties: {
        message: {
            type: "string",
            minLength: 1,
            maxLength: MAX_ADMINISTRATIVE_NOTICE_LENGTH,
        },
    },
} as const;

export const registerPushTokenBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["token", "platform"],
    properties: {
        token: { type: "string", minLength: 1, maxLength: 512 },
        platform: { type: "string", enum: ["android", "ios"] },
    },
} as const;

export const unregisterPushTokenBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["token"],
    properties: {
        token: { type: "string", minLength: 1, maxLength: 512 },
    },
} as const;

export const registerPushTokenResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["registered"],
            properties: {
                registered: { type: "boolean" },
            },
        },
    },
} as const;

export const unregisterPushTokenResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["removed"],
            properties: {
                removed: { type: "boolean" },
            },
        },
    },
} as const;
