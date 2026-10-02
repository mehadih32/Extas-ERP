-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'PAYMENT_VOUCHER';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'PRODUCTION';

-- AlterEnum
ALTER TYPE "SystemRole" ADD VALUE 'ACCOUNTS';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockIntake" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "warehouseId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_projectId_idx" ON "Expense"("projectId");

-- CreateIndex
CREATE INDEX "StockIntake_projectId_idx" ON "StockIntake"("projectId");

-- AddForeignKey
ALTER TABLE "StockIntake" ADD CONSTRAINT "StockIntake_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

