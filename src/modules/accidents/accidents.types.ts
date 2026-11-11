import type { AuthUser } from "../auth/auth.types.js";

export type AccidentSeverity = "low" | "medium" | "high" | "critical";
export type AccidentClassification = "com_vitima" | "sem_vitima";
export type AccidentWeatherCondition = "ceu_claro" | "chuva" | "nublado" | "garoa";
export type AccidentModerationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface Accident {
    id: string;
    tipo_acidente: string;
    classificacao_acidente: AccidentClassification;
    condicao_meteorologica: AccidentWeatherCondition;
    description: string | null;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: AccidentSeverity;
    source: AccidentSource;
    moderation_status: AccidentModerationStatus;
    moderation_message: string | null;
    moderated_at: Date | null;
    created_by_id: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface AccidentComment {
    id: string;
    accident_id: string;
    created_by_id: string;
    author_name: string | null;
    body: string;
    created_at: Date;
    updated_at: Date;
}

export interface AccidentImage {
    id: string;
    accident_id: string;
    created_by_id: string;
    image_url: string;
    caption: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface AccidentDetail extends Accident {
    trusted_count: number;
    comments: AccidentComment[];
    images: AccidentImage[];
}

export interface AccidentTrustSummary {
    trusted_count: number;
    trusted_by_me: boolean;
}

export interface AccidentModerationHistoryItem {
    id: string;
    previous_status: AccidentModerationStatus;
    new_status: AccidentModerationStatus;
    public_message: string | null;
    internal_note: string | null;
    created_at: Date;
    moderated_by: {
        id: string;
        name: string;
        email: string;
    };
}

export interface ModerationAccident extends AccidentDetail {
    moderation_internal_note: string | null;
    created_by: {
        id: string;
        name: string;
        email: string;
    } | null;
    moderation_history: AccidentModerationHistoryItem[];
}

export interface AccidentModerationListItem extends Accident {
    created_by: {
        id: string;
        name: string;
        email: string;
    } | null;
}

export interface AccidentModerationListResult {
    data: AccidentModerationListItem[];
    pagination: AccidentListResult["pagination"];
}

export interface AccidentModerationSummary {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
}

export interface ModerateAccidentBody {
    status: Exclude<AccidentModerationStatus, "PENDING">;
    publicMessage?: string;
    internalNote?: string;
}

export interface CreateAccidentBody {
    tipo_acidente: string;
    classificacao_acidente: AccidentClassification;
    condicao_meteorologica: AccidentWeatherCondition;
    description?: string;
    latitude: number;
    longitude: number;
    occurredAt: string;
    severity: AccidentSeverity;
}

export interface AccidentListQuery {
    page?: number;
    limit?: number;
    search?: string;
    severity?: AccidentSeverity;
    status?: AccidentModerationStatus;
    sort?: "newest" | "oldest";
    from?: string;
    to?: string;
    minLat?: number;
    maxLat?: number;
    minLng?: number;
    maxLng?: number;
}

export interface AccidentListResult {
    data: Accident[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export type AccidentSource = "APP" | "PRF";

export interface AccidentMapQuery {
    search?: string;
    severity?: AccidentSeverity;
    classificacao?: AccidentClassification;
    condicao_meteorologica?: AccidentWeatherCondition;
    source?: AccidentSource;
    source_year?: number;
    from?: string;
    to?: string;
    minLat?: number;
    maxLat?: number;
    minLng?: number;
    maxLng?: number;
}

export interface AccidentMapItem {
    id: string;
    tipo_acidente: string;
    classificacao_acidente: AccidentClassification;
    condicao_meteorologica: AccidentWeatherCondition;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: AccidentSeverity;
    source: AccidentSource;
}

export interface AccidentMapResult {
    data: AccidentMapItem[];
    total: number;
}

export interface UpdateAccidentBody {
    tipo_acidente?: string;
    description?: string | null;
    classificacao_acidente?: AccidentClassification;
    condicao_meteorologica?: AccidentWeatherCondition;
    latitude?: number;
    longitude?: number;
    occurredAt?: string;
    severity?: AccidentSeverity;
}

export interface CreateAccidentCommentBody {
    body: string;
}

export interface CreateAccidentImageBody {
    fileBuffer: Buffer;
    caption?: string | null;
}

export interface AccidentActor extends AuthUser {}
