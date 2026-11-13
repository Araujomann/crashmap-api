import type { Prisma } from "../../../generated/prisma/client.js";
import { env } from "../../shared/config/env.js";
import { prisma } from "../../shared/database/prisma.js";
import { hashRefreshToken, parseDurationToSeconds } from "./tokens.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** Dados de um refresh token novo, válido por `REFRESH_TOKEN_EXPIRES_IN`. */
export function refreshTokenData(userId: string, refreshToken: string) {
    return {
        user_id: userId,
        token_hash: hashRefreshToken(refreshToken),
        expires_at: new Date(
            Date.now() +
                parseDurationToSeconds(env.REFRESH_TOKEN_EXPIRES_IN) * 1000,
        ),
    };
}

export async function storeRefreshToken(userId: string, refreshToken: string) {
    return prisma.refreshToken.create({
        data: refreshTokenData(userId, refreshToken),
    });
}

/**
 * Encerra todas as sessões ativas da conta (revoga os refresh tokens).
 * Retorna quantas foram encerradas.
 */
export async function revokeAllSessions(
    db: Db,
    userId: string,
    revokedAt: Date = new Date(),
): Promise<number> {
    const revoked = await db.refreshToken.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: revokedAt },
    });

    return revoked.count;
}
