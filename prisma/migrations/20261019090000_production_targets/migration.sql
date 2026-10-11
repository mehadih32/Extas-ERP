-- Production projects started from a sales order or proforma: the order they
-- came from, and the pieces to make per SKU (colour and size), the target grid.
-- The new column is optional and the new table starts empty, so existing
-- projects keep only their total (targetQuantity) and work as before.

-- AlterTable
ALTER TABLE "ProductionProject" ADD COLUMN     "salesOrderId" TEXT;

-- CreateTable
CREATE TABLE "ProductionTargetLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ProductionTargetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionTargetLine_variantId_idx" ON "ProductionTargetLine"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionTargetLine_projectId_variantId_key" ON "ProductionTargetLine"("projectId", "variantId");

-- CreateIndex
CREATE INDEX "ProductionProject_salesOrderId_idx" ON "ProductionProject"("salesOrderId");

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTargetLine" ADD CONSTRAINT "ProductionTargetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTargetLine" ADD CONSTRAINT "ProductionTargetLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
