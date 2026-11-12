-- Wholesale returns with approval, QC and exchange (2026-11-12). Additive only: new enums,
-- a new DocumentType value, a Company setting with a default, two new tables and a new
-- permission granted to the built-in Accounts roles. Old returns are left exactly as they are.

-- CreateEnum
CREATE TYPE "WholesaleReturnMode" AS ENUM ('REFUND', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "WholesaleExchangeKind" AS ENUM ('SIZE', 'OTHER');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'WHOLESALE_RETURN';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "wholesaleReturnPinAbove" DECIMAL(14,2) NOT NULL DEFAULT 10000;

-- CreateTable
CREATE TABLE "WholesaleReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "exchangeOrderId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approveNote" TEXT,
    "salesReturnId" TEXT,
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "qcJournalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleReturnLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "mode" "WholesaleReturnMode" NOT NULL,
    "exchangeKind" "WholesaleExchangeKind",
    "newVariantId" TEXT,
    "newQuantity" INTEGER,
    "newUnitPrice" DECIMAL(14,2),
    "priceDifference" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded" INTEGER NOT NULL DEFAULT 0,
    "qcA" INTEGER NOT NULL DEFAULT 0,
    "qcB" INTEGER NOT NULL DEFAULT 0,
    "qcReject" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WholesaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleReturn_exchangeOrderId_key" ON "WholesaleReturn"("exchangeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleReturn_salesReturnId_key" ON "WholesaleReturn"("salesReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleReturn_qcJournalId_key" ON "WholesaleReturn"("qcJournalId");

-- CreateIndex
CREATE INDEX "WholesaleReturn_companyId_receivedAt_idx" ON "WholesaleReturn"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "WholesaleReturn_partyId_idx" ON "WholesaleReturn"("partyId");

-- CreateIndex
CREATE INDEX "WholesaleReturn_orderId_idx" ON "WholesaleReturn"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleReturn_companyId_number_key" ON "WholesaleReturn"("companyId", "number");

-- CreateIndex
CREATE INDEX "WholesaleReturnLine_returnId_idx" ON "WholesaleReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "WholesaleReturnLine_orderItemId_idx" ON "WholesaleReturnLine"("orderItemId");

-- AddForeignKey
ALTER TABLE "WholesaleReturn" ADD CONSTRAINT "WholesaleReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleReturn" ADD CONSTRAINT "WholesaleReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleReturn" ADD CONSTRAINT "WholesaleReturn_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleReturn" ADD CONSTRAINT "WholesaleReturn_exchangeOrderId_fkey" FOREIGN KEY ("exchangeOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleReturn" ADD CONSTRAINT "WholesaleReturn_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "SalesReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleReturnLine" ADD CONSTRAINT "WholesaleReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "WholesaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleReturnLine" ADD CONSTRAINT "WholesaleReturnLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleReturnLine" ADD CONSTRAINT "WholesaleReturnLine_newVariantId_fkey" FOREIGN KEY ("newVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The right to approve wholesale returns (how many pieces are refunded: the credit note).
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'sales.returns.approve', 'SALES',
   'Approve wholesale returns: how many pieces are refunded to the buyer''s account (above the set amount with the PIN)')
ON CONFLICT ("key") DO NOTHING;

-- Default grant for the built-in Accounts roles that already exist (a return's credit goes on
-- the buyer's account).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" = 'sales.returns.approve'
WHERE r."systemRole" IN ('ACCOUNTS')
ON CONFLICT DO NOTHING;
