-- Retail part 7 (plan v6 sec 13): the night summary, alerts and weekly analysis, each sent once. Additive only.
-- CreateTable
CREATE TABLE "RetailAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetailAlert_companyId_createdAt_idx" ON "RetailAlert"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetailAlert_companyId_kind_key_key" ON "RetailAlert"("companyId", "kind", "key");

-- AddForeignKey
ALTER TABLE "RetailAlert" ADD CONSTRAINT "RetailAlert_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailAlert" ADD CONSTRAINT "RetailAlert_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

