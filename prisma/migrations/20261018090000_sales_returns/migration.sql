-- Sales returns against an invoice (credit notes, CN-): the invoice, buyer and
-- warehouse, the amounts credited and the cost booked to Inventory Loss, who made
-- it and its void; each line's invoice line, price billed, amount and cost.
-- All new columns are optional or default to 0, so existing rows need no change.

-- AlterTable
ALTER TABLE "SalesReturn" ADD COLUMN     "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "costValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "goodsValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "partyId" TEXT,
ADD COLUMN     "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "SalesReturnItem" ADD COLUMN     "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "orderItemId" TEXT,
ADD COLUMN     "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_journalEntryId_key" ON "SalesReturn"("journalEntryId");

-- CreateIndex
CREATE INDEX "SalesReturn_companyId_receivedAt_idx" ON "SalesReturn"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "SalesReturn_invoiceId_idx" ON "SalesReturn"("invoiceId");

-- CreateIndex
CREATE INDEX "SalesReturn_orderId_idx" ON "SalesReturn"("orderId");

-- CreateIndex
CREATE INDEX "SalesReturn_partyId_idx" ON "SalesReturn"("partyId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_orderItemId_idx" ON "SalesReturnItem"("orderItemId");

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

