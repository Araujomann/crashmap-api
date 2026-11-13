-- Novas ações auditadas (fase 5).
ALTER TYPE "admin_audit_action" ADD VALUE 'USER_SUSPENDED';
ALTER TYPE "admin_audit_action" ADD VALUE 'USER_REACTIVATED';
ALTER TYPE "admin_audit_action" ADD VALUE 'USER_SESSIONS_REVOKED';
ALTER TYPE "admin_audit_action" ADD VALUE 'SETTINGS_UPDATED';
ALTER TYPE "admin_audit_action" ADD VALUE 'ROLE_GRANTED_BY_SCRIPT';

-- Suspensão de contas: reversível, bloqueia login, refresh e qualquer rota.
ALTER TABLE "User" ADD COLUMN "suspended_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "suspended_reason" TEXT;
ALTER TABLE "User" ADD COLUMN "suspended_by_id" TEXT;

ALTER TABLE "User"
    ADD CONSTRAINT "User_suspended_by_id_fkey"
    FOREIGN KEY ("suspended_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_suspended_at_idx" ON "User"("suspended_at");

-- Configurações da plataforma (chave → valor JSON). Só chaves conhecidas,
-- validadas pela API; valores ausentes usam o padrão do código.
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "platform_settings"
    ADD CONSTRAINT "platform_settings_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
