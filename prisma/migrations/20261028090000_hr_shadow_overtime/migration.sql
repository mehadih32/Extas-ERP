-- HR & Payroll overhaul 4: shadow overtime. The app finds overtime from self
-- check-outs (after the end of the working day, or all of a day off) and keeps
-- it for HR to approve; staff never see it. Only approved minutes go on the
-- day's attendance, which payroll already pays. Additive only: a new table and
-- new HrSettings columns with defaults.

-- CreateEnum
CREATE TYPE "OvertimeBasis" AS ENUM ('AFTER_HOURS', 'DAY_OFF');

-- CreateEnum
CREATE TYPE "OvertimeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "HrSettings" ADD COLUMN     "officeEndTime" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "overtimeMinMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "shadowOvertime" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "OvertimeEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "basis" "OvertimeBasis" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "detectedMinutes" INTEGER NOT NULL,
    "suggestedMinutes" INTEGER,
    "lastAtPlace" TIMESTAMP(3),
    "status" "OvertimeStatus" NOT NULL DEFAULT 'PENDING',
    "approvedMinutes" INTEGER,
    "reason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeEntry_attendanceId_key" ON "OvertimeEntry"("attendanceId");

-- CreateIndex
CREATE INDEX "OvertimeEntry_companyId_status_date_idx" ON "OvertimeEntry"("companyId", "status", "date");

-- CreateIndex
CREATE INDEX "OvertimeEntry_employeeId_date_idx" ON "OvertimeEntry"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

