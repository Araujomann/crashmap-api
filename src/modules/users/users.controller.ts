import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser } from "../auth/auth.guard.js";
import { meResponseSchema, updateMeBodySchema } from "./users.schema.js";
import { getMe, updateMe } from "./users.service.js";
import type { UpdateMeBody } from "./users.types.js";

export const usersRoutes: FastifyPluginAsync = async (app) => {
    app.get(
        "/me",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                response: {
                    200: meResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const currentUser = await getMe(request.authUser!.id);

            return reply.code(200).send({ data: currentUser });
        },
    );

    app.patch<{ Body: UpdateMeBody }>(
        "/me",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                body: updateMeBodySchema,
                response: {
                    200: meResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const updatedUser = await updateMe(
                request.authUser!.id,
                request.body,
            );

            return reply.code(200).send({ data: updatedUser });
        },
    );
};
