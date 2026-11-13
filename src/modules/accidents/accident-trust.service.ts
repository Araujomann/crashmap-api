import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
    accidentNotFoundError,
    ensurePublicAccidentExists,
} from "./accidents.access.js";
import type { AccidentTrustSummary } from "./accidents.types.js";

export async function getAccidentTrust(
    userId: string,
    accidentId: string,
): Promise<AccidentTrustSummary> {
    await ensurePublicAccidentExists(accidentId);

    const [trustedCount, vote] = await prisma.$transaction([
        prisma.accidentTrustVote.count({
            where: { accident_id: accidentId },
        }),
        prisma.accidentTrustVote.findUnique({
            where: {
                accident_id_created_by_id: {
                    accident_id: accidentId,
                    created_by_id: userId,
                },
            },
            select: { id: true },
        }),
    ]);

    return { trusted_count: trustedCount, trusted_by_me: Boolean(vote) };
}

/** Só relatos aprovados de outra pessoa podem receber o voto. */
async function ensureCanTrustAccident(accidentId: string, userId: string) {
    const accident = await prisma.accident.findFirst({
        where: { id: accidentId, moderation_status: "APPROVED" },
        select: { created_by_id: true },
    });

    if (!accident) {
        throw accidentNotFoundError();
    }

    if (!accident.created_by_id || accident.created_by_id === userId) {
        throw new AppError(
            "You cannot trust this accident",
            403,
            "ACCIDENT_TRUST_FORBIDDEN",
        );
    }
}

export async function addAccidentTrust(
    userId: string,
    accidentId: string,
): Promise<AccidentTrustSummary> {
    await ensureCanTrustAccident(accidentId, userId);

    await prisma.accidentTrustVote.upsert({
        where: {
            accident_id_created_by_id: {
                accident_id: accidentId,
                created_by_id: userId,
            },
        },
        create: { accident_id: accidentId, created_by_id: userId },
        update: {},
    });

    return getAccidentTrust(userId, accidentId);
}

export async function removeAccidentTrust(
    userId: string,
    accidentId: string,
): Promise<AccidentTrustSummary> {
    await ensurePublicAccidentExists(accidentId);

    await prisma.accidentTrustVote.deleteMany({
        where: { accident_id: accidentId, created_by_id: userId },
    });

    return getAccidentTrust(userId, accidentId);
}
