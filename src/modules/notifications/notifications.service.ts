import { prisma } from "../../shared/database/prisma.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_MESSAGES_PER_REQUEST = 100;
const APPROVED_ACCIDENT_EVENT = "ACCIDENT_APPROVED";

type ExpoPushTicket = {
    status: "ok" | "error";
    message?: string;
    error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseTicket(value: unknown): ExpoPushTicket | null {
    if (!isRecord(value) || (value.status !== "ok" && value.status !== "error")) {
        return null;
    }

    const details = isRecord(value.details) ? value.details : null;

    return {
        status: value.status,
        message: typeof value.message === "string" ? value.message : undefined,
        error:
            typeof details?.error === "string" ? details.error : undefined,
    };
}

export async function registerPushToken(
    userId: string,
    token: string,
    platform: "android" | "ios",
) {
    await prisma.pushToken.upsert({
        where: { token },
        create: { user_id: userId, token, platform },
        update: { user_id: userId, platform },
    });
}

export async function unregisterPushToken(userId: string, token: string) {
    const result = await prisma.pushToken.deleteMany({
        where: { user_id: userId, token },
    });

    return result.count > 0;
}

export function buildApprovedAccidentPushMessage(
    token: string,
    accidentId: string,
) {
    return {
        to: token,
        title: "Novo acidente registrado",
        body: "um novo acidente de trânsito foi registrado em Imperatriz",
        sound: "default",
        channelId: "default",
        data: {
            type: APPROVED_ACCIDENT_EVENT,
            accidentId,
        },
    };
}

export async function sendApprovedAccidentNotification(accidentId: string) {
    const registeredTokens = await prisma.pushToken.findMany({
        select: { token: true },
    });

    if (registeredTokens.length === 0) {
        return { recipientCount: 0, removedTokenCount: 0 };
    }

    const invalidTokens = new Set<string>();
    let failedTicketCount = 0;

    for (
        let start = 0;
        start < registeredTokens.length;
        start += MAX_MESSAGES_PER_REQUEST
    ) {
        const batch = registeredTokens.slice(
            start,
            start + MAX_MESSAGES_PER_REQUEST,
        );
        const response = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip, deflate",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(
                batch.map(({ token }) =>
                    buildApprovedAccidentPushMessage(token, accidentId),
                ),
            ),
        });

        if (!response.ok) {
            throw new Error(
                `Expo Push API returned HTTP ${response.status}`,
            );
        }

        const payload: unknown = await response.json();
        if (!isRecord(payload) || !Array.isArray(payload.data)) {
            throw new Error("Expo Push API returned an invalid ticket response");
        }

        if (payload.data.length !== batch.length) {
            throw new Error("Expo Push API returned an unexpected ticket count");
        }

        for (const [index, rawTicket] of payload.data.entries()) {
            const ticket = parseTicket(rawTicket);
            if (!ticket) {
                throw new Error("Expo Push API returned an invalid push ticket");
            }

            if (ticket.status === "error") {
                if (ticket.error === "DeviceNotRegistered") {
                    invalidTokens.add(batch[index].token);
                } else {
                    failedTicketCount += 1;
                }
            }
        }
    }

    const invalidTokenList = [...invalidTokens];
    if (invalidTokenList.length > 0) {
        await prisma.pushToken.deleteMany({
            where: { token: { in: invalidTokenList } },
        });
    }

    if (failedTicketCount > 0) {
        throw new Error(
            `Expo Push API rejected ${failedTicketCount} notification(s)`,
        );
    }

    return {
        recipientCount: registeredTokens.length,
        removedTokenCount: invalidTokenList.length,
    };
}
