import type { AuthUser } from "../auth/auth.types.js";

export type AccidentSeverity = "low" | "medium" | "high" | "critical";
export type AccidentClassification = "com_vitima" | "sem_vitima";
export type AccidentWeatherCondition = "ceu_claro" | "chuva" | "nublado" | "garoa";

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
    created_by_id: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface AccidentComment {
    id: string;
    accident_id: string;
    created_by_id: string;
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
    comments: AccidentComment[];
    images: AccidentImage[];
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
