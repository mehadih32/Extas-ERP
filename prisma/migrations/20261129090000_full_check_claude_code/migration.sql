-- v6.3 G: AI Center > Full check (runs and problems), Claude Code requests, and the GitHub connection.
-- CreateEnum
CREATE TYPE "FullCheckStatus" AS ENUM ('STARTING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ClaudeCodeRequestKind" AS ENUM ('FIX', 'ASK');

-- CreateEnum
CREATE TYPE "ClaudeCodeRequestState" AS ENUM ('SENT', 'PR_OPEN', 'MERGED', 'STOPPED');

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "githubRepo" TEXT,
ADD COLUMN     "githubTest" JSONB,
ADD COLUMN     "githubTokenHint" TEXT,
ADD COLUMN     "githubTokenSealed" TEXT;

-- CreateTable
CREATE TABLE "FullCheckRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "status" "FullCheckStatus" NOT NULL DEFAULT 'STARTING',
    "passHash" TEXT,
    "passUsedAt" TIMESTAMP(3),
    "reportHash" TEXT,
    "githubRunUrl" TEXT,
    "summary" JSONB,
    "note" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "FullCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FullCheckProblem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "pattern" TEXT,
    "text" TEXT NOT NULL,
    "detail" TEXT,
    "ms" INTEGER,
    "shotPath" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FullCheckProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaudeCodeRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ClaudeCodeRequestKind" NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "state" "ClaudeCodeRequestState" NOT NULL DEFAULT 'SENT',
    "issueNumber" INTEGER,
    "issueUrl" TEXT,
    "branch" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "checks" TEXT,
    "headSha" TEXT,
    "askedSha" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "lookedAt" TIMESTAMP(3),
    "mergedAt" TIMESTAMP(3),
    "mergedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaudeCodeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FullCheckRun_passHash_key" ON "FullCheckRun"("passHash");

-- CreateIndex
CREATE UNIQUE INDEX "FullCheckRun_reportHash_key" ON "FullCheckRun"("reportHash");

-- CreateIndex
CREATE INDEX "FullCheckRun_companyId_startedAt_idx" ON "FullCheckRun"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "FullCheckProblem_companyId_runId_idx" ON "FullCheckProblem"("companyId", "runId");

-- CreateIndex
CREATE INDEX "FullCheckProblem_requestId_idx" ON "FullCheckProblem"("requestId");

-- CreateIndex
CREATE INDEX "ClaudeCodeRequest_companyId_createdAt_idx" ON "ClaudeCodeRequest"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaudeCodeRequest_state_idx" ON "ClaudeCodeRequest"("state");

-- AddForeignKey
ALTER TABLE "FullCheckRun" ADD CONSTRAINT "FullCheckRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FullCheckRun" ADD CONSTRAINT "FullCheckRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FullCheckProblem" ADD CONSTRAINT "FullCheckProblem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FullCheckProblem" ADD CONSTRAINT "FullCheckProblem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FullCheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FullCheckProblem" ADD CONSTRAINT "FullCheckProblem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClaudeCodeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaudeCodeRequest" ADD CONSTRAINT "ClaudeCodeRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaudeCodeRequest" ADD CONSTRAINT "ClaudeCodeRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

