-- "Materials sent": a plain record of what went to a factory for a production
-- project, with its own challan number (MC-) and a printable Material Challan.
-- A new document type and a new, empty table; nothing existing changes.

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'MATERIAL_CHALLAN';

-- CreateTable
CREATE TABLE "MaterialChallan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentTo" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "carrier" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "MaterialChallan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialChallan_projectId_sentAt_idx" ON "MaterialChallan"("projectId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialChallan_companyId_number_key" ON "MaterialChallan"("companyId", "number");

-- AddForeignKey
ALTER TABLE "MaterialChallan" ADD CONSTRAINT "MaterialChallan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialChallan" ADD CONSTRAINT "MaterialChallan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialChallan" ADD CONSTRAINT "MaterialChallan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

