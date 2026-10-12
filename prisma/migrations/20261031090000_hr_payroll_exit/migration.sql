-- HR & Payroll overhaul, PR 7: payroll and leaving. Additive only.
--  * PayrollItem.reimbursements: approved staff claims paid back with the
--    salary; StaffClaim.payrollItemId links each claim to that salary line.
--  * Salaries paid in parts: PayrollItem.paidAmount and one PayrollPaymentLine
--    per employee per payment, with the wallet payout's state.
--  * EmployeeAsset: company items given to staff and returned.
--  * EmployeeDocumentKind.CLEARANCE: the experience and clearance certificate.
-- Salaries already paid get their amount paid and payment line at the end.

-- CreateEnum
CREATE TYPE "PayoutState" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('LAPTOP', 'PHONE', 'SIM', 'ID_CARD', 'KEY', 'UNIFORM', 'TOOL', 'VEHICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetReturn" AS ENUM ('GOOD', 'DAMAGED', 'LOST');

-- AlterEnum
ALTER TYPE "EmployeeDocumentKind" ADD VALUE 'CLEARANCE';

-- AlterTable
ALTER TABLE "PayrollItem" ADD COLUMN     "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "reimbursements" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StaffClaim" ADD COLUMN     "payrollItemId" TEXT;

-- CreateTable
CREATE TABLE "EmployeeAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'OTHER',
    "tag" TEXT,
    "value" DECIMAL(14,2),
    "issuedOn" DATE NOT NULL,
    "issueNote" TEXT,
    "issuedById" TEXT,
    "returnedOn" DATE,
    "returnCondition" "AssetReturn",
    "returnNote" TEXT,
    "returnedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPaymentLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payout" "PayoutState",
    "payoutReference" TEXT,
    "payoutError" TEXT,
    "payoutAt" TIMESTAMP(3),

    CONSTRAINT "PayrollPaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeAsset_companyId_returnedOn_idx" ON "EmployeeAsset"("companyId", "returnedOn");

-- CreateIndex
CREATE INDEX "EmployeeAsset_employeeId_returnedOn_idx" ON "EmployeeAsset"("employeeId", "returnedOn");

-- CreateIndex
CREATE INDEX "PayrollPaymentLine_paymentId_idx" ON "PayrollPaymentLine"("paymentId");

-- CreateIndex
CREATE INDEX "PayrollPaymentLine_itemId_idx" ON "PayrollPaymentLine"("itemId");

-- CreateIndex
CREATE INDEX "StaffClaim_payrollItemId_idx" ON "StaffClaim"("payrollItemId");

-- AddForeignKey
ALTER TABLE "StaffClaim" ADD CONSTRAINT "StaffClaim_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "PayrollItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAsset" ADD CONSTRAINT "EmployeeAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAsset" ADD CONSTRAINT "EmployeeAsset_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAsset" ADD CONSTRAINT "EmployeeAsset_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAsset" ADD CONSTRAINT "EmployeeAsset_returnedToId_fkey" FOREIGN KEY ("returnedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentLine" ADD CONSTRAINT "PayrollPaymentLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentLine" ADD CONSTRAINT "PayrollPaymentLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PayrollPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentLine" ADD CONSTRAINT "PayrollPaymentLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PayrollItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Salaries already paid in full: the amount paid and one payment line each.
UPDATE "PayrollItem" SET "paidAmount" = "netPay" WHERE "paymentId" IS NOT NULL;

INSERT INTO "PayrollPaymentLine" ("id", "companyId", "paymentId", "itemId", "amount")
SELECT 'pl' || i."id", p."companyId", p."id", i."id", i."netPay"
FROM "PayrollItem" i
JOIN "PayrollPayment" p ON p."id" = i."paymentId";
