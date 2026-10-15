-- Costing rules (v6.2): a buyer's way of paying (TT, bank transfer or LC) and a
-- factory's monthly capacity on the party, supplier fabric quotes per kg (per
-- yard for wovens), and order costing sheets with their styles. The profit %
-- is per order with no default; no office overhead; CM fixed per style.
-- Only new tables, new nullable columns and a new document type.

-- CreateEnum
CREATE TYPE "TradePayment" AS ENUM ('TT', 'BANK_TRANSFER', 'LC');

-- CreateEnum
CREATE TYPE "FabricUnit" AS ENUM ('KG', 'YARD');

-- CreateEnum
CREATE TYPE "CmPer" AS ENUM ('PIECE', 'DOZEN');

-- CreateEnum
CREATE TYPE "CostingDecision" AS ENUM ('TAKE', 'DECLINE');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'ORDER_COSTING';

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "monthlyCapacity" INTEGER,
ADD COLUMN     "tradePayment" "TradePayment";

-- CreateTable
CREATE TABLE "FabricQuote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "materialId" TEXT,
    "fabric" TEXT NOT NULL,
    "unit" "FabricUnit" NOT NULL DEFAULT 'KG',
    "price" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "quotedOn" DATE NOT NULL,
    "validUntil" DATE,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FabricQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCosting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "buyerId" TEXT,
    "factoryId" TEXT,
    "salesOrderId" TEXT,
    "batchId" TEXT,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(12,4),
    "profitPercent" DECIMAL(5,2),
    "sourceTaxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "bankChargePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tradePayment" "TradePayment",
    "shipDate" DATE,
    "fabricDays" INTEGER,
    "makingDays" INTEGER,
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "decision" "CostingDecision",
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderCosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCostingStyle" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "styleId" TEXT,
    "styleRef" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "fabricQuoteId" TEXT,
    "fabricName" TEXT,
    "fabricUnit" "FabricUnit" NOT NULL DEFAULT 'KG',
    "consumption" DECIMAL(10,4),
    "fabricPrice" DECIMAL(14,4),
    "trimsPerDozen" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "valueAddPerDozen" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "otherPerDozen" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cmAmount" DECIMAL(14,4),
    "cmPer" "CmPer" NOT NULL DEFAULT 'PIECE',
    "buyerPrice" DECIMAL(14,4),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderCostingStyle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FabricQuote_companyId_materialId_idx" ON "FabricQuote"("companyId", "materialId");

-- CreateIndex
CREATE INDEX "FabricQuote_companyId_supplierId_idx" ON "FabricQuote"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "OrderCosting_companyId_createdAt_idx" ON "OrderCosting"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderCosting_companyId_buyerId_idx" ON "OrderCosting"("companyId", "buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderCosting_companyId_number_key" ON "OrderCosting"("companyId", "number");

-- CreateIndex
CREATE INDEX "OrderCostingStyle_costingId_idx" ON "OrderCostingStyle"("costingId");

-- AddForeignKey
ALTER TABLE "FabricQuote" ADD CONSTRAINT "FabricQuote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricQuote" ADD CONSTRAINT "FabricQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricQuote" ADD CONSTRAINT "FabricQuote_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "RawMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricQuote" ADD CONSTRAINT "FabricQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCosting" ADD CONSTRAINT "OrderCosting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCosting" ADD CONSTRAINT "OrderCosting_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCosting" ADD CONSTRAINT "OrderCosting_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCosting" ADD CONSTRAINT "OrderCosting_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCosting" ADD CONSTRAINT "OrderCosting_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCosting" ADD CONSTRAINT "OrderCosting_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCosting" ADD CONSTRAINT "OrderCosting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCostingStyle" ADD CONSTRAINT "OrderCostingStyle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCostingStyle" ADD CONSTRAINT "OrderCostingStyle_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "OrderCosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCostingStyle" ADD CONSTRAINT "OrderCostingStyle_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCostingStyle" ADD CONSTRAINT "OrderCostingStyle_fabricQuoteId_fkey" FOREIGN KEY ("fabricQuoteId") REFERENCES "FabricQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The new permissions, so the owner can grant them on this site; no role
-- is given them; Super Admin holds every permission in code.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'costing.view', 'PRODUCTION',
   'See order costing sheets with their costs and profit, supplier fabric quotes and the Order check card'),
  (gen_random_uuid()::text, 'costing.manage', 'PRODUCTION',
   'Make and change order costing sheets and add supplier fabric quotes'),
  (gen_random_uuid()::text, 'costing.decide', 'PRODUCTION',
   'Take or decline an order after its Order check card (the owner''s)')
ON CONFLICT ("key") DO NOTHING;
