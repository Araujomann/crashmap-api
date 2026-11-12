import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../../shared/config/env.js";
import { prisma } from "../../shared/database/prisma.js";
import { buildVerificationEmail } from "./verification-email.js";

export async function resendVerificationEmail(
    email: string,
    logger: FastifyBaseLogger,
): Promise<void> {
    const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
        return;
    }

    // Se o e-mail já estiver verificado, não faz nada
    if (user.is_email_verified) {
        return;
    }

    // Gera um novo token de verificação
    const verificationToken = randomBytes(32).toString("hex");
    await prisma.verificationToken.create({
        data: {
            user_id: user.id,
            token: verificationToken,
            expires_at: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
        },
    });

    // Envia e-mail de verificação via Nodemailer
    if (env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM) {
        const verificationLink = `${env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
        const verificationEmail = buildVerificationEmail(user.name, verificationLink);

        const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            auth: {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS,
            },
        });

        try {
            await transporter.sendMail({
                from: env.SMTP_FROM,
                to: user.email,
                subject: verificationEmail.subject,
                text: verificationEmail.text,
                html: verificationEmail.html,
            });
        } catch (error) {
            // Log error but don't fail resend
            console.error("Failed to send verification email:", error);
        } finally {
            transporter.close();
        }
    }
}