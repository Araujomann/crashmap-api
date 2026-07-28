import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../auth/auth.types.js";
import type {
    Accident,
    AccidentSeverity,
    CreateAccidentBody,
    UpdateAccidentBody,
} from "./accidents.types.js";

function toAccident(accident: {
    id: string;
    title: string;
    description: string | null;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: AccidentSeverity;
    created_by_id: string | null;
    created_at: Date;
    updated_at: Date;
}): Accident {
    return {
        id: accident.id,
        title: accident.title,
        description: accident.description,
        latitude: accident.latitude,
        longitude: accident.longitude,
        occurred_at: accident.occurred_at,
        severity: accident.severity,
        created_by_id: accident.created_by_id,
        created_at: accident.created_at,
        updated_at: accident.updated_at,
    };
}

function parseOccurredAt(value: string): Date {
    const occurredAt = new Date(value);

    if (Number.isNaN(occurredAt.getTime())) {
        throw new AppError(
            "Invalid occurredAt value",
            400,
            "INVALID_OCCURRED_AT",
        );
    }

    return occurredAt;
}

function canManageAccident(user: AuthUser, accidentOwnerId: string | null) {
    return (
        user.role === "admin" ||
        user.role === "moderator" ||
        accidentOwnerId === user.id
    );
}

function ensureUpdatePayload(input: UpdateAccidentBody) {
    if (
        input.title === undefined &&
        input.description === undefined &&
        input.latitude === undefined &&
        input.longitude === undefined &&
        input.occurredAt === undefined &&
        input.severity === undefined
    ) {
        throw new AppError(
            "At least one field must be provided",
            400,
            "INVALID_ACCIDENT_UPDATE",
        );
    }
}

export async function listAccidents(): Promise<Accident[]> {
    const accidents = await prisma.accident.findMany({
        orderBy: { created_at: "desc" },
    });

    return accidents.map(toAccident);
}

export async function getAccident(accidentId: string): Promise<Accident> {
    const accident = await prisma.accident.findUnique({
        where: { id: accidentId },
    });

    if (!accident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
    }

    return toAccident(accident);
}

export async function createAccident(
    user: AuthUser,
    input: CreateAccidentBody,
): Promise<Accident> {
    const accident = await prisma.accident.create({
        data: {
            title: input.title.trim(),
            description: input.description?.trim() || null,
            latitude: input.latitude,
            longitude: input.longitude,
            occurred_at: parseOccurredAt(input.occurredAt),
            severity: input.severity,
            created_by_id: user.id,
        },
    });

    return toAccident(accident);
}

export async function updateAccident(
    user: AuthUser,
    accidentId: string,
    input: UpdateAccidentBody,
): Promise<Accident> {
    ensureUpdatePayload(input);

    const currentAccident = await prisma.accident.findUnique({
        where: { id: accidentId },
    });

    if (!currentAccident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
    }

    if (!canManageAccident(user, currentAccident.created_by_id)) {
        throw new AppError(
            "You cannot modify this accident",
            403,
            "ACCIDENT_FORBIDDEN",
        );
    }

    const accident = await prisma.accident.update({
        where: { id: accidentId },
        data: {
            title: input.title?.trim(),
            description:
                input.description === undefined
                    ? undefined
                    : input.description?.trim() || null,
            latitude: input.latitude,
            longitude: input.longitude,
            occurred_at:
                input.occurredAt === undefined
                    ? undefined
                    : parseOccurredAt(input.occurredAt),
            severity: input.severity,
        },
    });

    return toAccident(accident);
}

export async function deleteAccident(
    user: AuthUser,
    accidentId: string,
): Promise<void> {
    const currentAccident = await prisma.accident.findUnique({
        where: { id: accidentId },
    });

    if (!currentAccident) {
        throw new AppError("Accident not found", 404, "ACCIDENT_NOT_FOUND");
    }

    if (!canManageAccident(user, currentAccident.created_by_id)) {
        throw new AppError(
            "You cannot delete this accident",
            403,
            "ACCIDENT_FORBIDDEN",
        );
    }

    await prisma.accident.delete({
        where: { id: accidentId },
    });
}
