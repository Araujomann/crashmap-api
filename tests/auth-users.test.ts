import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { hashPasswordResetCode } from "../src/modules/auth/auth.service.js";
import { prisma } from "../src/shared/database/prisma.js";

test("auth flow supports register, login, refresh, and logout", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `auth-test-${uniqueSuffix}@example.com`;
    const password = "Test12345!";
    const name = `Auth Test User ${uniqueSuffix}`;

    let userId: string | undefined;
    let refreshTokenToRevoke: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name,
                email,
                password,
            },
        });

        assert.equal(registerResponse.statusCode, 201);
        const registerBody = registerResponse.json();
        assert.equal(registerBody.data.user.email, email);
        userId = registerBody.data.user.id as string;

        await prisma.user.update({ where: { id: userId }, data: { is_email_verified: true } });
        const loginResponse = await app.inject({
            method: "POST",
            url: "/auth/login",
            payload: {
                email,
                password,
            },
        });

        assert.equal(loginResponse.statusCode, 200);
        const loginBody = loginResponse.json();
        assert.equal(loginBody.data.user.id, userId);

        const refreshResponse = await app.inject({
            method: "POST",
            url: "/auth/refresh",
            payload: {
                refreshToken: loginBody.data.tokens.refreshToken,
            },
        });

        assert.equal(refreshResponse.statusCode, 200);
        const refreshBody = refreshResponse.json();
        refreshTokenToRevoke = refreshBody.data.tokens.refreshToken as string;
        assert.equal(refreshBody.data.user.id, userId);

        const logoutResponse = await app.inject({
            method: "POST",
            url: "/auth/logout",
            payload: {
                refreshToken: refreshTokenToRevoke,
            },
        });

        assert.equal(logoutResponse.statusCode, 200);
        assert.equal(logoutResponse.json().data.revoked, true);

        const revokedRefreshResponse = await app.inject({
            method: "POST",
            url: "/auth/refresh",
            payload: {
                refreshToken: refreshTokenToRevoke,
            },
        });

        assert.equal(revokedRefreshResponse.statusCode, 401);
        assert.equal(
            revokedRefreshResponse.json().error.code,
            "AUTH_INVALID_REFRESH_TOKEN",
        );
    } finally {
        if (userId) {
            await prisma.refreshToken.deleteMany({
                where: { user_id: userId },
            });
            await prisma.user.deleteMany({ where: { id: userId } });
        }

        await app.close();
    }
});

