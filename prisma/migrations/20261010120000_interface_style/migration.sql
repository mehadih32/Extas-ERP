-- Each person's choice of look: the original layout (LEGACY, kept for everyone
-- by default) or the modern one with the side menu. Additive only: existing rows
-- get LEGACY, nothing else changes.

-- CreateEnum
CREATE TYPE "InterfaceStyle" AS ENUM ('LEGACY', 'MODERN');

-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN "interfaceStyle" "InterfaceStyle" NOT NULL DEFAULT 'LEGACY';
