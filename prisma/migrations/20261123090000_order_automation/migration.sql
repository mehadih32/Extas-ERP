-- Order automation and Server Health (v6.2 part 10): order runs, staff updates,
-- Server Health runs, the brief and weekly-check settings on AiSettings and the
-- AO numbering. Additive only: new tables, new columns with defaults, one enum value.

-- CreateEnum
CREATE TYPE "AiOrderRunStatus" AS ENUM ('INTAKE', 'WAITING_OWNER', 'APPROVED', 'RETURNED', 'CANCELLED', 'DONE');

-- CreateEnum
CREATE TYPE "AiOrderMode" AS ENUM ('DRY_RUN', 'ASK');

-- CreateEnum
CREATE TYPE "ServerHealthTrigger" AS ENUM ('WEEKLY', 'CHECK_NOW');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'AI_ORDER_RUN';

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "briefSentOn" TEXT,
ADD COLUMN     "eveningReport" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "healthRanOn" TEXT,
ADD COLUMN     "healthWeekly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "morningBrief" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reportSentOn" TEXT;

-- CreateTable
CREATE TABLE "AiOrderRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" "AiOrderMode" NOT NULL DEFAULT 'DRY_RUN',
    "status" "AiOrderRunStatus" NOT NULL DEFAULT 'INTAKE',
    "buyerId" TEXT,
    "costingId" TEXT,
    "salesOrderId" TEXT,
    "fields" JSONB NOT NULL,
    "missing" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plan" TEXT,
    "planByAi" BOOLEAN NOT NULL DEFAULT false,
    "plannedAt" TIMESTAMP(3),
    "estimatedAiCost" DECIMAL(12,2),
    "startedVia" "AiChannel" NOT NULL DEFAULT 'ERP',
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "lateToldOn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiOrderRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiStaffUpdate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT,
    "userId" TEXT,
    "text" TEXT NOT NULL,
    "problem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiStaffUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerHealthRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trigger" "ServerHealthTrigger" NOT NULL,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "worst" TEXT NOT NULL DEFAULT 'OK',
    "checks" JSONB NOT NULL,
    "report" TEXT NOT NULL,
    "reportByAi" BOOLEAN NOT NULL DEFAULT false,
    "aiCost" DECIMAL(12,2),
    "fixes" JSONB NOT NULL,

    CONSTRAINT "ServerHealthRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiOrderRun_companyId_status_idx" ON "AiOrderRun"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiOrderRun_companyId_number_key" ON "AiOrderRun"("companyId", "number");

-- CreateIndex
CREATE INDEX "AiStaffUpdate_companyId_createdAt_idx" ON "AiStaffUpdate"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AiStaffUpdate_runId_idx" ON "AiStaffUpdate"("runId");

-- CreateIndex
CREATE INDEX "ServerHealthRun_companyId_startedAt_idx" ON "ServerHealthRun"("companyId", "startedAt");

-- AddForeignKey
ALTER TABLE "AiOrderRun" ADD CONSTRAINT "AiOrderRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOrderRun" ADD CONSTRAINT "AiOrderRun_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOrderRun" ADD CONSTRAINT "AiOrderRun_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "OrderCosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOrderRun" ADD CONSTRAINT "AiOrderRun_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOrderRun" ADD CONSTRAINT "AiOrderRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOrderRun" ADD CONSTRAINT "AiOrderRun_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiStaffUpdate" ADD CONSTRAINT "AiStaffUpdate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiStaffUpdate" ADD CONSTRAINT "AiStaffUpdate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiOrderRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiStaffUpdate" ADD CONSTRAINT "AiStaffUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerHealthRun" ADD CONSTRAINT "ServerHealthRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerHealthRun" ADD CONSTRAINT "ServerHealthRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

