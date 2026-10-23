-- E-commerce API (CN-005): API keys kept as a hash, the shop's warehouse, webhook address,
-- allow-list and rate limit on the existing SalesChannelIntegration; outgoing webhooks counted in
-- the existing WebhookEvent; a call log and the Idempotency-Key answers; the COD amount and the
-- shop's payment method on website orders. Only new tables, new columns (nullable or with a
-- default), new indexes and a new permission.

-- CreateEnum
CREATE TYPE "WebhookDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- AlterTable
ALTER TABLE "SalesChannelIntegration" ADD COLUMN     "apiKeyCreatedAt" TIMESTAMP(3),
ADD COLUMN     "apiKeyHint" TEXT,
ADD COLUMN     "apiKeyRevokedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "ipAllowList" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "serviceUserId" TEXT,
ADD COLUMN     "stockSentTo" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "variantsSentTo" TIMESTAMP(3),
ADD COLUMN     "warehouseId" TEXT,
ADD COLUMN     "webhookUrl" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "codAmount" DECIMAL(14,2),
ADD COLUMN     "paymentMethod" "PaymentMethod";

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "direction" "WebhookDirection" NOT NULL DEFAULT 'INCOMING',
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "responseStatus" INTEGER;

-- CreateTable
CREATE TABLE "IntegrationApiCall" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "errorCode" TEXT,
    "idempotencyKey" TEXT,
    "ipAddress" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationApiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationIdempotency" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationApiCall_integrationId_createdAt_idx" ON "IntegrationApiCall"("integrationId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationApiCall_companyId_createdAt_idx" ON "IntegrationApiCall"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationIdempotency_companyId_createdAt_idx" ON "IntegrationIdempotency"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationIdempotency_integrationId_key_key" ON "IntegrationIdempotency"("integrationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SalesChannelIntegration_apiKeyRef_key" ON "SalesChannelIntegration"("apiKeyRef");

-- CreateIndex
CREATE INDEX "SalesChannelIntegration_companyId_idx" ON "SalesChannelIntegration"("companyId");

-- CreateIndex
CREATE INDEX "WebhookEvent_integrationId_receivedAt_idx" ON "WebhookEvent"("integrationId", "receivedAt");

-- AddForeignKey
ALTER TABLE "SalesChannelIntegration" ADD CONSTRAINT "SalesChannelIntegration_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationApiCall" ADD CONSTRAINT "IntegrationApiCall_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationApiCall" ADD CONSTRAINT "IntegrationApiCall_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "SalesChannelIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationIdempotency" ADD CONSTRAINT "IntegrationIdempotency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationIdempotency" ADD CONSTRAINT "IntegrationIdempotency_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "SalesChannelIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The new permission (Super Admin gets it from the seed, like every permission).
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'integrations.ecommerce.manage', 'SETTINGS',
   'Connect online shops (e-commerce API): add them, make, rotate and revoke their keys')
ON CONFLICT ("key") DO NOTHING;
