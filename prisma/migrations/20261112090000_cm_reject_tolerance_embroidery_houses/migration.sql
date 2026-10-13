-- Real CM rules: embroidery and print houses as a supplier type, whose spoiled pieces are
-- taken off their own Supplier Due (one journal entry per fault, reversed when reopened
-- or waived), and each master batch's reject allowance (2% of the pieces cut unless
-- changed) for the final CM settlement. Additive only: every batch starts at 2%.

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'SUPPLIER_FAULT';

-- AlterEnum
ALTER TYPE "SupplierCategory" ADD VALUE 'EMBROIDERY_PRINT';

-- AlterEnum
ALTER TYPE "SupplierFaultKind" ADD VALUE 'SPOILED_PIECES';

-- AlterTable
ALTER TABLE "ProductionBatch" ADD COLUMN     "rejectTolerancePercent" DECIMAL(5,2) NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "SupplierFault" ADD COLUMN     "journalEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SupplierFault_journalEntryId_key" ON "SupplierFault"("journalEntryId");

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

