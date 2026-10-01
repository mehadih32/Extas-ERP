-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'COMPANY_SWITCH';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_CHANGE';

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "companyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "activeCompanyId" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeCompanyId_fkey" FOREIGN KEY ("activeCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
