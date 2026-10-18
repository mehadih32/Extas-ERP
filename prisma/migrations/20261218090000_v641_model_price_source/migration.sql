-- v6.4.1 C4: a price the owner types keeps where it came from, and its own
-- long-prompt prices (without them the built-in list's still hold). Additive
-- only: new nullable columns.

-- AlterTable
ALTER TABLE "AiModelPrice" ADD COLUMN     "longAbove" INTEGER,
ADD COLUMN     "longBatchInputPerM" DECIMAL(12,4),
ADD COLUMN     "longBatchOutputPerM" DECIMAL(12,4),
ADD COLUMN     "longCacheReadPerM" DECIMAL(12,4),
ADD COLUMN     "longCacheWritePerM" DECIMAL(12,4),
ADD COLUMN     "longInputPerM" DECIMAL(12,4),
ADD COLUMN     "longOutputPerM" DECIMAL(12,4),
ADD COLUMN     "source" TEXT;
