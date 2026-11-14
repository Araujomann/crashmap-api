import assert from "node:assert/strict";
import test from "node:test";
import {
    parseMailAddress,
    resolveMailProvider,
    sendWithBrevo,
} from "../src/shared/services/mail/mailer.js";

const content = {
    subject: "Código de verificação",
    text: "Seu código é 123456",
    html: "<p>Seu código é <strong>123456</strong></p>",
};

test("mail provider: Brevo when the API key is set, SMTP otherwise, none without sender", () => {
    const base = { BREVO_API_KEY: "", SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "" };

    assert.equal(resolveMailProvider(base), null);
    assert.equal(resolveMailProvider({ ...base, SMTP_FROM: "a@x.com" }), null);
    assert.equal(
        resolveMailProvider({ ...base, SMTP_FROM: "a@x.com", SMTP_USER: "a@x.com", SMTP_PASS: "p" }),
        "smtp",
    );
    assert.equal(
        resolveMailProvider({ ...base, SMTP_FROM: "a@x.com", BREVO_API_KEY: "k" }),
        "brevo",
    );
    // Com as duas configurações, a API HTTP tem prioridade.
    assert.equal(
        resolveMailProvider({ SMTP_FROM: "a@x.com", SMTP_USER: "a@x.com", SMTP_PASS: "p", BREVO_API_KEY: "k" }),
        "brevo",
    );
    // Sem remetente, nenhum envio é possível.
    assert.equal(resolveMailProvider({ ...base, BREVO_API_KEY: "k" }), null);
});

test("sender address accepts plain and named forms", () => {
    assert.deepEqual(parseMailAddress("farol@gmail.com"), { email: "farol@gmail.com" });
    assert.deepEqual(parseMailAddress("Farol <farol@gmail.com>"), { email: "farol@gmail.com", name: "Farol" });
    assert.deepEqual(parseMailAddress('"Equipe Farol" <farol@gmail.com>'), {
        email: "farol@gmail.com",
        name: "Equipe Farol",
    });
});

test("Brevo request carries key header, sender, recipient and both bodies", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(JSON.stringify({ messageId: "<abc@relay>" }), { status: 201 });
    }) as unknown as typeof fetch;

    const result = await sendWithBrevo("chave-teste", "Farol <farol@gmail.com>", "ana@exemplo.com", content, fakeFetch);

    assert.equal(captured?.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(captured?.init.method, "POST");
    const headers = captured?.init.headers as Record<string, string>;
    assert.equal(headers["api-key"], "chave-teste");
    assert.deepEqual(JSON.parse(String(captured?.init.body)), {
        sender: { email: "farol@gmail.com", name: "Farol" },
        to: [{ email: "ana@exemplo.com" }],
        subject: content.subject,
        htmlContent: content.html,
        textContent: content.text,
    });
    assert.deepEqual(result, {
        provider: "brevo",
        messageId: "<abc@relay>",
        accepted: ["ana@exemplo.com"],
        rejected: [],
        response: "HTTP 201",
    });
});

test("Brevo errors surface the status and Brevo's message, never the key", async () => {
    const unauthorized = (async () =>
        new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), {
            status: 401,
        })) as unknown as typeof fetch;

    await assert.rejects(
        sendWithBrevo("chave-secreta", "farol@gmail.com", "ana@exemplo.com", content, unauthorized),
        (error: Error) => {
            assert.match(error.message, /HTTP 401 \(unauthorized: Key not found\)/);
            assert.doesNotMatch(error.message, /chave-secreta/);
            return true;
        },
    );

    const htmlError = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    await assert.rejects(
        sendWithBrevo("k", "farol@gmail.com", "ana@exemplo.com", content, htmlError),
        /Brevo respondeu HTTP 502$/,
    );

    const networkDown = (async () => {
        throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await assert.rejects(
        sendWithBrevo("k", "farol@gmail.com", "ana@exemplo.com", content, networkDown),
        /fetch failed/,
    );
});
