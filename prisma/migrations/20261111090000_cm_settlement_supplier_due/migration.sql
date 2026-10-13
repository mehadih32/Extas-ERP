-- The final CM settlement takes its deductions off the factory's Supplier Due: one journal
-- entry per settlement (Dr Accounts Payable, Cr Deductions from Suppliers), reversed on undo.
-- Additive only.

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'CM_SETTLEMENT';

-- AlterTable
ALTER TABLE "CmSettlement" ADD COLUMN     "journalEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CmSettlement_journalEntryId_key" ON "CmSettlement"("journalEntryId");

-- AddForeignKey
ALTER TABLE "CmSettlement" ADD CONSTRAINT "CmSettlement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

