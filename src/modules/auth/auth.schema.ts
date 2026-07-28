export const registerBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "email", "password"],
    properties: {
        name: { type: "string", minLength: 2, maxLength: 120 },
        email: { type: "string", format: "email", maxLength: 255 },
        password: { type: "string", minLength: 8, maxLength: 128 },
    },
} as const;

export const loginBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["email", "password"],
    properties: {
        email: { type: "string", format: "email", maxLength: 255 },
        password: { type: "string", minLength: 8, maxLength: 128 },
    },
} as const;

export const refreshBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["refreshToken"],
    properties: {
        refreshToken: { type: "string", minLength: 32 },
    },
} as const;

export const authUserSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "email", "role", "created_at", "updated_at"],
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        role: { type: "string", enum: ["user", "moderator", "admin"] },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
    },
} as const;

export const authResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["user", "tokens"],
            properties: {
                user: authUserSchema,
                tokens: {
                    type: "object",
                    additionalProperties: false,
                    required: ["accessToken", "refreshToken"],
                    properties: {
                        accessToken: { type: "string" },
                        refreshToken: { type: "string" },
                    },
                },
            },
        },
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

export const logoutResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "object",
            additionalProperties: false,
            required: ["revoked"],
            properties: {
                revoked: { type: "boolean" },
            },
        },
    },
} as const;
