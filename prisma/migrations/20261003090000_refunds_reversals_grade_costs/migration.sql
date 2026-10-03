-- Buyer refunds (money paid back, kept as the buyer's credit or kept as a
-- cancellation charge) so paid orders and proformas can be cancelled; undoing a
-- confirmed factory delivery; and separate average costs for A- and B-grade stock.

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('CASH', 'CREDIT', 'FORFEIT');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'REFUND_VOUCHER';

-- AlterEnum
ALTER TYPE "IntakeStatus" ADD VALUE 'REVERSED';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'REFUND';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_REVERSAL';

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "bGradeAvgCost" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- Until now one average covered both grades, so B-grade stock keeps that cost
-- and every stock value stays as it was.
UPDATE "ProductVariant" SET "bGradeAvgCost" = "avgCost";

-- AlterTable
ALTER TABLE "StockIntake" ADD COLUMN     "correctionOfId" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT;

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "RefundKind" NOT NULL,
    "partyId" TEXT,
    "orderId" TEXT,
    "proformaId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "refundDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "PaymentMethod",
    "accountId" TEXT,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_journalEntryId_key" ON "Refund"("journalEntryId");

-- CreateIndex
CREATE INDEX "Refund_companyId_refundDate_idx" ON "Refund"("companyId", "refundDate");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_proformaId_idx" ON "Refund"("proformaId");

-- CreateIndex
CREATE INDEX "Refund_partyId_idx" ON "Refund"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_companyId_number_key" ON "Refund"("companyId", "number");

-- CreateIndex
CREATE INDEX "StockIntake_correctionOfId_idx" ON "StockIntake"("correctionOfId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_proformaId_fkey" FOREIGN KEY ("proformaId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntake" ADD CONSTRAINT "StockIntake_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntake" ADD CONSTRAINT "StockIntake_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "StockIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;
