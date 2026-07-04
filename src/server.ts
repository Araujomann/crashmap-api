import { buildApp } from "./app.js";
import { env } from "./shared/config/env.js";
import { prisma } from "./shared/database/prisma.js";

async function main() {
    const app = await buildApp();
    const shutdown = async () => {
        await app.close();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    await prisma.$connect();

    try {
        await app.listen({ host: "0.0.0.0", port: env.PORT });
    } catch (error) {
        app.log.error(error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

void main();
