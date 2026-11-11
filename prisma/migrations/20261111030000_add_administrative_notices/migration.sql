CREATE TABLE "administrative_notices" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "administrative_notices_created_at_idx"
ON "administrative_notices"("created_at");

ALTER TABLE "administrative_notices"
ADD CONSTRAINT "administrative_notices_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;