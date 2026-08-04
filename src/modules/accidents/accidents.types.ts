import type { AuthUser } from "../auth/auth.types.js";

export type AccidentSeverity = "low" | "medium" | "high" | "critical";

export interface Accident {
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
    title: string;
    description?: string;
    latitude: number;
    longitude: number;
    occurredAt: string;
    severity: AccidentSeverity;
}

export interface UpdateAccidentBody {
    title?: string;
    description?: string | null;
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
