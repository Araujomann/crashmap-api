import assert from "node:assert/strict";
import test from "node:test";
import {
    buildModeratorInviteEmail,
    isPublicPanelUrl,
} from "../src/modules/team/invite-email.js";

const message = {
    to: "pessoa@example.com",
    inviteUrl: "http://localhost:3000/invite#token=abc123abc123abc123abc123",
    inviteCode: "abc123abc123abc123abc123",
    inviterName: "Ana",
    expiresAt: new Date("2026-11-16T12:00:00.000Z"),
};

test("only public HTTPS panel addresses get a clickable invite link", () => {
    assert.equal(isPublicPanelUrl("https://painel.farol.app"), true);
    for (const url of [
        "http://localhost:3000",
        "https://localhost:3000",
        "http://painel.farol.app",
        "https://127.0.0.1",
        "https://192.168.0.5:3000",
        "https://10.0.0.2",
        "https://172.20.1.1",
        "não é url",
    ]) {
        assert.equal(isPublicPanelUrl(url), false, url);
    }
});

test("local invite email carries the code and no link at all", () => {
    const email = buildModeratorInviteEmail(message, false);
    assert.ok(email.html.includes(message.inviteCode));
    assert.ok(email.text.includes(message.inviteCode));
    assert.doesNotMatch(email.html, /href=|localhost/);
    assert.doesNotMatch(email.text, /localhost|https?:\/\//);
});

test("public invite email has the button and the code as fallback", () => {
    const email = buildModeratorInviteEmail(
        { ...message, inviteUrl: "https://painel.farol.app/invite#token=abc" },
        true,
    );
    assert.match(email.html, /href="https:\/\/painel\.farol\.app\/invite#token=abc"/);
    assert.ok(email.html.includes(message.inviteCode));
    assert.ok(email.text.includes("https://painel.farol.app/invite#token=abc"));
});
