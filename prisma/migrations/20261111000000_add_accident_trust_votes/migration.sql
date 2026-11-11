CREATE TABLE "AccidentTrustVote" (
    "id" TEXT NOT NULL,
    "accident_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccidentTrustVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccidentTrustVote_accident_id_created_by_id_key"
ON "AccidentTrustVote"("accident_id", "created_by_id");

CREATE INDEX "AccidentTrustVote_created_by_id_idx"
ON "AccidentTrustVote"("created_by_id");

ALTER TABLE "AccidentTrustVote"
ADD CONSTRAINT "AccidentTrustVote_accident_id_fkey"
FOREIGN KEY ("accident_id") REFERENCES "Accident"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccidentTrustVote"
ADD CONSTRAINT "AccidentTrustVote_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
