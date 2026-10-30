-- CreateEnum
CREATE TYPE "ReadyStockPriceMode" AS ENUM ('RULE', 'FIXED', 'AT_COST');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'READY_STOCK_PURCHASE';

-- AlterEnum
ALTER TYPE "StockLotSource" ADD VALUE 'PURCHASE';

-- AlterTable
ALTER TABLE "RetailOrderLine" ADD COLUMN     "fromReserve" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RetailReserve" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "colorId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "activeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remindedAt" TIMESTAMP(3),
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailReserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadyStockPurchase" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "supplierRef" TEXT,
    "retailOnly" BOOLEAN NOT NULL DEFAULT false,
    "priceMode" "ReadyStockPriceMode" NOT NULL DEFAULT 'RULE',
    "fixedPrice" DECIMAL(14,2),
    "extraCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pieces" INTEGER NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadyStockPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadyStockLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "ReadyStockLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetailReserve_companyId_styleId_idx" ON "RetailReserve"("companyId", "styleId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadyStockPurchase_billId_key" ON "ReadyStockPurchase"("billId");

-- CreateIndex
CREATE INDEX "ReadyStockPurchase_companyId_purchaseDate_idx" ON "ReadyStockPurchase"("companyId", "purchaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReadyStockPurchase_companyId_number_key" ON "ReadyStockPurchase"("companyId", "number");

-- CreateIndex
CREATE INDEX "ReadyStockLine_purchaseId_idx" ON "ReadyStockLine"("purchaseId");

-- AddForeignKey
ALTER TABLE "RetailReserve" ADD CONSTRAINT "RetailReserve_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReserve" ADD CONSTRAINT "RetailReserve_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadyStockPurchase" ADD CONSTRAINT "ReadyStockPurchase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadyStockPurchase" ADD CONSTRAINT "ReadyStockPurchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadyStockPurchase" ADD CONSTRAINT "ReadyStockPurchase_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadyStockPurchase" ADD CONSTRAINT "ReadyStockPurchase_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadyStockPurchase" ADD CONSTRAINT "ReadyStockPurchase_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadyStockLine" ADD CONSTRAINT "ReadyStockLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadyStockLine" ADD CONSTRAINT "ReadyStockLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "ReadyStockPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadyStockLine" ADD CONSTRAINT "ReadyStockLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The right to buy ready stock for the shops (plan v6 sec 3a).
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'retail.purchases', 'RETAIL',
   'Buy ready stock for the retail shops: the supplier''s bill on credit (Due) and the pieces into stock (needs the PIN)')
ON CONFLICT ("key") DO NOTHING;
