import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import { toAuthUser } from "../auth/auth.service.js";
import type { AuthUser } from "../auth/auth.types.js";
import type { UpdateMeBody } from "./users.types.js";

export async function getMe(userId: string): Promise<AuthUser> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    return toAuthUser(user);
}

export async function updateMe(
    userId: string,
    input: UpdateMeBody,
): Promise<AuthUser> {
    const name = input.name.trim();

    if (name.length < 2) {
        throw new AppError(
            "Name must contain at least 2 characters after trimming",
            400,
            "INVALID_NAME",
        );
    }

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { name },
    });

    return toAuthUser(updatedUser);
}
