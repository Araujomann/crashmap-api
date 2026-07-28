-- CreateEnum
CREATE TYPE "accident_severity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateTable
CREATE TABLE "Accident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "severity" "accident_severity" NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Accident_created_by_id_idx" ON "Accident"("created_by_id");

-- CreateIndex
CREATE INDEX "Accident_occurred_at_idx" ON "Accident"("occurred_at");

-- CreateIndex
CREATE INDEX "Accident_severity_idx" ON "Accident"("severity");

-- AddForeignKey
ALTER TABLE "Accident" ADD CONSTRAINT "Accident_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
