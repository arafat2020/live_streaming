/*
  Warnings:

  - The `category` column on the `channels` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `category` column on the `content` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "Category" AS ENUM ('IRL', 'JUST_CHATTING', 'CASINO_GAMES');

-- AlterTable
ALTER TABLE "channels" DROP COLUMN "category",
ADD COLUMN     "category" "Category" DEFAULT 'JUST_CHATTING';

-- AlterTable
ALTER TABLE "content" DROP COLUMN "category",
ADD COLUMN     "category" "Category" DEFAULT 'JUST_CHATTING';

-- DropEnum
DROP TYPE "public"."UserCategory";
