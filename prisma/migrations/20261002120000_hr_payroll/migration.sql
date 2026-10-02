-- CreateEnum
CREATE TYPE "AdvanceSettlementKind" AS ENUM ('PAYROLL', 'EXPENSE', 'CASH_RETURN');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'SELF');

-- AlterEnum
ALTER TYPE "AdvanceStatus" ADD VALUE 'VOID';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SALARY_ADVANCE';

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_salaryAdvanceId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollItem" DROP CONSTRAINT "PayrollItem_journalEntryId_fkey";

-- DropIndex
DROP INDEX "PayrollItem_journalEntryId_key";

-- AlterTable
ALTER TABLE "AdvanceSettlement" ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "kind" "AdvanceSettlementKind",
ADD COLUMN     "note" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- Backfill: settlements made before this migration name what settled them.
UPDATE "AdvanceSettlement" SET "kind" = CASE
  WHEN "payrollItemId" IS NOT NULL THEN 'PAYROLL'::"AdvanceSettlementKind"
  WHEN "expenseId" IS NOT NULL THEN 'EXPENSE'::"AdvanceSettlementKind"
  ELSE 'CASH_RETURN'::"AdvanceSettlementKind"
END;
ALTER TABLE "AdvanceSettlement" ALTER COLUMN "kind" SET NOT NULL;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "emergencyContact" TEXT,
ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "overtimeRate" DECIMAL(10,2),
ADD COLUMN     "salaryMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "walletNumber" TEXT,
ALTER COLUMN "joinDate" SET DATA TYPE DATE,
ALTER COLUMN "exitDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "salaryAdvanceId";

-- AlterTable
ALTER TABLE "LeaveBalance" ADD COLUMN     "adjusted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "halfDay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requestedById" TEXT;

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "prorate" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PayrollItem" DROP COLUMN "isPaid",
DROP COLUMN "journalEntryId",
ADD COLUMN     "absentDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "advanceEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "monthlySalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "overtimeEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overtimeHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paidLeaveDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "presentDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "taxDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unpaidDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "unpaidLeaveDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
ADD COLUMN     "workingDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PayrollRun" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SalaryAdvance" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "installmentAmount" DECIMAL(14,2),
ADD COLUMN     "isOpening" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "number" TEXT,
ADD COLUMN     "recoverFrom" DATE,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- Backfill: advances recorded before numbering existed.
UPDATE "SalaryAdvance" SET "number" = 'ADV-' || "id" WHERE "number" IS NULL;
ALTER TABLE "SalaryAdvance" ALTER COLUMN "number" SET NOT NULL;

-- AlterTable
ALTER TABLE "SalaryRevision" ALTER COLUMN "effectiveFrom" SET DATA TYPE DATE;

-- CreateTable
CREATE TABLE "HrSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weeklyOffDays" INTEGER[] DEFAULT ARRAY[5]::INTEGER[],
    "officeStartTime" TEXT NOT NULL DEFAULT '09:00',
    "lateGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "latesPerDeductionDay" INTEGER NOT NULL DEFAULT 0,
    "selfCheckIn" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL',
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "employeeCount" INTEGER NOT NULL,
    "reference" TEXT,
    "journalEntryId" TEXT,
    "paidById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrSettings_companyId_key" ON "HrSettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_companyId_date_key" ON "Holiday"("companyId", "date");

-- CreateIndex
CREATE INDEX "Attendance_companyId_date_idx" ON "Attendance"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_journalEntryId_key" ON "PayrollPayment"("journalEntryId");

-- CreateIndex
CREATE INDEX "PayrollPayment_runId_idx" ON "PayrollPayment"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_companyId_number_key" ON "PayrollPayment"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceSettlement_journalEntryId_key" ON "AdvanceSettlement"("journalEntryId");

-- CreateIndex
CREATE INDEX "AdvanceSettlement_advanceId_idx" ON "AdvanceSettlement"("advanceId");

-- CreateIndex
CREATE INDEX "AdvanceSettlement_payrollItemId_idx" ON "AdvanceSettlement"("payrollItemId");

-- CreateIndex
CREATE INDEX "AdvanceSettlement_expenseId_idx" ON "AdvanceSettlement"("expenseId");

-- CreateIndex
CREATE INDEX "LeaveRequest_companyId_status_idx" ON "LeaveRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "PayrollItem_employeeId_idx" ON "PayrollItem"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollItem_paymentId_idx" ON "PayrollItem"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_journalEntryId_key" ON "PayrollRun"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryAdvance_journalEntryId_key" ON "SalaryAdvance"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryAdvance_companyId_number_key" ON "SalaryAdvance"("companyId", "number");

-- AddForeignKey
ALTER TABLE "HrSettings" ADD CONSTRAINT "HrSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PayrollPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceSettlement" ADD CONSTRAINT "AdvanceSettlement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The new payroll approval permission, so it can be granted to custom roles before
-- the seed next syncs the permission catalogue (Super Admin has every permission).
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES (gen_random_uuid()::text, 'hr.payroll.approve', 'HR',
        'Approve or reopen monthly payroll (posts the salaries to the books)')
ON CONFLICT ("key") DO NOTHING;

-- Default HR grants for built-in roles that already exist (new companies get them
-- from DEFAULT_ROLE_PERMISSIONS): Accounts prepares payroll and sees salaries, and
-- every staff role can use the employee portal for their own records.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('hr.view', 'hr.payroll', 'portal.self')
WHERE r."systemRole" = 'ACCOUNTS'
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" = 'portal.self'
WHERE r."systemRole" IN ('PRODUCTION_MANAGER', 'SALES_EXECUTIVE', 'WAREHOUSE_TEAM')
ON CONFLICT DO NOTHING;
