import "dotenv/config.js";
import { userInfo } from "node:os";
import { prisma } from "../database/prisma.js";
import { GrantRoleError, grantRole } from "../../modules/users/grant-role.js";

// Uso: pnpm admin:grant-role <email> <user|moderator|admin>
// Ex.:  pnpm admin:grant-role ana@exemplo.com admin
async function main() {
    const [email, role] = process.argv.slice(2);
    if (!email || !role) {
        console.error("Uso: pnpm admin:grant-role <email> <user|moderator|admin>");
        process.exitCode = 1;
        return;
    }

    let operator = "desconhecido";
    try {
        operator = userInfo().username;
    } catch {
        // Ambiente sem usuário local (contêiner); mantém "desconhecido".
    }

    try {
        const result = await grantRole(email, role, operator);
        if (!result.changed) {
            console.log(`${result.email} já é ${result.newRole}. Nada foi alterado.`);
            return;
        }
        console.log(
            `${result.email}: ${result.previousRole} → ${result.newRole}.` +
                (result.revokedSessions
                    ? ` ${result.revokedSessions} sessão(ões) encerrada(s).`
                    : "") +
                " Registrado na auditoria.",
        );
    } catch (error) {
        if (error instanceof GrantRoleError) {
            console.error(error.message);
            process.exitCode = 1;
            return;
        }
        throw error;
    }
}

main().finally(() => prisma.$disconnect());
