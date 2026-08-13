-- CreateEnum
CREATE TYPE "accident_source" AS ENUM ('APP', 'PRF');

-- AlterTable
ALTER TABLE "Accident" ADD COLUMN     "source" "accident_source" NOT NULL DEFAULT 'APP';
