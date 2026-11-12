-- Release 2: sending documents to buyers (email, WhatsApp links; every send logged) and
-- follow-up reminders that work without the AI. Additive only.

-- CreateEnum
CREATE TYPE "DocumentSendChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'SHARE');

-- CreateEnum
CREATE TYPE "DocumentSendStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "FollowUpKind" AS ENUM ('MANUAL', 'QUOTATION_EXPIRY', 'PAYMENT_DUE', 'PROMISED_PAYMENT');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'DONE');

-- AlterEnum


ALTER TYPE "ReminderType" ADD VALUE 'QUOTATION_EXPIRY';
ALTER TYPE "ReminderType" ADD VALUE 'PROMISED_PAYMENT';
ALTER TYPE "ReminderType" ADD VALUE 'FOLLOW_UP';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "documentLinkDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "promiseNote" TEXT,
ADD COLUMN     "promisedPayOn" DATE;

-- CreateTable
CREATE TABLE "DocumentSend" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "DocumentSendChannel" NOT NULL,
    "status" "DocumentSendStatus" NOT NULL DEFAULT 'SENT',
    "documentType" "DocumentType" NOT NULL,
    "documentId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "partyId" TEXT,
    "title" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT,
    "error" TEXT,
    "linkId" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "documentId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "partyId" TEXT,
    "title" TEXT NOT NULL,
    "fileId" TEXT,
    "fileName" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "stoppedById" TEXT,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "FollowUpKind" NOT NULL DEFAULT 'MANUAL',
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "sourceKey" TEXT,
    "partyId" TEXT,
    "quotationId" TEXT,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "dueOn" DATE NOT NULL,
    "snoozedUntil" DATE,
    "note" TEXT,
    "createdById" TEXT,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentSend_companyId_referenceId_idx" ON "DocumentSend"("companyId", "referenceId");

-- CreateIndex
CREATE INDEX "DocumentSend_companyId_partyId_createdAt_idx" ON "DocumentSend"("companyId", "partyId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentSend_companyId_createdAt_idx" ON "DocumentSend"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLink_tokenHash_key" ON "DocumentLink"("tokenHash");

-- CreateIndex
CREATE INDEX "DocumentLink_companyId_referenceId_idx" ON "DocumentLink"("companyId", "referenceId");

-- CreateIndex
CREATE INDEX "DocumentLink_companyId_partyId_idx" ON "DocumentLink"("companyId", "partyId");

-- CreateIndex
CREATE INDEX "FollowUp_companyId_status_dueOn_idx" ON "FollowUp"("companyId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "FollowUp_companyId_partyId_idx" ON "FollowUp"("companyId", "partyId");

-- CreateIndex
CREATE INDEX "FollowUp_companyId_quotationId_idx" ON "FollowUp"("companyId", "quotationId");

-- CreateIndex
CREATE INDEX "FollowUp_companyId_orderId_idx" ON "FollowUp"("companyId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_companyId_sourceKey_key" ON "FollowUp"("companyId", "sourceKey");

-- AddForeignKey
ALTER TABLE "DocumentSend" ADD CONSTRAINT "DocumentSend_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The right to send documents to buyers (Sales > "Send documents to buyers").
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'documents.send', 'SALES',
   'Send quotations, invoices, statements, stock sheets and packing lists to buyers by email or WhatsApp (only when the person presses Send)')
ON CONFLICT ("key") DO NOTHING;

-- Every role that makes quotations may send documents to buyers.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM "RolePermission" rp
JOIN "Permission" op ON op."id" = rp."permissionId" AND op."key" = 'sales.quotation.manage'
CROSS JOIN "Permission" np
WHERE np."key" = 'documents.send'
ON CONFLICT DO NOTHING;
