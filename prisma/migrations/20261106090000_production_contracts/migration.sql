-- Batch contracts: fabric, accessories and factory (CM) agreements drafted from a master batch, and the CM per piece on a style.
-- CreateEnum
CREATE TYPE "ContractKind" AS ENUM ('FABRIC', 'ACCESSORIES', 'FACTORY_CM');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'PRODUCTION_CONTRACT';

-- AlterTable
ALTER TABLE "ProductionProject" ADD COLUMN     "cmRate" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "ProductionContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "ContractKind" NOT NULL,
    "partyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clauses" JSONB NOT NULL,
    "signedOn" DATE,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionContract_companyId_batchId_idx" ON "ProductionContract"("companyId", "batchId");

-- CreateIndex
CREATE INDEX "ProductionContract_partyId_idx" ON "ProductionContract"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionContract_companyId_number_key" ON "ProductionContract"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionContract_batchId_kind_partyId_key" ON "ProductionContract"("batchId", "kind", "partyId");

-- AddForeignKey
ALTER TABLE "ProductionContract" ADD CONSTRAINT "ProductionContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionContract" ADD CONSTRAINT "ProductionContract_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionContract" ADD CONSTRAINT "ProductionContract_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionContract" ADD CONSTRAINT "ProductionContract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionContract" ADD CONSTRAINT "ProductionContract_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

