import { AuthError } from "./auth.errors.js";
import { permissionsFor } from "./permissions.js";
import type { AuthUser, UserRole } from "./auth.types.js";

const userRoles = ["user", "moderator", "admin"] as const;

export function isUserRole(value: string): value is UserRole {
    return userRoles.includes(value as UserRole);
}

/** Visão pública da conta, com as permissões derivadas do papel. */
export function toAuthUser(user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    is_email_verified: boolean;
    email_verified_at: Date | null;
    terms_version: string | null;
    terms_accepted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}): AuthUser {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: permissionsFor(user.role),
        is_email_verified: user.is_email_verified,
        email_verified_at: user.email_verified_at,
        terms_version: user.terms_version,
        terms_accepted_at: user.terms_accepted_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
    };
}

/** Conta suspensa por um administrador não autentica nem renova sessão. */
export function ensureNotSuspended(user: { suspended_at: Date | null }) {
    if (user.suspended_at) {
        throw new AuthError(
            "Esta conta está suspensa. Entre em contato com a equipe do Farol.",
            403,
            "AUTH_ACCOUNT_SUSPENDED",
        );
    }
}
