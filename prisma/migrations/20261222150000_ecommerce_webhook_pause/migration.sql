-- E-commerce webhooks (CN-005): after a failed try, a shop's other webhooks wait until the next
-- try instead of each waiting for the shop's timeout, so a shop that does not answer cannot hold
-- up the background queue. One new nullable column only.

-- AlterTable
ALTER TABLE "SalesChannelIntegration" ADD COLUMN     "webhooksPausedUntil" TIMESTAMP(3);
