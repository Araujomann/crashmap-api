import { termsVersionSchema } from "../auth/auth.schema.js";


export const acceptTermsBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["version"],
    properties: {
        version: termsVersionSchema,
    },
} as const;

const dateTime = { type: "string", format: "date-time" } as const;
const nullableDateTime = { type: ["string", "null"], format: "date-time" } as const;
const nullableString = { type: ["string", "null"] } as const;

function objectSchema<T extends Record<string, unknown>>(properties: T) {
    return {
        type: "object",
        additionalProperties: false,
        required: Object.keys(properties) as (keyof T & string)[],
        properties,
    } as const;
}






export const dataExportResponseSchema = objectSchema({
    data: objectSchema({
        generated_at: dateTime,
        account: objectSchema({
            id: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
            role: { type: "string", enum: ["user", "moderator", "admin"] },
            is_email_verified: { type: "boolean" },
            email_verified_at: nullableDateTime,
            terms_version: nullableString,
            terms_accepted_at: nullableDateTime,
            created_at: dateTime,
            updated_at: dateTime,
        }),
        reports: {
            type: "array",
            items: objectSchema({
                id: { type: "string" },
                tipo_acidente: { type: "string" },
                classificacao_acidente: { type: "string" },
                condicao_meteorologica: { type: "string" },
                description: nullableString,
                latitude: { type: "number" },
                longitude: { type: "number" },
                occurred_at: dateTime,
                severity: { type: "string" },
                moderation_status: { type: "string" },
                moderation_message: nullableString,
                moderated_at: nullableDateTime,
                created_at: dateTime,
                updated_at: dateTime,
            }),
        },
        comments: {
            type: "array",
            items: objectSchema({
                id: { type: "string" },
                accident_id: { type: "string" },
                body: { type: "string" },
                created_at: dateTime,
                updated_at: dateTime,
            }),
        },
        images: {
            type: "array",
            items: objectSchema({
                id: { type: "string" },
                accident_id: { type: "string" },
                image_url: { type: "string" },
                caption: nullableString,
                created_at: dateTime,
            }),
        },
        trust_votes: {
            type: "array",
            items: objectSchema({
                accident_id: { type: "string" },
                created_at: dateTime,
            }),
        },
        devices: {
            type: "array",
            items: objectSchema({
                platform: { type: "string", enum: ["android", "ios"] },
                created_at: dateTime,
                updated_at: dateTime,
            }),
        },
        active_sessions: { type: "integer", minimum: 0 },
    }),
});
