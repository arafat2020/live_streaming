-- AlterTable
ALTER TABLE "LiveComment" ADD COLUMN     "replyToId" TEXT;

-- AddForeignKey
ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "LiveComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
