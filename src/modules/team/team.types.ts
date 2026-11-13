import type { UserRole } from "../auth/auth.types.js";

export type InviteStatus = "PENDING" | "EXPIRED" | "ACCEPTED" | "REVOKED";

export interface TeamPerson {
    id: string;
    name: string;
}

export interface ModeratorInvite {
    id: string;
    email: string;
    status: InviteStatus;
    expires_at: Date;
    created_at: Date;
    last_sent_at: Date;
    send_count: number;
    invited_by: TeamPerson;
    accepted_at: Date | null;
    accepted_by: TeamPerson | null;
    revoked_at: Date | null;
    /** `null` com `revoked_at` preenchido = revogado pelo sistema. */
    revoked_by: TeamPerson | null;
}

export interface InviteDelivery {
    invite: ModeratorInvite;
    email_sent: boolean;
}

export interface ListInvitesQuery {
    status?: InviteStatus;
    page?: number;
    limit?: number;
}

export interface TeamMember {
    id: string;
    name: string;
    email: string;
    role: Exclude<UserRole, "user">;
    decisions_count: number;
    created_at: Date;
    /** Quando aceitou o convite mais recente (null para quem entrou por script). */
    joined_at: Date | null;
}

export interface CreateInviteBody {
    email: string;
}

export interface AcceptInviteBody {
    token: string;
}

export interface RevokeModeratorBody {
    reason: string;
}
