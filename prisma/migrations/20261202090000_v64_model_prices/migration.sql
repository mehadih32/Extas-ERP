-- v6.4 F and A7: every price on the providers' price pages (cache writing,
-- batch work), and the day the owner was last told a model with no price is
-- blocked. Additive only: new nullable columns.

-- AlterTable
ALTER TABLE "AiModelPrice" ADD COLUMN     "batchInputPerM" DECIMAL(12,4),
ADD COLUMN     "batchOutputPerM" DECIMAL(12,4),
ADD COLUMN     "blockedNoticeOn" TEXT,
ADD COLUMN     "cacheWritePerM" DECIMAL(12,4);
