-- CreateEnum
CREATE TYPE "RetailExchangeState" AS ENUM ('WAITING_DELIVERY', 'WAITING_RETURN', 'RETURNED_WAITING_CHECK', 'SETTLED', 'BILLED', 'CREDITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RetailExchangeEventType" AS ENUM ('SETTLED', 'BILLED', 'CREDITED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'RETAIL_EXCHANGE';

-- AlterTable
ALTER TABLE "RetailOrderLine" ADD COLUMN     "deadline" DATE,
ADD COLUMN     "deliveredOn" DATE,
ADD COLUMN     "exchangeState" "RetailExchangeState",
ADD COLUMN     "replacesLineId" TEXT;

-- CreateTable
CREATE TABLE "RetailExchange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "retailOrderId" TEXT NOT NULL,
    "ofRetailOrderId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailExchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailExchangeEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "type" "RetailExchangeEventType" NOT NULL,
    "kind" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "journalEntryId" TEXT,
    "reversesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailExchangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetailExchange_retailOrderId_key" ON "RetailExchange"("retailOrderId");

-- CreateIndex
CREATE INDEX "RetailExchange_companyId_storeId_idx" ON "RetailExchange"("companyId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailExchange_companyId_number_key" ON "RetailExchange"("companyId", "number");

-- CreateIndex
CREATE INDEX "RetailExchangeEvent_exchangeId_idx" ON "RetailExchangeEvent"("exchangeId");

-- CreateIndex
CREATE INDEX "RetailExchangeEvent_companyId_createdAt_idx" ON "RetailExchangeEvent"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "RetailOrderLine" ADD CONSTRAINT "RetailOrderLine_replacesLineId_fkey" FOREIGN KEY ("replacesLineId") REFERENCES "RetailOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailExchange" ADD CONSTRAINT "RetailExchange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailExchange" ADD CONSTRAINT "RetailExchange_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailExchange" ADD CONSTRAINT "RetailExchange_retailOrderId_fkey" FOREIGN KEY ("retailOrderId") REFERENCES "RetailOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailExchange" ADD CONSTRAINT "RetailExchange_ofRetailOrderId_fkey" FOREIGN KEY ("ofRetailOrderId") REFERENCES "RetailOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailExchangeEvent" ADD CONSTRAINT "RetailExchangeEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailExchangeEvent" ADD CONSTRAINT "RetailExchangeEvent_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "RetailExchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailExchangeEvent" ADD CONSTRAINT "RetailExchangeEvent_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "RetailOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

