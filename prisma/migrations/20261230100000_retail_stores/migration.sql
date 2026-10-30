-- CreateEnum
CREATE TYPE "RetailStoreKind" AS ENUM ('ONLINE', 'SHOWROOM');

-- CreateEnum
CREATE TYPE "RetailPriceRule" AS ENUM ('PERCENT', 'AMOUNT', 'FIXED');

-- CreateEnum
CREATE TYPE "RetailGrade" AS ENUM ('A', 'B');

-- CreateTable
CREATE TABLE "RetailStore" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RetailStoreKind" NOT NULL DEFAULT 'ONLINE',
    "address" TEXT,
    "phone" TEXT,
    "warehouseId" TEXT,
    "partyId" TEXT NOT NULL,
    "integrationId" TEXT,
    "aRule" "RetailPriceRule",
    "aValue" DECIMAL(14,4),
    "bRule" "RetailPriceRule",
    "bValue" DECIMAL(14,4),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailPrice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "grade" "RetailGrade" NOT NULL,
    "styleId" TEXT NOT NULL,
    "colorId" TEXT,
    "variantId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "costWhenSet" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "setById" TEXT,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "RetailPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailPriceChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetailStore_partyId_key" ON "RetailStore"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailStore_integrationId_key" ON "RetailStore"("integrationId");

-- CreateIndex
CREATE INDEX "RetailStore_companyId_idx" ON "RetailStore"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailStore_companyId_name_key" ON "RetailStore"("companyId", "name");

-- CreateIndex
CREATE INDEX "RetailPrice_storeId_grade_scopeKey_idx" ON "RetailPrice"("storeId", "grade", "scopeKey");

-- CreateIndex
CREATE INDEX "RetailPrice_companyId_styleId_idx" ON "RetailPrice"("companyId", "styleId");

-- CreateIndex
CREATE INDEX "RetailPriceChange_storeId_changedAt_idx" ON "RetailPriceChange"("storeId", "changedAt");

-- AddForeignKey
ALTER TABLE "RetailStore" ADD CONSTRAINT "RetailStore_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailStore" ADD CONSTRAINT "RetailStore_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailStore" ADD CONSTRAINT "RetailStore_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailStore" ADD CONSTRAINT "RetailStore_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "SalesChannelIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailPrice" ADD CONSTRAINT "RetailPrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailPrice" ADD CONSTRAINT "RetailPrice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailPrice" ADD CONSTRAINT "RetailPrice_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailPrice" ADD CONSTRAINT "RetailPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailPriceChange" ADD CONSTRAINT "RetailPriceChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailPriceChange" ADD CONSTRAINT "RetailPriceChange_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live hand price per store, grade and place (a taken-off price stays as history).
CREATE UNIQUE INDEX "RetailPrice_live_key" ON "RetailPrice"("storeId", "grade", "scopeKey") WHERE "removedAt" IS NULL;

-- The two new rights (Business > Retail stores). Only Super Admin has them until
-- the owner gives them to a role or a person in the access tree.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'retail.view', 'RETAIL',
   'See the Business menu: retail stores and the prices they buy at'),
  (gen_random_uuid()::text, 'retail.manage', 'RETAIL',
   'Add and edit retail stores and set their prices (prices need the PIN)')
ON CONFLICT ("key") DO NOTHING;
