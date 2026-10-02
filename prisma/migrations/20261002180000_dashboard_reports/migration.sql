-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportPeriod" ADD VALUE 'TODAY';
ALTER TYPE "ReportPeriod" ADD VALUE 'THIS_MONTH';
ALTER TYPE "ReportPeriod" ADD VALUE 'LAST_MONTH';
ALTER TYPE "ReportPeriod" ADD VALUE 'THIS_FINANCIAL_YEAR';
ALTER TYPE "ReportPeriod" ADD VALUE 'LAST_FINANCIAL_YEAR';

-- AlterTable
ALTER TABLE "ReportExport" ADD COLUMN     "options" JSONB,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Business report',
ALTER COLUMN "fromDate" SET DATA TYPE DATE,
ALTER COLUMN "toDate" SET DATA TYPE DATE;

-- CreateIndex
CREATE INDEX "Invoice_companyId_issueDate_idx" ON "Invoice"("companyId", "issueDate");
