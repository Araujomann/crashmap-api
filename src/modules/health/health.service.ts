import { prisma } from "../../shared/database/prisma.js";

/** `true` quando o banco responde a uma consulta trivial. */
export async function isDatabaseUp(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch {
        return false;
    }
}
