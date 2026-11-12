WITH ranked_tokens AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "user_id"
            ORDER BY "created_at" DESC, "id" DESC
        ) AS position
    FROM "PasswordResetToken"
)
DELETE FROM "PasswordResetToken"
WHERE "id" IN (
    SELECT "id" FROM ranked_tokens WHERE position > 1
);

ALTER TABLE "PasswordResetToken"
    ALTER COLUMN "token_hash" DROP NOT NULL,
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "request_count" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "request_window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "authorization_hash" TEXT,
    ADD COLUMN "authorization_expires_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "PasswordResetToken_user_id_idx";
CREATE UNIQUE INDEX "PasswordResetToken_user_id_key" ON "PasswordResetToken"("user_id");
CREATE UNIQUE INDEX "PasswordResetToken_authorization_hash_key" ON "PasswordResetToken"("authorization_hash");
CREATE INDEX "PasswordResetToken_authorization_expires_at_idx" ON "PasswordResetToken"("authorization_expires_at");
