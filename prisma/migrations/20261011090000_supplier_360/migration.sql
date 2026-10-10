-- Supplier 360° and project settlements. Additive only: nothing existing changes.
--   * Suppliers get categories (Fabric, Accessories, FOB, CM), empty for everyone today.
--   * A payment to a supplier may name the production project it is for.
--   * Completing a project keeps a settlement statement per supplier (no journal entry).
--   * A new kind of printed document, the supplier's 360° profile.
--   * Two production cost heads for FOB projects.

-- CreateEnum
CREATE TYPE "SupplierCategory" AS ENUM ('FABRIC', 'ACCESSORIES', 'FOB', 'CM');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SUPPLIER_360';

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "supplierCategories" "SupplierCategory"[] DEFAULT ARRAY[]::"SupplierCategory"[];

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "ProjectSettlement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billed" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL,
    "carried" DECIMAL(14,2) NOT NULL,
    "bills" JSONB NOT NULL,
    "settledById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectSettlement_projectId_idx" ON "ProjectSettlement"("projectId");

-- CreateIndex
CREATE INDEX "ProjectSettlement_supplierId_settledAt_idx" ON "ProjectSettlement"("supplierId", "settledAt");

-- CreateIndex
CREATE INDEX "Payment_projectId_idx" ON "Payment"("projectId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSettlement" ADD CONSTRAINT "ProjectSettlement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSettlement" ADD CONSTRAINT "ProjectSettlement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSettlement" ADD CONSTRAINT "ProjectSettlement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSettlement" ADD CONSTRAINT "ProjectSettlement_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Production cost heads for FOB projects: the finished goods bought from the FOB
-- supplier and the quality check paid for them. Added for every company that already
-- has its production cost heads (new companies get them with the rest); a company that
-- already has a head of the same name keeps its own.
INSERT INTO "ExpenseHead" ("id", "companyId", "name", "category", "isProductionCost", "requiresEmployee", "isActive")
SELECT gen_random_uuid()::text, c."companyId", h.name, 'PRODUCTION'::"ExpenseCategory", true, false, true
FROM (SELECT DISTINCT "companyId" FROM "ExpenseHead" WHERE "isProductionCost") c
CROSS JOIN (VALUES ('FOB Goods'), ('QC & Inspection')) AS h(name)
ON CONFLICT ("companyId", "name") DO NOTHING;
