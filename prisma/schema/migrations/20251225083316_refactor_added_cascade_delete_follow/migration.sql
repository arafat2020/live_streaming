-- DropForeignKey
ALTER TABLE "public"."follows" DROP CONSTRAINT "follows_followerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."follows" DROP CONSTRAINT "follows_followingId_fkey";

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