test("password reset updates the password and invalidates its token and sessions", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `password-reset-${uniqueSuffix}@example.com`;
    const oldPassword = "OldTest123!";
    const newPassword = "NewTest456!";
    const resetCode = "012345";
    let userId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Password Reset ${uniqueSuffix}`,
                email,
                password: oldPassword,
            },
        });
        assert.equal(registerResponse.statusCode, 201);

        const registered = registerResponse.json().data;
        userId = registered.user.id as string;
        const refreshToken = registered.tokens.refreshToken as string;
        await prisma.passwordResetToken.create({
            data: {
                user_id: userId,
                token_hash: hashPasswordResetCode(userId, resetCode),
                expires_at: new Date(Date.now() + 5 * 60 * 1000),
            },
        });

        const invalidCodeResponse = await app.inject({
            method: "POST",
            url: "/auth/verify-password-reset-code",
            payload: { email, code: "999999" },
        });
        assert.equal(invalidCodeResponse.statusCode, 400);
        assert.equal(
            invalidCodeResponse.json().error.code,
            "AUTH_INVALID_PASSWORD_RESET_CODE",
        );

        const verifyResponse = await app.inject({
            method: "POST",
            url: "/auth/verify-password-reset-code",
            payload: { email, code: resetCode },
        });
        assert.equal(verifyResponse.statusCode, 200);
        const authorizationToken = verifyResponse.json().data
            .authorizationToken as string;

        const resetResponse = await app.inject({
            method: "POST",
            url: "/auth/reset-password",
            payload: { authorizationToken, newPassword },
        });
        assert.equal(resetResponse.statusCode, 200);

        const reusedAuthorizationResponse = await app.inject({
            method: "POST",
            url: "/auth/reset-password",
            payload: { authorizationToken, newPassword: oldPassword },
        });
        assert.equal(reusedAuthorizationResponse.statusCode, 400);
        assert.equal(
            reusedAuthorizationResponse.json().error.code,
            "AUTH_INVALID_PASSWORD_RESET_AUTHORIZATION",
        );

        const oldLoginResponse = await app.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email, password: oldPassword },
        });
        assert.equal(oldLoginResponse.statusCode, 401);

        const newLoginResponse = await app.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email, password: newPassword },
        });
        assert.equal(newLoginResponse.statusCode, 200);

        const revokedRefreshResponse = await app.inject({
            method: "POST",
            url: "/auth/refresh",
            payload: { refreshToken },
        });
        assert.equal(revokedRefreshResponse.statusCode, 401);
    } finally {
        if (userId) {
            await prisma.refreshToken.deleteMany({ where: { user_id: userId } });
            await prisma.passwordResetToken.deleteMany({ where: { user_id: userId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        }

        await app.close();
    }
});

test("password reset codes stop working after five failed attempts", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `password-reset-limit-${uniqueSuffix}@example.com`;
    const code = "654321";
    let userId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name: `Password Reset Limit ${uniqueSuffix}`,
                email,
                password: "OldTest123!",
            },
        });
        assert.equal(registerResponse.statusCode, 201);
        userId = registerResponse.json().data.user.id as string;

        await prisma.passwordResetToken.create({
            data: {
                user_id: userId,
                token_hash: hashPasswordResetCode(userId, code),
                expires_at: new Date(Date.now() + 5 * 60 * 1000),
                attempts: 4,
            },
        });

        const fifthAttempt = await app.inject({
            method: "POST",
            url: "/auth/verify-password-reset-code",
            payload: { email, code: "111111" },
        });
        assert.equal(fifthAttempt.statusCode, 400);

        const attemptAfterLimit = await app.inject({
            method: "POST",
            url: "/auth/verify-password-reset-code",
            payload: { email, code },
        });
        assert.equal(attemptAfterLimit.statusCode, 400);
        assert.equal(
            attemptAfterLimit.json().error.code,
            "AUTH_INVALID_PASSWORD_RESET_CODE",
        );
    } finally {
        if (userId) {
            await prisma.refreshToken.deleteMany({ where: { user_id: userId } });
            await prisma.passwordResetToken.deleteMany({ where: { user_id: userId } });
            await prisma.user.deleteMany({ where: { id: userId } });
        }

        await app.close();
    }
});

test("users me flow returns and updates the current profile", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const email = `users-test-${uniqueSuffix}@example.com`;
    const password = "Test12345!";
    const name = `Users Test User ${uniqueSuffix}`;

    let userId: string | undefined;

    try {
        const registerResponse = await app.inject({
            method: "POST",
            url: "/auth/register",
            payload: {
                name,
                email,
                password,
            },
        });

        assert.equal(registerResponse.statusCode, 201);
        const registerBody = registerResponse.json();
        const accessToken = registerBody.data.tokens.accessToken as string;
        userId = registerBody.data.user.id as string;

        const meResponse = await app.inject({
            method: "GET",
            url: "/users/me",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });

        assert.equal(meResponse.statusCode, 200);
        assert.equal(meResponse.json().data.email, email);

        const updatedName = `Updated ${name}`;
        const updateResponse = await app.inject({
            method: "PATCH",
            url: "/users/me",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
            payload: {
                name: updatedName,
            },
        });

        assert.equal(updateResponse.statusCode, 200);
        assert.equal(updateResponse.json().data.name, updatedName);

        const meAfterUpdateResponse = await app.inject({
            method: "GET",
            url: "/users/me",
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });

        assert.equal(meAfterUpdateResponse.statusCode, 200);
        assert.equal(meAfterUpdateResponse.json().data.name, updatedName);
    } finally {
        if (userId) {
            await prisma.refreshToken.deleteMany({
                where: { user_id: userId },
            });
            await prisma.user.deleteMany({ where: { id: userId } });
        }

        await app.close();
    }
});

test("gamification counts only the authenticated user's approved app reports", async () => {
    const app = await buildApp();
    await app.ready();

    const uniqueSuffix = `${Date.now()}`;
    const password = "Test12345!";
    const userIds: string[] = [];
    const accidentIds: string[] = [];

    try {
        const registerUser = async (email: string, name: string) => {
            const response = await app.inject({
                method: "POST",
                url: "/auth/register",
                payload: { name, email, password },
            });

            assert.equal(response.statusCode, 201);
            const body = response.json();
            userIds.push(body.data.user.id as string);
            return {
                id: body.data.user.id as string,
                accessToken: body.data.tokens.accessToken as string,
            };
        };

        const firstUser = await registerUser(
            `gamification-first-${uniqueSuffix}@example.com`,
            `Gamification First ${uniqueSuffix}`,
        );
        const secondUser = await registerUser(
            `gamification-second-${uniqueSuffix}@example.com`,
            `Gamification Second ${uniqueSuffix}`,
        );

        const createReport = async (
            ownerId: string,
            suffix: string,
            moderationStatus: "PENDING" | "APPROVED",
            source: "APP" | "PRF" = "APP",
        ) => {
            const accident = await prisma.accident.create({
                data: {
                    tipo_acidente: `gamification-${uniqueSuffix}-${suffix}`,
                    classificacao_acidente: "sem_vitima",
                    condicao_meteorologica: "ceu_claro",
                    latitude: -23.55,
                    longitude: -46.63,
                    occurred_at: new Date("2026-11-09T12:00:00.000Z"),
                    severity: "low",
                    created_by_id: ownerId,
                    source,
                    moderation_status: moderationStatus,
                },
            });
            accidentIds.push(accident.id);
        };

        await createReport(firstUser.id, "first-approved", "APPROVED");
        await createReport(firstUser.id, "pending", "PENDING");
        await createReport(firstUser.id, "non-app", "APPROVED", "PRF");
        await createReport(secondUser.id, "second-approved-1", "APPROVED");
        await createReport(secondUser.id, "second-approved-2", "APPROVED");

        const missingAuthResponse = await app.inject({
            method: "GET",
            url: "/users/me/gamification",
        });
        assert.equal(missingAuthResponse.statusCode, 401);

        const firstStatsResponse = await app.inject({
            method: "GET",
            url: "/users/me/gamification",
            headers: {
                authorization: `Bearer ${firstUser.accessToken}`,
            },
        });
        assert.equal(firstStatsResponse.statusCode, 200);
        assert.deepEqual(firstStatsResponse.json().data, {
            approved_reports_count: 1,
        });

        const secondStatsResponse = await app.inject({
            method: "GET",
            url: "/users/me/gamification",
            headers: {
                authorization: `Bearer ${secondUser.accessToken}`,
            },
        });
        assert.equal(secondStatsResponse.statusCode, 200);
        assert.deepEqual(secondStatsResponse.json().data, {
            approved_reports_count: 2,
        });
    } finally {
        if (accidentIds.length > 0) {
            await prisma.accident.deleteMany({
                where: { id: { in: accidentIds } },
            });
        }
        for (const userId of userIds) {
            await prisma.refreshToken.deleteMany({
                where: { user_id: userId },
            });
            await prisma.user.deleteMany({ where: { id: userId } });
        }

        await app.close();
    }
});
