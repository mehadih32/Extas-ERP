-- Customer acquisition (B2B), 2026-11-12. Additive only: a new enum, a nullable
-- column on ExpenseHead and a new budget table. The heads themselves are made per
-- company on first use (ensureB2bAcquisitionHeads), so nothing existing changes.

-- CreateEnum
CREATE TYPE "B2bAcquisitionLine" AS ENUM ('ONLINE_ADS', 'TRADE_FAIRS', 'SAMPLES', 'PLATFORMS', 'TRAVEL', 'OTHER');

-- AlterTable
ALTER TABLE "ExpenseHead" ADD COLUMN "acquisitionLine" "B2bAcquisitionLine";

-- CreateTable
CREATE TABLE "B2bAcquisitionBudget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "line" "B2bAcquisitionLine" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "setById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "B2bAcquisitionBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseHead_companyId_acquisitionLine_key" ON "ExpenseHead"("companyId", "acquisitionLine");

-- CreateIndex
CREATE UNIQUE INDEX "B2bAcquisitionBudget_companyId_month_line_key" ON "B2bAcquisitionBudget"("companyId", "month", "line");

-- AddForeignKey
ALTER TABLE "B2bAcquisitionBudget" ADD CONSTRAINT "B2bAcquisitionBudget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
