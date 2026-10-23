-- E-commerce API review fixes, money part (CN-005). Additive only: new nullable
-- columns, their indexes and links; nothing existing changes.
--   CreditAllocation.salesReturnId  a website return's credit put against its own invoice
--   Refund.salesReturnId            a website return's credit paid back by Accounts
--   SalesReturn.integrationId and externalReturnId  the shop's own id for a return, once per shop
--   AdSpend.integrationId           which shop sent the figure (null: entered in the ERP)

-- AlterTable
ALTER TABLE "AdSpend" ADD COLUMN     "integrationId" TEXT;

-- AlterTable
ALTER TABLE "CreditAllocation" ADD COLUMN     "salesReturnId" TEXT;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "salesReturnId" TEXT;

-- AlterTable
ALTER TABLE "SalesReturn" ADD COLUMN     "externalReturnId" TEXT,
ADD COLUMN     "integrationId" TEXT;

-- CreateIndex
CREATE INDEX "AdSpend_integrationId_idx" ON "AdSpend"("integrationId");

-- CreateIndex
CREATE INDEX "CreditAllocation_salesReturnId_idx" ON "CreditAllocation"("salesReturnId");

-- CreateIndex
CREATE INDEX "Refund_salesReturnId_idx" ON "Refund"("salesReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_companyId_integrationId_externalReturnId_key" ON "SalesReturn"("companyId", "integrationId", "externalReturnId");

-- AddForeignKey
ALTER TABLE "CreditAllocation" ADD CONSTRAINT "CreditAllocation_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "SalesReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "SalesReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "SalesChannelIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "SalesChannelIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

