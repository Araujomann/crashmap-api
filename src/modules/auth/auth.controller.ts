import type { FastifyPluginAsync } from "fastify";
import {
    authResponseSchema,
    forgotPasswordBodySchema,
    loginBodySchema,
    logoutResponseSchema,
    meResponseSchema,
    passwordResetAuthorizationResponseSchema,
    refreshBodySchema,
    registerBodySchema,
    resetPasswordBodySchema,
    simpleMessageResponseSchema,
    verifyEmailBodySchema,
    verifyEmailQuerySchema,
    verifyPasswordResetCodeBodySchema,
    resendVerificationBodySchema,
} from "./auth.schema.js";
import {
    loginUser,
    logoutUser,
    requestPasswordReset,
    refreshSession,
    registerUser,
    resetPassword,
    verifyEmail,
    verifyPasswordResetCode,
} from "./auth.service.js";
import { resendVerificationEmail } from "./resend-verification-email.js";
import { requireAuthenticatedUser } from "./auth.guard.js";
import type {
    LoginBody,
    ForgotPasswordBody,
    LogoutBody,
    RefreshBody,
    RegisterBody,
    ResetPasswordBody,
    VerifyEmailBody,
    VerifyPasswordResetCodeBody,
} from "./auth.types.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
    app.post<{ Body: ForgotPasswordBody }>(
        "/forgot-password",
        {
            schema: {
                tags: ["Auth"],
                summary: "Solicita um código para redefinir a senha",
                body: forgotPasswordBodySchema,
                response: { 200: simpleMessageResponseSchema },
            },
        },
        async (request, reply) => {
            await requestPasswordReset(request.body.email, request.log);

            return reply.code(200).send({
                data: {
                    message:
                        "Se houver uma conta associada a este e-mail, enviaremos um código de recuperação.",
                },
            });
        },
    );

    app.post<{ Body: VerifyPasswordResetCodeBody }>(
        "/verify-password-reset-code",
        {
            schema: {
                tags: ["Auth"],
                summary: "Valida o código de recuperação de senha",
                body: verifyPasswordResetCodeBodySchema,
                response: {
                    200: passwordResetAuthorizationResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const authorizationToken = await verifyPasswordResetCode(
                request.body,
            );

            return reply.code(200).send({
                data: { authorizationToken },
            });
        },
    );

    app.post<{ Body: ResetPasswordBody }>(
        "/reset-password",
        {
            schema: {
                tags: ["Auth"],
                summary: "Redefine a senha usando uma autorização válida",
                body: resetPasswordBodySchema,
                response: { 200: simpleMessageResponseSchema },
            },
        },
        async (request, reply) => {
            await resetPassword(request.body);

            return reply.code(200).send({
                data: { message: "Senha redefinida com sucesso." },
            });
        },
    );

    app.post<{ Body: RegisterBody }>(
        "/register",
        {
            schema: {
                tags: ['Auth'],
                summary: 'Registra um novo usuário',
                body: registerBodySchema,
                response: {
                    201: authResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const result = await registerUser(request.body);

            return reply.code(201).send({ data: result });
        },
    );

    app.post<{ Body: VerifyEmailBody }>(
        "/verify-email",
        {
            schema: {
                tags: ['Auth'],
                summary: 'Verifica e-mail do usuário via token (POST)',
                body: verifyEmailBodySchema,
                response: {
                    200: simpleMessageResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await verifyEmail(request.body.token);

            return reply.code(200).send({ data: { message: "Email successfully verified!" } });
        },
    );

    app.get<{ Querystring: { token: string } }>(
        "/verify-email",
        {
            schema: {
                tags: ['Auth'],
                summary: 'Verifica e-mail do usuário via token (GET para navegador)',
                querystring: verifyEmailQuerySchema,
                response: {
                    200: simpleMessageResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await verifyEmail(request.query.token);

            return reply.code(200).send({ data: { message: "Email successfully verified!" } });
        },
    );

    app.post<{ Body: { email: string } }>(
        "/resend-verification",
        {
            schema: {
                tags: ['Auth'],
                summary: 'Reenvia e-mail de verificação',
                body: resendVerificationBodySchema,
                response: {
                    200: simpleMessageResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await resendVerificationEmail(request.body.email, reply.log);

            return reply.code(200).send({
                data: {
                    message: "Se houver uma conta associada a este e-mail que ainda não foi verificada, enviaremos um novo e-mail de verificação.",
                },
            });
        },
    );

    app.post<{ Body: LoginBody }>(
        "/login",
        {
            schema: {
                tags: ['Auth'],
                summary: 'Realiza login na aplicação',
                body: loginBodySchema,
                response: {
                    200: authResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const result = await loginUser(request.body);

            return reply.code(200).send({ data: result });
        },
    );

    app.post<{ Body: RefreshBody }>(
        "/refresh",
        {
            schema: {
                tags: ['Auth'],
                summary: 'Renova o token de acesso (Refresh Token)',
                body: refreshBodySchema,
                response: {
                    200: authResponseSchema,
                },
            },
        },
        async (request, reply) => {
            const result = await refreshSession(request.body);

            return reply.code(200).send({ data: result });
        },
    );

    app.post<{ Body: LogoutBody }>(
        "/logout",
        {
            schema: {
                tags: ['Auth'],
                summary: 'Revoga o Refresh Token atual',
                body: refreshBodySchema,
                response: {
                    200: logoutResponseSchema,
                },
            },
        },
        async (request, reply) => {
            await logoutUser(request.body);

            return reply.code(200).send({ data: { revoked: true } });
        },
    );

    app.get(
        "/me",
        {
            preHandler: requireAuthenticatedUser,
            schema: {
                tags: ['Auth'],
                summary: 'Obter perfil atual usando autenticação',
                security: [{ bearerAuth: [] }],
                response: {
                    200: meResponseSchema,
                },
            },
        },
        async (request, reply) => {
            return reply.code(200).send({ data: request.authUser! });
        },
    );
};
