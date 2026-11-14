import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

export interface MailContent {
    subject: string;
    text: string;
    html: string;
}

/** Resultado do envio, no mesmo formato para SMTP e para a API HTTP. */
export interface MailResult {
    provider: MailProvider;
    messageId?: string;
    accepted: string[];
    rejected: string[];
    response?: string;
}

export type MailProvider = "brevo" | "smtp";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_TIMEOUT_MS = 15_000;

interface MailSettings {
    BREVO_API_KEY: string;
    SMTP_USER: string;
    SMTP_PASS: string;
    SMTP_FROM: string;
}

/**
 * Com `BREVO_API_KEY` o envio usa a API HTTP do Brevo (porta 443); sem ela,
 * o SMTP do Gmail. O remetente é sempre `SMTP_FROM`.
 */
export function resolveMailProvider(settings: MailSettings = env): MailProvider | null {
    if (!settings.SMTP_FROM) return null;
    if (settings.BREVO_API_KEY) return "brevo";
    if (settings.SMTP_USER && settings.SMTP_PASS) return "smtp";
    return null;
}

/** Algum meio de envio (API HTTP ou SMTP) está configurado. */
export function isMailConfigured(): boolean {
    return resolveMailProvider() !== null;
}

/** Aceita `email@x.com` ou `Nome <email@x.com>`. */
export function parseMailAddress(value: string): { email: string; name?: string } {
    const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (match) {
        const name = match[1].trim();
        return name ? { email: match[2].trim(), name } : { email: match[2].trim() };
    }
    return { email: value.trim() };
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

async function sendWithSmtp(to: string, content: MailContent): Promise<MailResult> {
    const transporter = createMailTransporter();
    try {
        const info = await transporter.sendMail({
            from: env.SMTP_FROM,
            to,
            subject: content.subject,
            text: content.text,
            html: content.html,
        });
        return {
            provider: "smtp",
            messageId: info.messageId,
            accepted: info.accepted.map(String),
            rejected: info.rejected.map(String),
            response: info.response,
        };
    } finally {
        transporter.close();
    }
}

/**
 * Envia pela API transacional do Brevo. Erros HTTP viram exceção com o
 * código e a mensagem devolvidos pelo Brevo (nunca a chave).
 */
export async function sendWithBrevo(
    apiKey: string,
    from: string,
    to: string,
    content: MailContent,
    fetchImpl: typeof fetch = fetch,
): Promise<MailResult> {
    const response = await fetchImpl(BREVO_SEND_URL, {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            "api-key": apiKey,
        },
        body: JSON.stringify({
            sender: parseMailAddress(from),
            to: [{ email: to }],
            subject: content.subject,
            htmlContent: content.html,
            textContent: content.text,
        }),
        signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });

    let body: { messageId?: string; code?: string; message?: string } = {};
    try {
        body = (await response.json()) as typeof body;
    } catch {
        // Corpo vazio ou não-JSON: fica só o status.
    }

    if (!response.ok) {
        const detail = [body.code, body.message].filter(Boolean).join(": ");
        throw new Error(
            `Brevo respondeu HTTP ${response.status}${detail ? ` (${detail})` : ""}`,
        );
    }

    return {
        provider: "brevo",
        messageId: body.messageId,
        accepted: [to],
        rejected: [],
        response: `HTTP ${response.status}`,
    };
}

/**
 * Envia uma mensagem pelo remetente da plataforma. Erros do provedor chegam a
 * quem chamou.
 */
export async function sendMail(to: string, content: MailContent): Promise<MailResult> {
    if (resolveMailProvider() === "brevo") {
        return sendWithBrevo(env.BREVO_API_KEY, env.SMTP_FROM, to, content);
    }
    return sendWithSmtp(to, content);
}
