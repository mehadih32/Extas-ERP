-- Leads (Sales > Leads, phase 1): leads, their contacts, history (added only), samples,
-- files, sources, the lead check rules and the "Do not contact" list; a reminder kind for
-- lead follow-ups. Additive only.
-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'IN_TALKS', 'SAMPLING', 'QUOTED', 'WON', 'LOST', 'NURTURE');

-- CreateEnum
CREATE TYPE "LeadCategory" AS ENUM ('BRAND', 'IMPORTER', 'WHOLESALER', 'SOURCING_AGENT', 'RETAIL_CHAIN', 'CORPORATE_UNIFORM', 'PROMOTIONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadSourceKind" AS ENUM ('TRADE_FAIR', 'REFERRAL', 'SHIPMENT_DATA', 'LINKEDIN', 'WEBSITE', 'MARKETPLACE', 'COLD_RESEARCH', 'EXISTING_NETWORK', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadActivityKind" AS ENUM ('NOTE', 'CALL', 'MEETING', 'FAIR_MEETING', 'EMAIL_OUT', 'EMAIL_IN', 'WHATSAPP', 'SAMPLE', 'STAGE', 'ASSIGN', 'NEXT_STEP', 'CONTACT', 'FILE', 'CONVERT', 'ERASE', 'EDIT');

-- CreateEnum
CREATE TYPE "LeadNextKind" AS ENUM ('EMAIL', 'CALL', 'MEETING', 'SAMPLE', 'QUOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadSampleStatus" AS ENUM ('REQUESTED', 'IN_MAKING', 'DISPATCHED', 'FEEDBACK', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeadSuppressionKind" AS ENUM ('EMAIL', 'DOMAIN', 'PHONE');

-- CreateEnum
CREATE TYPE "LeadSuppressionReason" AS ENUM ('ASKED', 'ERASED', 'OWNER');

-- AlterEnum
ALTER TYPE "ReminderType" ADD VALUE 'LEAD_FOLLOW_UP';

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "websiteDomain" TEXT,
    "country" TEXT,
    "city" TEXT,
    "category" "LeadCategory" NOT NULL DEFAULT 'OTHER',
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "piecesPerStyle" INTEGER,
    "targetPrice" DECIMAL(14,2),
    "expectedValue" DECIMAL(14,2),
    "paymentTerms" "TradePayment",
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" TEXT,
    "sourceId" TEXT,
    "sourceNote" TEXT,
    "nextActionOn" DATE,
    "nextActionKind" "LeadNextKind",
    "nextActionNote" TEXT,
    "lostReason" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "partyId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "email" TEXT,
    "emailDomain" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "erasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contactId" TEXT,
    "kind" "LeadActivityKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "body" TEXT,
    "fromStage" "LeadStage",
    "toStage" "LeadStage",
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSample" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER,
    "status" "LeadSampleStatus" NOT NULL DEFAULT 'REQUESTED',
    "courier" TEXT,
    "trackingNo" TEXT,
    "sentOn" DATE,
    "feedback" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LeadSourceKind" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "targetCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "riskyCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productFocus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minPieces" INTEGER,
    "priceMin" DECIMAL(14,2),
    "priceMax" DECIMAL(14,2),
    "followUpDays" INTEGER NOT NULL DEFAULT 7,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSuppression" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "LeadSuppressionKind" NOT NULL,
    "valueHash" TEXT NOT NULL,
    "valueHint" TEXT NOT NULL,
    "reason" "LeadSuppressionReason" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_partyId_key" ON "Lead"("partyId");

-- CreateIndex
CREATE INDEX "Lead_companyId_stage_nextActionOn_idx" ON "Lead"("companyId", "stage", "nextActionOn");

-- CreateIndex
CREATE INDEX "Lead_companyId_ownerUserId_idx" ON "Lead"("companyId", "ownerUserId");

-- CreateIndex
CREATE INDEX "Lead_companyId_websiteDomain_idx" ON "Lead"("companyId", "websiteDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_companyId_number_key" ON "Lead"("companyId", "number");

-- CreateIndex
CREATE INDEX "LeadContact_companyId_email_idx" ON "LeadContact"("companyId", "email");

-- CreateIndex
CREATE INDEX "LeadContact_companyId_emailDomain_idx" ON "LeadContact"("companyId", "emailDomain");

-- CreateIndex
CREATE INDEX "LeadContact_leadId_idx" ON "LeadContact"("leadId");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_occurredAt_idx" ON "LeadActivity"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadActivity_companyId_kind_occurredAt_idx" ON "LeadActivity"("companyId", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadSample_leadId_idx" ON "LeadSample"("leadId");

-- CreateIndex
CREATE INDEX "LeadFile_leadId_idx" ON "LeadFile"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_companyId_name_key" ON "LeadSource"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSettings_companyId_key" ON "LeadSettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSuppression_companyId_kind_valueHash_key" ON "LeadSuppression"("companyId", "kind", "valueHash");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "LeadContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSample" ADD CONSTRAINT "LeadSample_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSample" ADD CONSTRAINT "LeadSample_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFile" ADD CONSTRAINT "LeadFile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFile" ADD CONSTRAINT "LeadFile_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFile" ADD CONSTRAINT "LeadFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSettings" ADD CONSTRAINT "LeadSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSuppression" ADD CONSTRAINT "LeadSuppression_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

