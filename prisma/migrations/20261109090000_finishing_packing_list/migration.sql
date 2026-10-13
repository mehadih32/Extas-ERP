-- Finishing and QC: counts grading pieces A, B or C (mending) with rejects apart, mended
-- pieces coming back, and the full packing list (A and B to stock, missing to the fault log).
-- CreateEnum
CREATE TYPE "FinishingKind" AS ENUM ('COUNT', 'MENDING', 'PACKING_LIST');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'FINISHING_REPORT';

-- CreateTable
CREATE TABLE "FinishingReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "FinishingKind" NOT NULL DEFAULT 'COUNT',
    "countedOn" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "intakeId" TEXT,
    "faultId" TEXT,
    "fileId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinishingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinishingReport_intakeId_key" ON "FinishingReport"("intakeId");

-- CreateIndex
CREATE INDEX "FinishingReport_projectId_countedOn_idx" ON "FinishingReport"("projectId", "countedOn");

-- CreateIndex
CREATE UNIQUE INDEX "FinishingReport_companyId_number_key" ON "FinishingReport"("companyId", "number");

-- AddForeignKey
ALTER TABLE "FinishingReport" ADD CONSTRAINT "FinishingReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishingReport" ADD CONSTRAINT "FinishingReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishingReport" ADD CONSTRAINT "FinishingReport_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "StockIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishingReport" ADD CONSTRAINT "FinishingReport_faultId_fkey" FOREIGN KEY ("faultId") REFERENCES "SupplierFault"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishingReport" ADD CONSTRAINT "FinishingReport_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinishingReport" ADD CONSTRAINT "FinishingReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
