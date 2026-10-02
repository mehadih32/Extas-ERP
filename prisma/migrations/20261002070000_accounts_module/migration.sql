-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'REDUCING_BALANCE');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'TRANSFER';
ALTER TYPE "JournalSource" ADD VALUE 'FIXED_ASSET';
ALTER TYPE "JournalSource" ADD VALUE 'STOCK_ADJUSTMENT';

-- AlterTable
ALTER TABLE "BackupConfig" ADD COLUMN     "googleDriveAccount" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka';

-- AlterTable
ALTER TABLE "BackupRun" ADD COLUMN     "driveError" TEXT,
ADD COLUMN     "filesDeletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CapitalInstallment" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "FixedAsset" ADD COLUMN     "depreciatedUntil" DATE,
ADD COLUMN     "depreciationMethod" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
ADD COLUMN     "disposalAmount" DECIMAL(14,2),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "salvageValue" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Expense_createdById_idx" ON "Expense"("createdById");

-- CreateIndex
CREATE INDEX "FixedAsset_companyId_status_idx" ON "FixedAsset"("companyId", "status");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

