/*
  Warnings:

  - A unique constraint covering the columns `[streamKey]` on the table `Stream` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Stream" ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "rtmpsUrl" DROP NOT NULL,
ALTER COLUMN "playbackUrl" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Stream_streamKey_key" ON "Stream"("streamKey");
