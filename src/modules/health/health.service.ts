import { prisma } from "../../shared/database/prisma.js";


export async function isDatabaseUp(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch {
        return false;
    }
}
