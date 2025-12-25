-- CreateEnum
CREATE TYPE "BanType" AS ENUM ('PERMANENT', 'TEMPORARY');

-- CreateTable
CREATE TABLE "channel_bans" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "bannedBy" TEXT,
    "banType" "BanType" NOT NULL DEFAULT 'PERMANENT',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_bans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_bans_channelId_userId_key" ON "channel_bans"("channelId", "userId");

-- AddForeignKey
ALTER TABLE "channel_bans" ADD CONSTRAINT "channel_bans_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_bans" ADD CONSTRAINT "channel_bans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
