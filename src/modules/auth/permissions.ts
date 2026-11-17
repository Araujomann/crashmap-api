import type { UserRole } from "./auth.types.js";







export const PERMISSIONS = [
    "panel:access",
    "reports:read",
    "reports:moderate",
    "moderation_history:read",
    "stats:read",
    "notices:publish",
    "moderators:invite",
    "moderators:revoke",
    "invites:manage",
    "users:manage",
    "audit:read",
    "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MODERATOR_PERMISSIONS: readonly Permission[] = [
    "panel:access",
    "reports:read",
    "reports:moderate",
    "moderation_history:read",
    "stats:read",
    "notices:publish",
];

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
    user: new Set(),
    moderator: new Set(MODERATOR_PERMISSIONS),
    admin: new Set(PERMISSIONS),
};

export function permissionsFor(role: UserRole): Permission[] {
    return PERMISSIONS.filter((permission) =>
        ROLE_PERMISSIONS[role].has(permission),
    );
}

export function can(user: { role: UserRole }, permission: Permission): boolean {
    return ROLE_PERMISSIONS[user.role]?.has(permission) ?? false;
}
