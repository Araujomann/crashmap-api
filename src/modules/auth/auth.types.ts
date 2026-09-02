export type UserRole = "user" | "moderator" | "admin";

export interface AccessTokenPayload {
    sub: string;
    email: string;
    role: UserRole;
    type: "access";
    iat: number;
    exp: number;
}

export interface AuthUser {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    is_email_verified: boolean;
    created_at: Date;
    updated_at: Date;
}

export interface RegisterBody {
    name: string;
    email: string;
    password: string;
}

export interface LoginBody {
    email: string;
    password: string;
}

export interface RefreshBody {
    refreshToken: string;
}

export interface LogoutBody {
    refreshToken: string;
}

export interface VerifyEmailBody {
    token: string;
}

export type RegisterResponse = AuthResponse;

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
}

export interface AuthResponse {
    user: AuthUser;
    tokens: AuthTokens;
}
