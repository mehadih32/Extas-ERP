-- HR & Payroll overhaul 1: the employee data vault.
-- Additive only: four optional employee columns (bank branch and a reference person),
-- pay detail change requests and vault documents. No existing row changes.
-- CreateEnum
CREATE TYPE "PayRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EmployeeDocumentKind" AS ENUM ('NID', 'PHOTO', 'CERTIFICATE', 'CONTRACT', 'OTHER');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bankBranch" TEXT,
ADD COLUMN     "referenceName" TEXT,
ADD COLUMN     "referencePhone" TEXT,
ADD COLUMN     "referenceRelation" TEXT;

-- CreateTable
CREATE TABLE "PayDetailsRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "previous" JSONB NOT NULL,
    "note" TEXT,
    "status" "PayRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayDetailsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "EmployeeDocumentKind" NOT NULL,
    "title" TEXT,
    "fileId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayDetailsRequest_companyId_status_createdAt_idx" ON "PayDetailsRequest"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PayDetailsRequest_employeeId_createdAt_idx" ON "PayDetailsRequest"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_kind_createdAt_idx" ON "EmployeeDocument"("employeeId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_fileId_idx" ON "EmployeeDocument"("fileId");

-- AddForeignKey
ALTER TABLE "PayDetailsRequest" ADD CONSTRAINT "PayDetailsRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayDetailsRequest" ADD CONSTRAINT "PayDetailsRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayDetailsRequest" ADD CONSTRAINT "PayDetailsRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayDetailsRequest" ADD CONSTRAINT "PayDetailsRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

