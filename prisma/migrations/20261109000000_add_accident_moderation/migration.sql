CREATE TYPE "accident_moderation_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Accident"
ADD COLUMN "moderation_status" "accident_moderation_status" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "moderation_message" TEXT,
ADD COLUMN "moderation_internal_note" TEXT,
ADD COLUMN "moderated_at" TIMESTAMP(3),
ADD COLUMN "moderated_by_id" TEXT;

-- Existing records are already visible to users; preserve that behavior during rollout.
UPDATE "Accident"
SET "moderation_status" = 'APPROVED'
WHERE "moderation_status" = 'PENDING';

CREATE INDEX "Accident_moderation_status_created_at_idx"
ON "Accident"("moderation_status", "created_at");

CREATE TABLE "AccidentModerationHistory" (
    "id" TEXT NOT NULL,
    "accident_id" TEXT NOT NULL,
    "moderated_by_id" TEXT NOT NULL,
    "previous_status" "accident_moderation_status" NOT NULL,
    "new_status" "accident_moderation_status" NOT NULL,
    "public_message" TEXT,
    "internal_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccidentModerationHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccidentModerationHistory_accident_id_created_at_idx"
ON "AccidentModerationHistory"("accident_id", "created_at");

CREATE INDEX "AccidentModerationHistory_moderated_by_id_idx"
ON "AccidentModerationHistory"("moderated_by_id");

ALTER TABLE "Accident"
ADD CONSTRAINT "Accident_moderated_by_id_fkey"
FOREIGN KEY ("moderated_by_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccidentModerationHistory"
ADD CONSTRAINT "AccidentModerationHistory_accident_id_fkey"
FOREIGN KEY ("accident_id") REFERENCES "Accident"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccidentModerationHistory"
ADD CONSTRAINT "AccidentModerationHistory_moderated_by_id_fkey"
FOREIGN KEY ("moderated_by_id") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

