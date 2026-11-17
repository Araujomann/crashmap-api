export type ModerationDecisionStatus = "APPROVED" | "REJECTED";

export interface ModerationHistoryQuery {
    page?: number;
    limit?: number;
    moderatorId?: string;
    accidentId?: string;
    status?: ModerationDecisionStatus;
    
    from?: string;
    
    to?: string;
}

export interface ModerationHistoryActor {
    id: string;
    name: string;
    email: string;
    
    is_deleted: boolean;
}

export interface ModerationHistoryEntry {
    id: string;
    previous_status: "PENDING" | "APPROVED" | "REJECTED";
    new_status: "PENDING" | "APPROVED" | "REJECTED";
    public_message: string | null;
    internal_note: string | null;
    created_at: Date;
    moderated_by: ModerationHistoryActor;
    accident: {
        id: string;
        tipo_acidente: string;
        severity: "low" | "medium" | "high" | "critical";
    };
}

export interface ModerationHistoryResult {
    data: ModerationHistoryEntry[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface ModerationHistoryModerator extends ModerationHistoryActor {
    decisions_count: number;
}
