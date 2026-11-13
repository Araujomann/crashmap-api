import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../auth/auth.types.js";
import { NO_AUDIT_CONTEXT, type AuditContext } from "../audit/audit.service.js";
import {
    auditStaffActionOnContent,
    canManageContent,
    ensurePublicAccidentExists,
} from "./accidents.access.js";
import { toAccidentComment } from "./accidents.mapper.js";
import type {
    AccidentComment,
    CreateAccidentCommentBody,
} from "./accidents.types.js";

export async function listAccidentComments(
    accidentId: string,
): Promise<AccidentComment[]> {
    await ensurePublicAccidentExists(accidentId);

    const comments = await prisma.accidentComment.findMany({
        where: { accident_id: accidentId },
        orderBy: { created_at: "asc" },
        include: { created_by: { select: { name: true } } },
    });

    return comments.map(toAccidentComment);
}

export async function createAccidentComment(
    user: AuthUser,
    accidentId: string,
    input: CreateAccidentCommentBody,
): Promise<AccidentComment> {
    await ensurePublicAccidentExists(accidentId);

    const comment = await prisma.accidentComment.create({
        data: {
            accident_id: accidentId,
            created_by_id: user.id,
            body: input.body.trim(),
        },
        include: { created_by: { select: { name: true } } },
    });

    return toAccidentComment(comment);
}

export async function deleteAccidentComment(
    user: AuthUser,
    accidentId: string,
    commentId: string,
    auditContext: AuditContext = NO_AUDIT_CONTEXT,
): Promise<void> {
    const comment = await prisma.accidentComment.findFirst({
        where: { id: commentId, accident_id: accidentId },
        select: { id: true, created_by_id: true, body: true, created_at: true },
    });

    if (!comment) {
        throw new AppError("Comment not found", 404, "COMMENT_NOT_FOUND");
    }

    if (!canManageContent(user, comment.created_by_id)) {
        throw new AppError(
            "You cannot delete this comment",
            403,
            "COMMENT_FORBIDDEN",
        );
    }

    await prisma.$transaction(async (transaction) => {
        await transaction.accidentComment.delete({
            where: { id: commentId },
        });

        await auditStaffActionOnContent(
            transaction,
            user,
            comment.created_by_id,
            {
                action: "COMMENT_DELETED_BY_STAFF",
                targetType: "comment",
                targetId: commentId,
                metadata: {
                    accident_id: accidentId,
                    author_id: comment.created_by_id,
                    body: comment.body,
                    created_at: comment.created_at.toISOString(),
                },
            },
            auditContext,
        );
    });
}
