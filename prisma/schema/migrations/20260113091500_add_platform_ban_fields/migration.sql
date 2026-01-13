-- AlterTable
ALTER TABLE "users" ADD COLUMN "isBanned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "banExpiresAt" TIMESTAMP(3),
ADD COLUMN "banReason" TEXT;
