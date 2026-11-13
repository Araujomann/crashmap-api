export type ModerationDecisionStatus = "APPROVED" | "REJECTED";

export interface ModerationHistoryQuery {
    page?: number;
    limit?: number;
    moderatorId?: string;
    accidentId?: string;
    status?: ModerationDecisionStatus;
    /** Data inicial (YYYY-MM-DD), inclusiva, em UTC. */
    from?: string;
    /** Data final (YYYY-MM-DD), inclusiva, em UTC. */
    to?: string;
}

export interface ModerationHistoryActor {
    id: string;
    name: string;
    email: string;
    /** Conta removida e anonimizada; a autoria da decisão é preservada. */
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
