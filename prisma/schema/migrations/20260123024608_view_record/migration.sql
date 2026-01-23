-- CreateTable
CREATE TABLE "view_tracks" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "userId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "view_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "view_tracks_contentId_userId_idx" ON "view_tracks"("contentId", "userId");

-- CreateIndex
CREATE INDEX "view_tracks_contentId_ipAddress_idx" ON "view_tracks"("contentId", "ipAddress");

-- AddForeignKey
ALTER TABLE "view_tracks" ADD CONSTRAINT "view_tracks_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
