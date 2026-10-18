-- v6.4.1: voiding a sales return no longer deletes its Damage & QC Rejects lines
-- or its stock movements. The lines stay, marked void (when and why), and
-- opposite movements are added. Additive: two columns that may be empty.

-- AlterTable
ALTER TABLE "BadStockEntry" ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidReason" TEXT;
