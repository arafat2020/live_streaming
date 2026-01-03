/*
  Warnings:

  - A unique constraint covering the columns `[channelId,userId]` on the table `banuser` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "banuser_channelId_userId_key" ON "banuser"("channelId", "userId");
