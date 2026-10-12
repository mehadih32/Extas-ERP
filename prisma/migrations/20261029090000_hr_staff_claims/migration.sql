-- HR & Payroll overhaul 5: smart conveyance and local material claims. Staff
-- claim money back from My HR: a trip (checked against their GPS trail and the
-- usual fare per km) or material bought locally for a production project.
-- Accounts approves a claim: the cost goes into the books (a conveyance
-- expense, or a cost on the project) and is owed to the employee until paid
-- back. Additive only: a new table, new enum values and a new HrSettings
-- column with a default.

-- CreateEnum
CREATE TYPE "StaffClaimKind" AS ENUM ('CONVEYANCE', 'LOCAL_MATERIAL');

-- CreateEnum
CREATE TYPE "StaffClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "StaffClaimFlag" AS ENUM ('NOT_ON_DUTY', 'NO_TRAIL', 'NO_TRAVEL', 'ROUTE_MISMATCH', 'HIGH_PRICE', 'DUPLICATE', 'NO_RECEIPT');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'STAFF_CLAIM';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'STAFF_CLAIM';

-- AlterTable
ALTER TABLE "HrSettings" ADD COLUMN     "conveyanceRatePerKm" DECIMAL(10,2) NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "StaffClaim" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "StaffClaimKind" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "purpose" TEXT,
    "fromPlace" TEXT,
    "toPlace" TEXT,
    "routeKey" TEXT,
    "projectId" TEXT,
    "item" TEXT,
    "quantity" TEXT,
    "shop" TEXT,
    "receiptFileId" TEXT,
    "flags" "StaffClaimFlag"[],
    "check" JSONB,
    "checkedAt" TIMESTAMP(3),
    "roadMetres" INTEGER,
    "fromLat" DOUBLE PRECISION,
    "fromLng" DOUBLE PRECISION,
    "toLat" DOUBLE PRECISION,
    "toLng" DOUBLE PRECISION,
    "roadCheckedAt" TIMESTAMP(3),
    "status" "StaffClaimStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAmount" DECIMAL(14,2),
    "reason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expenseId" TEXT,
    "costHeadId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paymentEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffClaim_expenseId_key" ON "StaffClaim"("expenseId");

-- CreateIndex
CREATE INDEX "StaffClaim_companyId_status_date_idx" ON "StaffClaim"("companyId", "status", "date");

-- CreateIndex
CREATE INDEX "StaffClaim_employeeId_date_idx" ON "StaffClaim"("employeeId", "date");

-- CreateIndex
CREATE INDEX "StaffClaim_companyId_routeKey_idx" ON "StaffClaim"("companyId", "routeKey");

-- CreateIndex
CREATE INDEX "StaffClaim_projectId_idx" ON "StaffClaim"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffClaim_companyId_number_key" ON "StaffClaim"("companyId", "number");

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_costHeadId_fkey" FOREIGN KEY ("costHeadId") REFERENCES "ExpenseHead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_paymentEntryId_fkey" FOREIGN KEY ("paymentEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
