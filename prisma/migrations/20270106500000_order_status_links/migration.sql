-- Share order status (Release 2): read-only links to an order's progress for its buyer.
-- Additive only: one new table and one new permission key.

-- CreateTable
CREATE TABLE "OrderStatusLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stoppedById" TEXT,
    "lastOpenedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderStatusLink_tokenHash_key" ON "OrderStatusLink"("tokenHash");

-- CreateIndex
CREATE INDEX "OrderStatusLink_companyId_orderId_idx" ON "OrderStatusLink"("companyId", "orderId");

-- AddForeignKey
ALTER TABLE "OrderStatusLink" ADD CONSTRAINT "OrderStatusLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusLink" ADD CONSTRAINT "OrderStatusLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusLink" ADD CONSTRAINT "OrderStatusLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusLink" ADD CONSTRAINT "OrderStatusLink_stoppedById_fkey" FOREIGN KEY ("stoppedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The permission to make and stop these links (Super Admin holds every permission in code;
-- the owner gives it to other roles under Settings > Roles).
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'sales.order.share', 'SALES',
   'Share an order''s progress with its buyer through a read-only link, and stop such links')
ON CONFLICT ("key") DO NOTHING;
