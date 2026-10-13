-- Master batches: an umbrella over the style projects made together, and a target price per piece.
-- CreateEnum
CREATE TYPE "ProductionKind" AS ENUM ('CM', 'READYMADE', 'DROPSHIP');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'PRODUCTION_BATCH';

-- AlterTable
ALTER TABLE "ProductionProject" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "targetUnitCost" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProductionKind" NOT NULL DEFAULT 'CM',
    "factoryId" TEXT,
    "targetDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionBatch_companyId_createdAt_idx" ON "ProductionBatch"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_companyId_code_key" ON "ProductionBatch"("companyId", "code");

-- CreateIndex
CREATE INDEX "ProductionProject_batchId_idx" ON "ProductionProject"("batchId");

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

