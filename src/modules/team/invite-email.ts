import type { FastifyBaseLogger } from "fastify";
import { env } from "../../shared/config/env.js";
import {
    createMailTransporter,
    isMailConfigured,
} from "../auth/auth.service.js";

function escapeHtml(value: string) {
    return value
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;")
        .split('"').join("&quot;")
        .split("'").join("&#39;");
}

export interface ModeratorInviteMessage {
    to: string;
    inviteUrl: string;
    inviterName: string;
    expiresAt: Date;
}

/** Link do convite. O token vai no fragmento (#), que não chega a servidores nem ao Referer. */
export function buildInviteUrl(token: string) {
    return `${env.ADMIN_PANEL_URL}/invite#token=${encodeURIComponent(token)}`;
}

function formatExpiry(date: Date) {
    return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "America/Fortaleza",
    }).format(date);
}

export function buildModeratorInviteEmail(message: ModeratorInviteMessage) {
    const inviter = escapeHtml(message.inviterName);
    const url = escapeHtml(message.inviteUrl);
    const expiry = formatExpiry(message.expiresAt);

    return {
        subject: "Convite para a equipe de moderação do Farol",
        text: `Olá!\n\n${message.inviterName} convidou você para moderar relatos no painel do Farol.\n\nPara aceitar, abra o link abaixo e entre com a sua conta do Farol (o mesmo e-mail que recebeu este convite, já verificado):\n${message.inviteUrl}\n\nO convite vale até ${expiry}. Se ainda não tem conta, crie uma no aplicativo Farol com este e-mail e verifique-o antes de aceitar.\n\nSe você não esperava este convite, ignore este e-mail.`,
        html: `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Convite para moderação | Farol</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;">
        <tr><td style="background:#0058bc;padding:28px 32px;text-align:center;">
          <div style="font-size:25px;font-weight:700;letter-spacing:.3px;color:#ffffff;">Farol</div>
          <div style="margin-top:7px;font-size:13px;color:#dbeafe;">Painel administrativo</div>
        </td></tr>
        <tr><td style="padding:36px 32px 18px;">
          <h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:#0f172a;">Você foi convidado para a moderação</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#475569;"><strong>${inviter}</strong> convidou você para analisar relatos da comunidade no painel do Farol.</p>
          <p style="margin:0 0 26px;text-align:center;">
            <a href="${url}" style="display:inline-block;padding:14px 26px;border-radius:12px;background:#0058bc;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Aceitar convite</a>
          </p>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#475569;">Entre com a sua conta do Farol usando <strong>este mesmo e-mail</strong>, já verificado. O convite vale até <strong>${escapeHtml(expiry)}</strong>.</p>
          <p style="margin:0 0 10px;font-size:13px;line-height:1.7;color:#64748b;">Ainda não tem conta? Crie uma no aplicativo Farol com este e-mail e verifique-o antes de aceitar.</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">Se você não esperava este convite, ignore este e-mail.</p>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;text-align:center;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">Mensagem automática do Farol. Não responda a este e-mail.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    };
}

/** Envia o convite. Retorna `false` quando o e-mail não saiu. */
export type ModeratorInviteMailer = (
    message: ModeratorInviteMessage,
    logger: FastifyBaseLogger,
) => Promise<boolean>;

const smtpMailer: ModeratorInviteMailer = async (message, logger) => {
    if (!isMailConfigured()) {
        if (env.NODE_ENV !== "production") {
            logger.warn(
                { to: message.to, inviteUrl: message.inviteUrl },
                "SMTP não configurado: link do convite de moderador (somente desenvolvimento)",
            );
        } else {
            logger.error("SMTP não configurado: convite de moderador não enviado");
        }
        return false;
    }

    const transporter = createMailTransporter();
    const content = buildModeratorInviteEmail(message);
    try {
        await transporter.sendMail({
            from: env.SMTP_FROM,
            to: message.to,
            subject: content.subject,
            text: content.text,
            html: content.html,
        });
        return true;
    } catch (error) {
        logger.error({ err: error }, "Moderator invite delivery failed");
        return false;
    } finally {
        transporter.close();
    }
};

let currentMailer: ModeratorInviteMailer = smtpMailer;

export function sendModeratorInviteEmail(
    message: ModeratorInviteMessage,
    logger: FastifyBaseLogger,
) {
    return currentMailer(message, logger);
}

/**
 * Troca o envio de e-mail (usado pelos testes para capturar o link sem
 * mandar e-mail de verdade). `null` volta para o SMTP.
 */
export function setModeratorInviteMailer(mailer: ModeratorInviteMailer | null) {
    currentMailer = mailer ?? smtpMailer;
}
