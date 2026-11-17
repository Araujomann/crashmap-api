import { personRefOrNullSchema } from "../../shared/http/api-response.js";
import { SETTING_DEFINITIONS, SETTING_KEYS } from "./settings.service.js";

export const settingsListResponseSchema = {
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
                    "key",
                    "value",
                    "default",
                    "min",
                    "max",
                    "description",
                    "updated_at",
                    "updated_by",
                ],
                properties: {
                    key: { type: "string" },
                    value: { type: "integer" },
                    default: { type: "integer" },
                    min: { type: "integer" },
                    max: { type: "integer" },
                    description: { type: "string" },
                    updated_at: { type: ["string", "null"], format: "date-time" },
                    updated_by: personRefOrNullSchema,
                },
            },
        },
    },
} as const;


export const updateSettingsBodySchema = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: Object.fromEntries(
        SETTING_KEYS.map((key) => [
            key,
            {
                type: "integer",
                minimum: SETTING_DEFINITIONS[key].min,
                maximum: SETTING_DEFINITIONS[key].max,
            },
        ]),
    ),
} as const;
