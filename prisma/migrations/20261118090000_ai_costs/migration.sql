-- CreateEnum
CREATE TYPE "AiCallResult" AS ENUM ('OK', 'FAILED', 'STOPPED');

-- CreateEnum
CREATE TYPE "AiAtLimit" AS ENUM ('STOP', 'CHEAPER');

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "agent" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "recordType" TEXT,
    "recordId" TEXT,
    "recordLabel" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "usdRate" DECIMAL(10,4) NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "result" "AiCallResult" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiBudget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "monthly" DECIMAL(12,2),
    "daily" DECIMAL(12,2),
    "perOrder" DECIMAL(12,2),
    "perStaffMonthly" DECIMAL(12,2),
    "perAgentMonthly" DECIMAL(12,2),
    "askAbove" DECIMAL(12,2),
    "alertPercent" INTEGER NOT NULL DEFAULT 80,
    "atLimit" "AiAtLimit" NOT NULL DEFAULT 'STOP',
    "usdRate" DECIMAL(10,4) NOT NULL DEFAULT 122,
    "alertedMonth" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsage_companyId_createdAt_idx" ON "AiUsage"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_companyId_recordType_recordId_idx" ON "AiUsage"("companyId", "recordType", "recordId");

-- CreateIndex
CREATE INDEX "AiUsage_companyId_userId_createdAt_idx" ON "AiUsage"("companyId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiBudget_companyId_key" ON "AiBudget"("companyId");

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBudget" ADD CONSTRAINT "AiBudget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBudget" ADD CONSTRAINT "AiBudget_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

