-- CreateTable
CREATE TABLE "banuser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "banType" "BanType" NOT NULL DEFAULT 'PERMANENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banuser_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "banuser" ADD CONSTRAINT "banuser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banuser" ADD CONSTRAINT "banuser_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
