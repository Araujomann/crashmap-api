-- CreateTable
CREATE TABLE "AccidentComment" (
    "id" TEXT NOT NULL,
    "accident_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccidentComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccidentImage" (
    "id" TEXT NOT NULL,
    "accident_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccidentImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccidentComment_accident_id_idx" ON "AccidentComment"("accident_id");

-- CreateIndex
CREATE INDEX "AccidentComment_created_by_id_idx" ON "AccidentComment"("created_by_id");

-- CreateIndex
CREATE INDEX "AccidentComment_created_at_idx" ON "AccidentComment"("created_at");

-- CreateIndex
CREATE INDEX "AccidentImage_accident_id_idx" ON "AccidentImage"("accident_id");

-- CreateIndex
CREATE INDEX "AccidentImage_created_by_id_idx" ON "AccidentImage"("created_by_id");

-- CreateIndex
CREATE INDEX "AccidentImage_created_at_idx" ON "AccidentImage"("created_at");

-- AddForeignKey
ALTER TABLE "AccidentComment" ADD CONSTRAINT "AccidentComment_accident_id_fkey" FOREIGN KEY ("accident_id") REFERENCES "Accident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccidentComment" ADD CONSTRAINT "AccidentComment_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccidentImage" ADD CONSTRAINT "AccidentImage_accident_id_fkey" FOREIGN KEY ("accident_id") REFERENCES "Accident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccidentImage" ADD CONSTRAINT "AccidentImage_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
