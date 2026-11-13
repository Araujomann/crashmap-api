-- Verificação de e-mail passa a usar códigos de 6 dígitos (um por usuário).
-- Tokens antigos (links) não são mais válidos.
DELETE FROM "VerificationToken";

ALTER TABLE "VerificationToken"
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "VerificationToken_user_id_idx";
CREATE UNIQUE INDEX "VerificationToken_user_id_key" ON "VerificationToken"("user_id");
