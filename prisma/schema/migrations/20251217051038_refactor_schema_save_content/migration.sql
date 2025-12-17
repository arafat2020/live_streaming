/*
  Warnings:

  - You are about to drop the column `r2ObjectKey` on the `content` table. All the data in the column will be lost.
  - Made the column `userId` on table `Stream` required. This step will fail if there are existing NULL values in that column.
  - Made the column `rtmpsUrl` on table `Stream` required. This step will fail if there are existing NULL values in that column.
  - Made the column `playbackUrl` on table `Stream` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "public"."content" DROP CONSTRAINT "content_channelId_fkey";

-- DropIndex
DROP INDEX "public"."Stream_streamKey_key";

-- AlterTable
ALTER TABLE "Stream" ALTER COLUMN "userId" SET NOT NULL,
ALTER COLUMN "rtmpsUrl" SET NOT NULL,
ALTER COLUMN "playbackUrl" SET NOT NULL;

-- AlterTable
ALTER TABLE "content" DROP COLUMN "r2ObjectKey",
ADD COLUMN     "originalFileName" TEXT,
ADD COLUMN     "r2Prefix" TEXT,
ALTER COLUMN "channelId" DROP NOT NULL,
ALTER COLUMN "title" DROP NOT NULL,
ALTER COLUMN "contentType" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "content_channelId_idx" ON "content"("channelId");

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
