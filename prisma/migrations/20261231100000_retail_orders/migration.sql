-- AlterTable
ALTER TABLE "RetailStore" ADD COLUMN     "checkDays" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "exchangeDays" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "holdReleaseReason" TEXT,
ADD COLUMN     "holdReleasedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RetailOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "erpTotal" DECIMAL(14,2) NOT NULL,
    "customerTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deliveryCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advancePaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "billedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailOrderLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "retailOrderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "grade" "RetailGrade" NOT NULL DEFAULT 'A',
    "quantity" INTEGER NOT NULL,
    "shopPrice" DECIMAL(14,2) NOT NULL,
    "customerPrice" DECIMAL(14,2) NOT NULL,
    "comboId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetailOrder_orderId_key" ON "RetailOrder"("orderId");

-- CreateIndex
CREATE INDEX "RetailOrder_companyId_storeId_idx" ON "RetailOrder"("companyId", "storeId");

-- CreateIndex
CREATE INDEX "RetailOrderLine_companyId_variantId_idx" ON "RetailOrderLine"("companyId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailOrderLine_retailOrderId_lineId_key" ON "RetailOrderLine"("retailOrderId", "lineId");

-- AddForeignKey
ALTER TABLE "RetailOrder" ADD CONSTRAINT "RetailOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailOrder" ADD CONSTRAINT "RetailOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailOrder" ADD CONSTRAINT "RetailOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailOrderLine" ADD CONSTRAINT "RetailOrderLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailOrderLine" ADD CONSTRAINT "RetailOrderLine_retailOrderId_fkey" FOREIGN KEY ("retailOrderId") REFERENCES "RetailOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailOrderLine" ADD CONSTRAINT "RetailOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

