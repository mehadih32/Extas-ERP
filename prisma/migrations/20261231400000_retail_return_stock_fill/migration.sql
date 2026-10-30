-- AlterTable
ALTER TABLE "RetailOrderLine" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "fromReturnStock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waitingStock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RetailReturnPiece" ADD COLUMN     "atPacking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reservedForLineId" TEXT;

-- CreateIndex
CREATE INDEX "RetailReturnPiece_reservedForLineId_idx" ON "RetailReturnPiece"("reservedForLineId");

-- AddForeignKey
ALTER TABLE "RetailReturnPiece" ADD CONSTRAINT "RetailReturnPiece_reservedForLineId_fkey" FOREIGN KEY ("reservedForLineId") REFERENCES "RetailOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

