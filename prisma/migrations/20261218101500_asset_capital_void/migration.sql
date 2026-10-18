-- v6.4.1: voiding a fixed asset or a capital source (loan, investor, owner's
-- capital) entered by mistake no longer deletes it (nor a source's installments).
-- The row stays, marked void (when and why), and leaves the lists and totals.
-- Additive: two columns on each table that may be empty.

-- AlterTable
ALTER TABLE "FixedAsset" ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidReason" TEXT;

-- AlterTable
ALTER TABLE "CapitalSource" ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidReason" TEXT;
