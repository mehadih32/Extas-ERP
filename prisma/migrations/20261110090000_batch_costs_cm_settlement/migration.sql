-- Production renovation 7: batch payments (advances on the CM), the final CM settlement of a
-- master batch with its factory, and the faults it took off. Additive only.
-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CM_SETTLEMENT';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "SupplierFault" ADD COLUMN     "cmSettlementId" TEXT;

-- CreateTable
CREATE TABLE "CmSettlement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "settledOn" DATE NOT NULL,
    "deductCGrade" BOOLEAN NOT NULL DEFAULT false,
    "totalCm" DECIMAL(14,2) NOT NULL,
    "deductions" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL,
    "payable" DECIMAL(14,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "undoReason" TEXT,

    CONSTRAINT "CmSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CmSettlement_batchId_createdAt_idx" ON "CmSettlement"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "CmSettlement_factoryId_idx" ON "CmSettlement"("factoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CmSettlement_companyId_number_key" ON "CmSettlement"("companyId", "number");

-- CreateIndex
CREATE INDEX "Payment_batchId_idx" ON "Payment"("batchId");

-- CreateIndex
CREATE INDEX "SupplierFault_cmSettlementId_idx" ON "SupplierFault"("cmSettlementId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_cmSettlementId_fkey" FOREIGN KEY ("cmSettlementId") REFERENCES "CmSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmSettlement" ADD CONSTRAINT "CmSettlement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmSettlement" ADD CONSTRAINT "CmSettlement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmSettlement" ADD CONSTRAINT "CmSettlement_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmSettlement" ADD CONSTRAINT "CmSettlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmSettlement" ADD CONSTRAINT "CmSettlement_undoneById_fkey" FOREIGN KEY ("undoneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

