-- AlterTable
ALTER TABLE "content" ADD COLUMN     "fileSize" BIGINT,
ADD COLUMN     "isShadowBanned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isShadowBanned" BOOLEAN NOT NULL DEFAULT false;
