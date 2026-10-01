ALTER TABLE "Accident"
ADD COLUMN "source_record_id" TEXT,
ADD COLUMN "source_year" INTEGER,
ADD COLUMN "source_record_key" TEXT;

CREATE UNIQUE INDEX "Accident_source_record_key_key"
ON "Accident"("source_record_key");