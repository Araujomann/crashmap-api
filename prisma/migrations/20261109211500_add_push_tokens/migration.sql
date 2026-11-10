CREATE TYPE "push_platform" AS ENUM ('android', 'ios');

CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "push_platform" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");
CREATE INDEX "PushToken_user_id_idx" ON "PushToken"("user_id");

ALTER TABLE "PushToken"
ADD CONSTRAINT "PushToken_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
