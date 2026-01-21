/*
  Warnings:

  - You are about to drop the column `category` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "content" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "category";
