import type { FastifyInstance, FastifyRequest } from "fastify";
import {
    requireAuthenticatedUser,
    requireVerifiedEmail,
} from "../auth/auth.guard.js";
import { apiErrorSchema } from "../../shared/http/api-response.js";
import type { AuthUser } from "../auth/auth.types.js";
import { auditContextFrom } from "../audit/audit.service.js";
import {
    accidentIdParamsSchema,
    accidentImageParamsSchema,
    accidentImageResponseSchema,
    accidentImagesListResponseSchema,
    deletedAccidentResponseSchema,
} from "./accidents.schema.js";
import {
    createAccidentImage,
    deleteAccidentImage,
    listAccidentImages,
} from "./accident-images.service.js";
import type { CreateAccidentImageBody } from "./accidents.types.js";

interface AccidentImageUploadRequest {
    params: {
        id: string;
    };
}

/** Lê o arquivo e a legenda (`caption`) do corpo multipart. */
async function readAccidentImageUpload(request: FastifyRequest) {
    let fileBuffer: Buffer | undefined;
    let caption: string | null = null;

    for await (const part of request.parts()) {
        if (part.type === "file") {
            fileBuffer = await part.toBuffer();
            continue;
        }

        if (part.type === "field" && part.fieldname === "caption") {
            caption = typeof part.value === "string" ? part.value.trim() : null;
        }
    }

    return { fileBuffer, caption };
}

/** Imagens de um relato aprovado. */
export function registerImageRoutes(app: FastifyInstance) {
    app.get<{ Params: { id: string } }>(
        "/:id/images",
        {
            schema: {
                tags: ['Accidents'],
                summary: 'Listar imagens de um acidente',
                params: accidentIdParamsSchema,
                response: {
                    200: accidentImagesListResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const images = await listAccidentImages(request.params.id);

            return reply.code(200).send({ data: images });
        },
    );

    app.post(
        "/:id/images",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Adicionar imagem a um acidente',
                security: [{ bearerAuth: [] }],
                params: accidentIdParamsSchema,
                response: {
                    201: accidentImageResponseSchema,
                    400: apiErrorSchema,
                },
            },
        },
        async (request, reply) => {
            const typedRequest =
                request as unknown as AccidentImageUploadRequest;
            const upload = await readAccidentImageUpload(request);

            if (!upload.fileBuffer) {
                return reply.code(400).send({
                    error: {
                        code: "IMAGE_FILE_REQUIRED",
                        message: "An image file is required",
                        statusCode: 400,
                    },
                });
            }

            const image = await createAccidentImage(
                request.authUser as AuthUser,
                typedRequest.params.id,
                {
                    fileBuffer: upload.fileBuffer,
                    caption: upload.caption,
                } as CreateAccidentImageBody,
            );

            return reply.code(201).send({ data: image });
        },
    );

    app.delete<{ Params: { id: string; imageId: string } }>(
        "/:id/images/:imageId",
        {
            preHandler: [requireAuthenticatedUser, requireVerifiedEmail],
            schema: {
                tags: ['Accidents'],
                summary: 'Remover imagem de um acidente',
                security: [{ bearerAuth: [] }],
                params: accidentImageParamsSchema,
                response: {
                    200: deletedAccidentResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await deleteAccidentImage(
                request.authUser as AuthUser,
                request.params.id,
                request.params.imageId,
                auditContextFrom(request),
            );

            return reply.code(200).send({ data: { deleted: true } });
        },
    );
}
