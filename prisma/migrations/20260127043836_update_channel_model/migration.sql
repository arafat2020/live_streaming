-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "discordUrl" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "lastAboutUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "twitterUrl" TEXT,
ADD COLUMN     "websiteUrl" TEXT,
ADD COLUMN     "youtubeUrl" TEXT;
