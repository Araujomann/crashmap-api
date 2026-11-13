import type { AccidentModerationStatus } from "../accidents/accidents.types.js";
import type { UserRole } from "../auth/auth.types.js";

export interface UpdateMeBody {
    name: string;
}

export interface DeleteMeBody {
    password?: string;
}

export interface UserGamificationStats {
    approved_reports_count: number;
    received_trust_votes_count: number;
}

export interface MyReportsQuery {
    page?: number;
    limit?: number;
    status?: AccidentModerationStatus;
}

export interface MyReportImage {
    id: string;
    image_url: string;
    caption: string | null;
}

export interface MyReport {
    id: string;
    tipo_acidente: string;
    classificacao_acidente: "com_vitima" | "sem_vitima";
    condicao_meteorologica: "ceu_claro" | "chuva" | "nublado" | "garoa";
    description: string | null;
    latitude: number;
    longitude: number;
    occurred_at: Date;
    severity: "low" | "medium" | "high" | "critical";
    source: "APP" | "PRF";
    moderation_status: AccidentModerationStatus;
    moderation_message: string | null;
    moderated_at: Date | null;
    created_by_id: string | null;
    created_at: Date;
    updated_at: Date;
    images: MyReportImage[];
}

export interface MyReportsResult {
    data: MyReport[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface AdminUsersQuery {
    search?: string;
    role?: UserRole;
    status?: "active" | "suspended";
    page?: number;
    limit?: number;
}

export interface AdminUserSummary {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    is_email_verified: boolean;
    created_at: Date;
    suspended_at: Date | null;
    suspended_reason: string | null;
    suspended_by: { id: string; name: string } | null;
}

export interface AdminUserDetail extends AdminUserSummary {
    reports_count: number;
    comments_count: number;
    decisions_count: number;
    active_sessions: number;
}
