-- HR & Payroll overhaul 3: GPS attendance. Work places with a radius, where the
-- phone was at check-in and check-out (with the IP address and a location
-- mismatch flag), on-duty location pings and each person's latest position.
-- Additive only: new columns are nullable or default to false, and location is
-- asked for only once HR turns it on (HrSettings.gpsAttendance).

-- CreateEnum
CREATE TYPE "PingSource" AS ENUM ('WEB', 'ANDROID');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "checkInAccuracy" DOUBLE PRECISION,
ADD COLUMN     "checkInAway" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkInDistance" INTEGER,
ADD COLUMN     "checkInIp" TEXT,
ADD COLUMN     "checkInLat" DOUBLE PRECISION,
ADD COLUMN     "checkInLng" DOUBLE PRECISION,
ADD COLUMN     "checkInPlaceId" TEXT,
ADD COLUMN     "checkOutAccuracy" DOUBLE PRECISION,
ADD COLUMN     "checkOutAway" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkOutDistance" INTEGER,
ADD COLUMN     "checkOutIp" TEXT,
ADD COLUMN     "checkOutLat" DOUBLE PRECISION,
ADD COLUMN     "checkOutLng" DOUBLE PRECISION,
ADD COLUMN     "checkOutPlaceId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "workLocationId" TEXT;

-- AlterTable
ALTER TABLE "HrSettings" ADD COLUMN     "gpsAttendance" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" BIGSERIAL NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "battery" INTEGER,
    "source" "PingSource" NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPosition" (
    "employeeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "battery" INTEGER,
    "source" "PingSource" NOT NULL DEFAULT 'WEB',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPosition_pkey" PRIMARY KEY ("employeeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkLocation_companyId_name_key" ON "WorkLocation"("companyId", "name");

-- CreateIndex
CREATE INDEX "LocationPing_employeeId_at_idx" ON "LocationPing"("employeeId", "at");

-- CreateIndex
CREATE INDEX "LocationPing_companyId_at_idx" ON "LocationPing"("companyId", "at");

-- CreateIndex
CREATE INDEX "StaffPosition_companyId_idx" ON "StaffPosition"("companyId");

-- CreateIndex
CREATE INDEX "Employee_workLocationId_idx" ON "Employee"("workLocationId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_checkInPlaceId_fkey" FOREIGN KEY ("checkInPlaceId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_checkOutPlaceId_fkey" FOREIGN KEY ("checkOutPlaceId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLocation" ADD CONSTRAINT "WorkLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPosition" ADD CONSTRAINT "StaffPosition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPosition" ADD CONSTRAINT "StaffPosition_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

