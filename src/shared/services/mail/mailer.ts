import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

export interface MailContent {
    subject: string;
    text: string;
    html: string;
}

/** SMTP só está disponível com usuário, senha e remetente definidos. */
export function isMailConfigured(): boolean {
    return Boolean(env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}

export function createMailTransporter() {
    return nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
        },
    });
}

/**
 * Envia uma mensagem pelo remetente da plataforma. Abre e fecha a conexão a
 * cada envio; erros do SMTP chegam a quem chamou.
 */
export async function sendMail(to: string, content: MailContent) {
    const transporter = createMailTransporter();

    try {
        return await transporter.sendMail({
            from: env.SMTP_FROM,
            to,
            subject: content.subject,
            text: content.text,
            html: content.html,
        });
    } finally {
        transporter.close();
    }
}
