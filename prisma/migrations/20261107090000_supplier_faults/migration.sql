-- The supplier Fault Log, and the challan quantity on a raw material bill line (Challan vs Actual).
-- CreateEnum
CREATE TYPE "SupplierFaultKind" AS ENUM ('SHORT_RECEIVE', 'FABRIC_FAULT', 'QUALITY', 'MISSING_PIECES', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierFaultStatus" AS ENUM ('OPEN', 'DEDUCTED', 'WAIVED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SUPPLIER_FAULT';

-- AlterTable
ALTER TABLE "SupplierBillItem" ADD COLUMN     "challanQuantity" DECIMAL(14,3);

-- CreateTable
CREATE TABLE "SupplierFault" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" "SupplierFaultKind" NOT NULL,
    "status" "SupplierFaultStatus" NOT NULL DEFAULT 'OPEN',
    "batchId" TEXT,
    "projectId" TEXT,
    "rawMaterialId" TEXT,
    "billId" TEXT,
    "quantity" DECIMAL(14,3),
    "amount" DECIMAL(14,2),
    "note" TEXT,
    "occurredOn" DATE NOT NULL,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "settledNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierFault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierFault_companyId_status_occurredOn_idx" ON "SupplierFault"("companyId", "status", "occurredOn");

-- CreateIndex
CREATE INDEX "SupplierFault_supplierId_status_idx" ON "SupplierFault"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierFault_batchId_idx" ON "SupplierFault"("batchId");

-- CreateIndex
CREATE INDEX "SupplierFault_billId_idx" ON "SupplierFault"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierFault_companyId_number_key" ON "SupplierFault"("companyId", "number");

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

