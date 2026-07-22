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
