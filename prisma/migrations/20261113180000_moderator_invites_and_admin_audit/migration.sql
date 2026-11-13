-- Ações administrativas auditadas.
CREATE TYPE "admin_audit_action" AS ENUM (
    'MODERATOR_INVITE_CREATED',
    'MODERATOR_INVITE_RESENT',
    'MODERATOR_INVITE_REVOKED',
    'MODERATOR_INVITE_ACCEPTED',
    'MODERATOR_ROLE_REVOKED',
    'REPORT_EDITED_BY_STAFF',
    'REPORT_DELETED_BY_STAFF',
    'COMMENT_DELETED_BY_STAFF',
    'IMAGE_DELETED_BY_STAFF'
);

-- Convites de moderador. O token nunca é salvo, só o HMAC dele.
CREATE TABLE "moderator_invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "send_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderator_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "moderator_invites_token_hash_key" ON "moderator_invites"("token_hash");
CREATE INDEX "moderator_invites_email_idx" ON "moderator_invites"("email");
CREATE INDEX "moderator_invites_expires_at_idx" ON "moderator_invites"("expires_at");
CREATE INDEX "moderator_invites_created_at_idx" ON "moderator_invites"("created_at");

-- No máximo um convite em aberto (não aceito e não revogado) por e-mail.
CREATE UNIQUE INDEX "moderator_invites_one_open_per_email"
    ON "moderator_invites"("email")
    WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

ALTER TABLE "moderator_invites"
    ADD CONSTRAINT "moderator_invites_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderator_invites"
    ADD CONSTRAINT "moderator_invites_accepted_by_id_fkey"
    FOREIGN KEY ("accepted_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderator_invites"
    ADD CONSTRAINT "moderator_invites_revoked_by_id_fkey"
    FOREIGN KEY ("revoked_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Auditoria administrativa.
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" "admin_audit_action" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");
CREATE INDEX "admin_audit_logs_actor_id_created_at_idx" ON "admin_audit_logs"("actor_id", "created_at");
CREATE INDEX "admin_audit_logs_target_type_target_id_idx" ON "admin_audit_logs"("target_type", "target_id");

ALTER TABLE "admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A auditoria é somente-inserção. Mesma válvula de escape do histórico de
-- moderação, com outra chave: `crashmap.allow_audit_purge` libera DELETE
-- (nunca UPDATE) só dentro da transação que a ligou.
CREATE FUNCTION "forbid_admin_audit_mutation"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('crashmap.allow_audit_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'admin_audit_logs é somente-inserção (% bloqueado)', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admin_audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION "forbid_admin_audit_mutation"();
