-- Cutting reports (pieces cut by colour and size, AI or typed), embroidery and print jobs,
-- the cutting and sewing milestones on a style, and a photo on a supplier fault.
-- CreateEnum
CREATE TYPE "CuttingKind" AS ENUM ('CUT', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "EmbroideryKind" AS ENUM ('EMBROIDERY', 'PRINT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'CUTTING_REPORT';
ALTER TYPE "DocumentType" ADD VALUE 'EMBROIDERY_JOB';

-- AlterTable
ALTER TABLE "ProductionProject" ADD COLUMN     "cutBy" DATE,
ADD COLUMN     "sewBy" DATE;

-- AlterTable
ALTER TABLE "SupplierFault" ADD COLUMN     "photoId" TEXT;

-- CreateTable
CREATE TABLE "CuttingReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "CuttingKind" NOT NULL DEFAULT 'CUT',
    "cutOn" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "fabricUsed" JSONB NOT NULL DEFAULT '[]',
    "photoId" TEXT,
    "readByAi" BOOLEAN NOT NULL DEFAULT false,
    "embroideryJobId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuttingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbroideryJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "EmbroideryKind" NOT NULL DEFAULT 'EMBROIDERY',
    "partyId" TEXT,
    "sentOn" DATE NOT NULL,
    "dueOn" DATE,
    "receivedOn" DATE,
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmbroideryJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CuttingReport_projectId_cutOn_idx" ON "CuttingReport"("projectId", "cutOn");

-- CreateIndex
CREATE UNIQUE INDEX "CuttingReport_companyId_number_key" ON "CuttingReport"("companyId", "number");

-- CreateIndex
CREATE INDEX "EmbroideryJob_projectId_sentOn_idx" ON "EmbroideryJob"("projectId", "sentOn");

-- CreateIndex
CREATE UNIQUE INDEX "EmbroideryJob_companyId_number_key" ON "EmbroideryJob"("companyId", "number");

-- AddForeignKey
ALTER TABLE "SupplierFault" ADD CONSTRAINT "SupplierFault_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingReport" ADD CONSTRAINT "CuttingReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingReport" ADD CONSTRAINT "CuttingReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingReport" ADD CONSTRAINT "CuttingReport_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingReport" ADD CONSTRAINT "CuttingReport_embroideryJobId_fkey" FOREIGN KEY ("embroideryJobId") REFERENCES "EmbroideryJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuttingReport" ADD CONSTRAINT "CuttingReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbroideryJob" ADD CONSTRAINT "EmbroideryJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbroideryJob" ADD CONSTRAINT "EmbroideryJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbroideryJob" ADD CONSTRAINT "EmbroideryJob_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbroideryJob" ADD CONSTRAINT "EmbroideryJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

