-- Mehedi 2.0 (v6.2 part 8): the AI's own account, his books and tests, the chat,
-- drafts and follow-ups, House Rules and the company's mailbox for sending.
-- Additive only: new tables and two new columns on AiSettings.

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AiChatRole" AS ENUM ('OWNER', 'AI');

-- CreateEnum
CREATE TYPE "AiCardStatus" AS ENUM ('PROPOSED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiDraftKind" AS ENUM ('BUYER_REPLY', 'BUYER_FOLLOW_UP', 'BUYER_CHASE', 'BUYER_CLAIM', 'QUOTATION', 'INVOICE', 'SUPPLIER', 'FACTORY', 'OTHER');

-- CreateEnum
CREATE TYPE "AiDraftStatus" AS ENUM ('DRAFT', 'SENT', 'DISCARDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiFollowUpStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HouseRuleScope" AS ENUM ('ALL', 'BUYER', 'BRAND', 'ITEM');

-- CreateEnum
CREATE TYPE "HouseRuleStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'RETIRED');

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "aiUserId" TEXT,
ADD COLUMN     "replyRemindHours" INTEGER NOT NULL DEFAULT 24;

-- CreateTable
CREATE TABLE "AiKnowledgeBook" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTestRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "bookVersion" TEXT NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'RUNNING',
    "total" INTEGER NOT NULL,
    "right" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB,
    "model" TEXT,
    "error" TEXT,
    "startedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiChatMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "AiChannel" NOT NULL DEFAULT 'ERP',
    "role" "AiChatRole" NOT NULL,
    "text" TEXT NOT NULL,
    "intent" TEXT,
    "card" JSONB,
    "cardStatus" "AiCardStatus",
    "cardDoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDraft" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AiDraftKind" NOT NULL,
    "partyId" TEXT,
    "toAddress" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recordType" TEXT,
    "recordId" TEXT,
    "recordLabel" TEXT,
    "status" "AiDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "byAi" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "remindAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "followUpId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiFollowUp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "recordType" TEXT,
    "recordId" TEXT,
    "recordLabel" TEXT,
    "dueOn" DATE NOT NULL,
    "note" TEXT,
    "status" "AiFollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "draftId" TEXT,
    "remindedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "said" TEXT,
    "scope" "HouseRuleScope" NOT NULL DEFAULT 'ALL',
    "scopeValue" TEXT,
    "status" "HouseRuleStatus" NOT NULL DEFAULT 'PROPOSED',
    "source" TEXT NOT NULL DEFAULT 'Teach',
    "byAi" BOOLEAN NOT NULL DEFAULT false,
    "proposedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMailSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT,
    "passwordSealed" TEXT,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "testedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiKnowledgeBook_companyId_code_key" ON "AiKnowledgeBook"("companyId", "code");

-- CreateIndex
CREATE INDEX "AiTestRun_companyId_book_createdAt_idx" ON "AiTestRun"("companyId", "book", "createdAt");

-- CreateIndex
CREATE INDEX "AiChatMessage_companyId_userId_createdAt_idx" ON "AiChatMessage"("companyId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDraft_companyId_status_createdAt_idx" ON "AiDraft"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiDraft_companyId_status_remindAt_idx" ON "AiDraft"("companyId", "status", "remindAt");

-- CreateIndex
CREATE INDEX "AiFollowUp_companyId_status_dueOn_idx" ON "AiFollowUp"("companyId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "HouseRule_companyId_status_idx" ON "HouseRule"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMailSettings_companyId_key" ON "CompanyMailSettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_aiUserId_key" ON "AiSettings"("aiUserId");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_aiUserId_fkey" FOREIGN KEY ("aiUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiKnowledgeBook" ADD CONSTRAINT "AiKnowledgeBook_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiKnowledgeBook" ADD CONSTRAINT "AiKnowledgeBook_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTestRun" ADD CONSTRAINT "AiTestRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTestRun" ADD CONSTRAINT "AiTestRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiChatMessage" ADD CONSTRAINT "AiChatMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiChatMessage" ADD CONSTRAINT "AiChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFollowUp" ADD CONSTRAINT "AiFollowUp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFollowUp" ADD CONSTRAINT "AiFollowUp_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFollowUp" ADD CONSTRAINT "AiFollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseRule" ADD CONSTRAINT "HouseRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseRule" ADD CONSTRAINT "HouseRule_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseRule" ADD CONSTRAINT "HouseRule_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMailSettings" ADD CONSTRAINT "CompanyMailSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMailSettings" ADD CONSTRAINT "CompanyMailSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

