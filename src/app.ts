import Fastify from "fastify";
import { prisma } from "./shared/database/prisma.js";

export async function buildApp() {
    const app = Fastify({ logger: true });

    app.get("/health", async (_, reply) => {
        try {
            await prisma.$queryRaw`SELECT 1`;

            return {
                status: "ok",
                uptime: process.uptime(),
                database: "up",
            };
        } catch (error) {
            reply.code(503);

            return {
                status: "degraded",
                uptime: process.uptime(),
                database: "down",
            };
        }
    });

    app.addHook("onClose", async () => {
        await prisma.$disconnect();
    });

    return app;
}
