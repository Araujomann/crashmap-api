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

/** Bloco `pagination` das listagens paginadas. */
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

/** Rotas que exigem o access token no cabeçalho `Authorization: Bearer`. */
export const bearerAuthSecurity = [{ bearerAuth: [] }];

/** Parâmetro de rota `:id` no formato UUID. */
export const uuidIdParamsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
} as const;

/** Referência opcional a uma pessoa (quem suspendeu, quem alterou etc.). */
export const personRefOrNullSchema = {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["id", "name"],
    properties: { id: { type: "string" }, name: { type: "string" } },
} as const;
