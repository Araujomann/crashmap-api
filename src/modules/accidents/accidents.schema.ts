export const accidentSeveritySchema = {
    type: "string",
    enum: ["low", "medium", "high", "critical"],
} as const;

export const accidentSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "id",
        "title",
        "description",
        "latitude",
        "longitude",
        "occurred_at",
        "severity",
        "created_by_id",
        "created_at",
        "updated_at",
    ],
    properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        latitude: { type: "number" },
        longitude: { type: "number" },
        occurred_at: { type: "string", format: "date-time" },
        severity: accidentSeveritySchema,
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
        "body",
        "created_at",
        "updated_at",
    ],
    properties: {
        id: { type: "string" },
        accident_id: { type: "string" },
        created_by_id: { type: "string" },
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
    required: [...accidentSchema.required, "comments", "images"],
    properties: {
        ...accidentSchema.properties,
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
    required: ["title", "latitude", "longitude", "occurredAt", "severity"],
    properties: {
        title: { type: "string", minLength: 3, maxLength: 180 },
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
        title: { type: "string", minLength: 3, maxLength: 180 },
        description: { type: ["string", "null"], maxLength: 4000 },
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        occurredAt: { type: "string", format: "date-time" },
        severity: accidentSeveritySchema,
    },
} as const;

export const accidentsListResponseSchema = {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
        data: {
            type: "array",
            items: accidentSchema,
        },
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
