-- v6.4 Part C: Bug Guard, the owner's all-round auditor (modules/bug-guard).
-- New tables only, and one new journal source (CORRECTION) for the adjusting
-- entries it posts with the owner's PIN. Nothing existing changes.

-- CreateEnum
CREATE TYPE "BugGuardTrigger" AS ENUM ('SCHEDULE', 'NOW', 'TELEGRAM', 'AFTER_FIX');

-- CreateEnum
CREATE TYPE "BugGuardRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "BugGuardArea" AS ENUM ('APP', 'DATA', 'SECURITY', 'PRODUCT', 'AI');

-- CreateEnum
CREATE TYPE "BugGuardSeverity" AS ENUM ('URGENT', 'IMPORTANT', 'LATER');

-- CreateEnum
CREATE TYPE "BugGuardFixKind" AS ENUM ('CODE', 'DATA', 'SECURITY', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "BugGuardFindingStatus" AS ENUM ('OPEN', 'IGNORED', 'SNOOZED', 'FIXING', 'FIXED', 'GONE');

-- CreateEnum
CREATE TYPE "BugGuardCorrectionStatus" AS ENUM ('PREPARED', 'BACKING_UP', 'APPLIED', 'UNDONE', 'FAILED', 'STALE');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('VIEW', 'ABANDONED', 'HELP_MISS');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'CORRECTION';

-- CreateTable
CREATE TABLE "BugGuardSettings" (
    "companyId" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "autoPrepare" BOOLEAN NOT NULL DEFAULT false,
    "weeklyDay" INTEGER NOT NULL DEFAULT 6,
    "weeklyTime" TEXT NOT NULL DEFAULT '10:00',
    "weeklySentOn" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugGuardSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "BugGuardRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trigger" "BugGuardTrigger" NOT NULL,
    "status" "BugGuardRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "checks" JSONB NOT NULL DEFAULT '[]',
    "urgent" INTEGER NOT NULL DEFAULT 0,
    "important" INTEGER NOT NULL DEFAULT 0,
    "later" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "fixedCount" INTEGER NOT NULL DEFAULT 0,
    "fullCheckRunId" TEXT,
    "note" TEXT,
    "reportSentAt" TIMESTAMP(3),

    CONSTRAINT "BugGuardRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugGuardFinding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "area" "BugGuardArea" NOT NULL,
    "severity" "BugGuardSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "href" TEXT,
    "place" TEXT,
    "why" TEXT NOT NULL,
    "fix" TEXT NOT NULL,
    "fixKind" "BugGuardFixKind" NOT NULL,
    "evidence" JSONB,
    "correction" JSONB,
    "action" JSONB,
    "code" JSONB,
    "status" "BugGuardFindingStatus" NOT NULL DEFAULT 'OPEN',
    "snoozedUntil" TIMESTAMP(3),
    "firstRunId" TEXT,
    "lastRunId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "goneAt" TIMESTAMP(3),
    "requestId" TEXT,
    "reportedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "BugGuardFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugGuardCorrection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "BugGuardCorrectionStatus" NOT NULL DEFAULT 'PREPARED',
    "backupRunId" TEXT,
    "journalEntryId" TEXT,
    "undoJournalEntryId" TEXT,
    "preparedById" TEXT,
    "preparedByGuard" BOOLEAN NOT NULL DEFAULT false,
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "undoneAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugGuardCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugGuardEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT,
    "findingId" TEXT,
    "correctionId" TEXT,
    "kind" TEXT NOT NULL,
    "byId" TEXT,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugGuardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginBlock" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3) NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftedById" TEXT,

    CONSTRAINT "LoginBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerError" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "routeType" TEXT NOT NULL,
    "method" TEXT,
    "path" TEXT NOT NULL,
    "errorName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT[],
    "digest" TEXT,
    "errorId" TEXT,

    CONSTRAINT "ServerError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BugGuardRun_companyId_startedAt_idx" ON "BugGuardRun"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "BugGuardRun_status_idx" ON "BugGuardRun"("status");

-- CreateIndex
CREATE INDEX "BugGuardFinding_companyId_status_idx" ON "BugGuardFinding"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BugGuardFinding_companyId_key_key" ON "BugGuardFinding"("companyId", "key");

-- CreateIndex
CREATE INDEX "BugGuardCorrection_companyId_status_idx" ON "BugGuardCorrection"("companyId", "status");

-- CreateIndex
CREATE INDEX "BugGuardCorrection_findingId_idx" ON "BugGuardCorrection"("findingId");

-- CreateIndex
CREATE INDEX "BugGuardEvent_companyId_createdAt_idx" ON "BugGuardEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "BugGuardEvent_findingId_idx" ON "BugGuardEvent"("findingId");

-- CreateIndex
CREATE INDEX "LoginBlock_source_blockedUntil_idx" ON "LoginBlock"("source", "blockedUntil");

-- CreateIndex
CREATE INDEX "ServerError_at_idx" ON "ServerError"("at");

-- CreateIndex
CREATE INDEX "ServerError_companyId_at_idx" ON "ServerError"("companyId", "at");

-- CreateIndex
CREATE INDEX "UsageCount_companyId_kind_day_idx" ON "UsageCount"("companyId", "kind", "day");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCount_companyId_day_kind_subject_key" ON "UsageCount"("companyId", "day", "kind", "subject");

-- AddForeignKey
ALTER TABLE "BugGuardSettings" ADD CONSTRAINT "BugGuardSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugGuardRun" ADD CONSTRAINT "BugGuardRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugGuardFinding" ADD CONSTRAINT "BugGuardFinding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugGuardCorrection" ADD CONSTRAINT "BugGuardCorrection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugGuardCorrection" ADD CONSTRAINT "BugGuardCorrection_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "BugGuardFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugGuardEvent" ADD CONSTRAINT "BugGuardEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugGuardEvent" ADD CONSTRAINT "BugGuardEvent_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginBlock" ADD CONSTRAINT "LoginBlock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerError" ADD CONSTRAINT "ServerError_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCount" ADD CONSTRAINT "UsageCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

