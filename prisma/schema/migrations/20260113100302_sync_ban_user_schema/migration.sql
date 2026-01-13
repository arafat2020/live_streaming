/*
  Warnings:

  - You are about to drop the `channel_bans` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "public"."channel_bans" DROP CONSTRAINT "channel_bans_channelId_fkey";

-- DropForeignKey
ALTER TABLE "public"."channel_bans" DROP CONSTRAINT "channel_bans_userId_fkey";

-- AlterTable
ALTER TABLE "banuser" ADD COLUMN     "bannedBy" TEXT,
ADD COLUMN     "reason" TEXT;

-- DropTable
DROP TABLE "public"."channel_bans";

-- CreateTable
CREATE TABLE "platform_ban_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "banType" "BanType" NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_ban_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unban_appeals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'PENDING',
    "moderatorNote" TEXT,
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unban_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unban_appeals_userId_channelId_status_key" ON "unban_appeals"("userId", "channelId", "status");

-- AddForeignKey
ALTER TABLE "platform_ban_logs" ADD CONSTRAINT "platform_ban_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unban_appeals" ADD CONSTRAINT "unban_appeals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unban_appeals" ADD CONSTRAINT "unban_appeals_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
