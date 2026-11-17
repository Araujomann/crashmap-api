export const apiErrorSchema = {
    type: "object",
    additionalProperties: false,
    required: ["error"],
    properties: {
        error: {
            type: "object",
            additionalProperties: false,
            required: ["code", "message", "statusCode"],
            properties: {
                code: { type: "string" },
                message: { type: "string" },
                statusCode: { type: "integer" },
            },
        },
    },
} as const;


export const paginationMetaSchema = {
    type: "object",
    additionalProperties: false,
    required: ["page", "limit", "total", "totalPages"],
    properties: {
        page: { type: "integer" },
        limit: { type: "integer" },
        total: { type: "integer" },
        totalPages: { type: "integer" },
    },
} as const;

export function buildDataResponseSchema<TSchema extends object>(
    dataSchema: TSchema,
) {
    return {
        type: "object",
        additionalProperties: false,
        required: ["data"],
        properties: {
            data: dataSchema,
        },
    } as const;
}


export const bearerAuthSecurity = [{ bearerAuth: [] }];


export const uuidIdParamsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
} as const;


export const personRefOrNullSchema = {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["id", "name"],
    properties: { id: { type: "string" }, name: { type: "string" } },
} as const;
