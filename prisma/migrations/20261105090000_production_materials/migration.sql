-- Materials per piece (bill of materials), tech pack notes, and purchase orders for a
-- master batch with each line's style-wise shares, picture and price at receive.
-- CreateEnum
CREATE TYPE "MaterialSplit" AS ENUM ('TOTAL', 'COLOUR', 'COLOUR_SIZE');

-- AlterTable
ALTER TABLE "ProductionProject" ADD COLUMN     "techPackNotes" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "imageId" TEXT,
ADD COLUMN     "priceLater" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PurchaseOrderLineShare" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "colorName" TEXT,
    "sizeName" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "PurchaseOrderLineShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionMaterialNeed" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "perPiece" DECIMAL(14,4) NOT NULL,
    "wastagePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "split" "MaterialSplit" NOT NULL DEFAULT 'TOTAL',
    "placement" TEXT,
    "imageId" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionMaterialNeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderLineShare_lineId_idx" ON "PurchaseOrderLineShare"("lineId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLineShare_projectId_idx" ON "PurchaseOrderLineShare"("projectId");

-- CreateIndex
CREATE INDEX "ProductionMaterialNeed_projectId_idx" ON "ProductionMaterialNeed"("projectId");

-- CreateIndex
CREATE INDEX "ProductionMaterialNeed_rawMaterialId_idx" ON "ProductionMaterialNeed"("rawMaterialId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_batchId_idx" ON "PurchaseOrder"("batchId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLineShare" ADD CONSTRAINT "PurchaseOrderLineShare_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLineShare" ADD CONSTRAINT "PurchaseOrderLineShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterialNeed" ADD CONSTRAINT "ProductionMaterialNeed_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterialNeed" ADD CONSTRAINT "ProductionMaterialNeed_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterialNeed" ADD CONSTRAINT "ProductionMaterialNeed_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterialNeed" ADD CONSTRAINT "ProductionMaterialNeed_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

