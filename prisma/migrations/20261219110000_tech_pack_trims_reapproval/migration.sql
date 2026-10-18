-- v6.4.2: an approved tech pack keeps its trims part (trims, collar, cuff); a change
-- after approval is logged and waits to be approved again. Additive only.

-- AlterTable
ALTER TABLE "TechPack" ADD COLUMN     "trimsApprovedAt" TIMESTAMP(3),
ADD COLUMN     "trimsApproverId" TEXT,
ADD COLUMN     "trimsPart" JSONB;

-- CreateTable
CREATE TABLE "TechPackChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "techPackId" TEXT NOT NULL,
    "part" TEXT NOT NULL DEFAULT 'TRIMS',
    "changes" JSONB NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechPackChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechPackChange_techPackId_createdAt_idx" ON "TechPackChange"("techPackId", "createdAt");

-- CreateIndex
CREATE INDEX "TechPackChange_companyId_createdAt_idx" ON "TechPackChange"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_trimsApproverId_fkey" FOREIGN KEY ("trimsApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackChange" ADD CONSTRAINT "TechPackChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackChange" ADD CONSTRAINT "TechPackChange_techPackId_fkey" FOREIGN KEY ("techPackId") REFERENCES "TechPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackChange" ADD CONSTRAINT "TechPackChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

