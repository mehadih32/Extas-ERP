-- Fresh start (2026-11-12): the one-time record per company, and backups kept for ever
-- (the one made just before a fresh start). Additive only.
-- CreateEnum
CREATE TYPE "FreshStartStatus" AS ENUM ('BACKING_UP', 'ERASING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "BackupRun" ADD COLUMN     "keepForever" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT;

-- CreateTable
CREATE TABLE "FreshStart" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "FreshStartStatus" NOT NULL DEFAULT 'BACKING_UP',
    "keepParties" BOOLEAN NOT NULL DEFAULT false,
    "keepProducts" BOOLEAN NOT NULL DEFAULT false,
    "keepEmployees" BOOLEAN NOT NULL DEFAULT false,
    "startedById" TEXT,
    "startedByName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "backupRunId" TEXT,
    "backupName" TEXT,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "report" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreshStart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreshStart_companyId_key" ON "FreshStart"("companyId");

-- AddForeignKey
ALTER TABLE "FreshStart" ADD CONSTRAINT "FreshStart_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreshStart" ADD CONSTRAINT "FreshStart_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
