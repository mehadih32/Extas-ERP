-- CreateEnum
CREATE TYPE "BookingStage" AS ENUM ('DRAFT', 'APPROVED', 'SENT');

-- CreateEnum
CREATE TYPE "TechPackStatus" AS ENUM ('DRAFT', 'APPROVED');

-- AlterEnum
ALTER TYPE "CollarStyle" ADD VALUE 'MULTI_STRIPE';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "fabricBasis" JSONB,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revisionChanges" JSONB,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentById" TEXT,
ADD COLUMN     "stage" "BookingStage" NOT NULL DEFAULT 'SENT';

-- Bookings made before approvals existed went to their suppliers as they were made.
UPDATE "Booking" SET "sentAt" = "createdAt";
-- From now on a booking starts as a draft and needs approval.
ALTER TABLE "Booking" ALTER COLUMN "stage" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "ProductionBatch" ADD COLUMN     "fabricFirstAt" TIMESTAMP(3),
ADD COLUMN     "fabricFirstById" TEXT;

-- CreateTable
CREATE TABLE "BookingRevision" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechPack" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "TechPackStatus" NOT NULL DEFAULT 'DRAFT',
    "fabricLock" JSONB,
    "fabricLockedAt" TIMESTAMP(3),
    "fabricLockedById" TEXT,
    "approvedPart" JSONB,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingRevision_companyId_idx" ON "BookingRevision"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingRevision_bookingId_revision_key" ON "BookingRevision"("bookingId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TechPack_projectId_key" ON "TechPack"("projectId");

-- CreateIndex
CREATE INDEX "TechPack_companyId_status_idx" ON "TechPack"("companyId", "status");

-- CreateIndex
CREATE INDEX "Booking_companyId_stage_idx" ON "Booking"("companyId", "stage");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRevision" ADD CONSTRAINT "BookingRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRevision" ADD CONSTRAINT "BookingRevision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRevision" ADD CONSTRAINT "BookingRevision_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_fabricFirstById_fkey" FOREIGN KEY ("fabricFirstById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_fabricLockedById_fkey" FOREIGN KEY ("fabricLockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

