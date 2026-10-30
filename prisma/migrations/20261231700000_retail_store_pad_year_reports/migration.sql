-- Retail part 6 (plan v6 sec 12 and 14): a store's own logo for its pad, and the year-end summaries it keeps. Additive only.
-- AlterTable
ALTER TABLE "RetailStore" ADD COLUMN     "logoFileId" TEXT;

-- CreateTable
CREATE TABLE "RetailYearReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailYearReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetailYearReport_fileId_key" ON "RetailYearReport"("fileId");

-- CreateIndex
CREATE INDEX "RetailYearReport_companyId_idx" ON "RetailYearReport"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailYearReport_storeId_year_key" ON "RetailYearReport"("storeId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "RetailStore_logoFileId_key" ON "RetailStore"("logoFileId");

-- AddForeignKey
ALTER TABLE "RetailStore" ADD CONSTRAINT "RetailStore_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailYearReport" ADD CONSTRAINT "RetailYearReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailYearReport" ADD CONSTRAINT "RetailYearReport_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailYearReport" ADD CONSTRAINT "RetailYearReport_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

