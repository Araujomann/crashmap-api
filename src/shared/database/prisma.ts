import { env } from "../config/env.js";
import { PrismaClient } from "../../../generated/prisma/client.js";

const globalForPrisma = globalThis as unknown as {
    prisma?: PrismaClient;
};

process.env.DATABASE_URL ??= env.DATABASE_URL;

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
