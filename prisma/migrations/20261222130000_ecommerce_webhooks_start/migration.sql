-- E-commerce webhooks (CN-005): when a shop's webhooks started from now (a new shop, a new
-- webhook address, switched on again, a first key), so nothing changed before it is sent.
-- One new nullable column only.

-- AlterTable
ALTER TABLE "SalesChannelIntegration" ADD COLUMN     "webhooksStartedAt" TIMESTAMP(3);
