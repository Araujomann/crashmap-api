function escapeHtml(value: string) {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}

export function buildVerificationCodeEmail(name: string, code: string) {
  const safeName = escapeHtml(name);

  return {
    subject: "Seu código de verificação no Farol",
    text: `Olá, ${name}.\n\nUse o código ${code} para verificar seu e-mail no Farol. Ele expira em 1 hora. Se você não criou a conta, ignore este e-mail.`,
    html: `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Verificação de e-mail | Farol</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;">
        <tr><td style="background:#0058bc;padding:28px 32px;text-align:center;">
          <div style="font-size:25px;font-weight:700;letter-spacing:.3px;color:#ffffff;">Farol</div>
          <div style="margin-top:7px;font-size:13px;color:#dbeafe;">Mais segurança no seu caminho</div>
        </td></tr>
        <tr><td style="padding:36px 32px 18px;">
          <h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:#0f172a;">Verifique seu e-mail</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569;">Olá, ${safeName}! Use o código abaixo para verificar seu e-mail e ter acesso completo ao aplicativo.</p>
          <div style="margin:0 auto 24px;padding:18px 12px;border:1px solid #dbeafe;border-radius:14px;background:#eff6ff;text-align:center;">
            <span style="font-size:32px;font-weight:700;letter-spacing:10px;color:#0058bc;">${code}</span>
          </div>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#475569;">O código expira em <strong>1 hora</strong>.</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">Se você não criou uma conta no Farol, ignore este e-mail.</p>
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
