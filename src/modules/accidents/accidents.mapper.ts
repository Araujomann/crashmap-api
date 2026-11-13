import type {
    Accident as AccidentRecord,
    AccidentComment as AccidentCommentRecord,
    AccidentImage as AccidentImageRecord,
} from "../../../generated/prisma/client.js";
import type {
    Accident,
    AccidentComment,
    AccidentDetail,
    AccidentImage,
    AccidentModerationStatus,
    ModerationAccident,
} from "./accidents.types.js";

type AccidentCommentRow = AccidentCommentRecord & {
    created_by?: { name: string };
};

type AccidentDetailRow = AccidentRecord & {
    _count?: { trust_votes: number };
    comments: AccidentCommentRow[];
    images: AccidentImageRecord[];
};

type ModerationAccidentRow = AccidentDetailRow & {
    created_by: { id: string; name: string; email: string } | null;
    moderation_history: Array<{
        id: string;
        previous_status: AccidentModerationStatus;
        new_status: AccidentModerationStatus;
        public_message: string | null;
        internal_note: string | null;
        created_at: Date;
        moderated_by: { id: string; name: string; email: string };
    }>;
};

/** Relato no formato público (sem a nota interna da moderação). */
export function toAccident(accident: AccidentRecord): Accident {
    return {
        id: accident.id,
        tipo_acidente: accident.tipo_acidente,
        classificacao_acidente: accident.classificacao_acidente,
        condicao_meteorologica: accident.condicao_meteorologica,
        description: accident.description,
        latitude: accident.latitude,
        longitude: accident.longitude,
        occurred_at: accident.occurred_at,
        severity: accident.severity,
        source: accident.source,
        moderation_status: accident.moderation_status,
        moderation_message: accident.moderation_message,
        moderated_at: accident.moderated_at,
        created_by_id: accident.created_by_id,
        created_at: accident.created_at,
        updated_at: accident.updated_at,
    };
}

export function toAccidentComment(comment: AccidentCommentRow): AccidentComment {
    return {
        id: comment.id,
        accident_id: comment.accident_id,
        created_by_id: comment.created_by_id,
        author_name: comment.created_by?.name ?? null,
        body: comment.body,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
    };
}

export function toAccidentImage(image: AccidentImageRecord): AccidentImage {
    return {
        id: image.id,
        accident_id: image.accident_id,
        created_by_id: image.created_by_id,
        image_url: image.image_url,
        caption: image.caption,
        created_at: image.created_at,
        updated_at: image.updated_at,
    };
}

export function toAccidentDetail(accident: AccidentDetailRow): AccidentDetail {
    return {
        ...toAccident(accident),
        trusted_count: accident._count?.trust_votes ?? 0,
        comments: accident.comments.map(toAccidentComment),
        images: accident.images.map(toAccidentImage),
    };
}

export function toModerationAccident(
    accident: ModerationAccidentRow,
): ModerationAccident {
    return {
        ...toAccidentDetail(accident),
        moderation_internal_note: accident.moderation_internal_note,
        created_by: accident.created_by,
        moderation_history: accident.moderation_history,
    };
}
