-- Telegram bot, WhatsApp ready (v6.2 part 9): the bot connection per store and
-- its message log. Additive only: two new tables.

-- CreateEnum
CREATE TYPE "AiBotChannel" AS ENUM ('TELEGRAM', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "AiBotDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "AiBotMessageStatus" AS ENUM ('RECEIVED', 'DONE', 'IGNORED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "AiBotLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "AiBotChannel" NOT NULL,
    "botKey" TEXT NOT NULL,
    "botName" TEXT,
    "tokenSealed" TEXT NOT NULL,
    "appSecretSealed" TEXT,
    "verifyTokenSealed" TEXT,
    "webhookKey" TEXT NOT NULL,
    "webhookError" TEXT,
    "ownerId" TEXT,
    "chatId" TEXT,
    "chatName" TEXT,
    "linkedAt" TIMESTAMP(3),
    "linkCodeHash" TEXT,
    "linkCodeUntil" TIMESTAMP(3),
    "pending" JSONB,
    "pendingUntil" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBotLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiBotMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "linkId" TEXT,
    "channel" "AiBotChannel" NOT NULL,
    "direction" "AiBotDirection" NOT NULL,
    "providerId" TEXT,
    "chatId" TEXT,
    "text" TEXT NOT NULL,
    "status" "AiBotMessageStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiBotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiBotLink_webhookKey_idx" ON "AiBotLink"("webhookKey");

-- CreateIndex
CREATE INDEX "AiBotLink_channel_botKey_idx" ON "AiBotLink"("channel", "botKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiBotLink_companyId_channel_key" ON "AiBotLink"("companyId", "channel");

-- CreateIndex
CREATE INDEX "AiBotMessage_companyId_createdAt_idx" ON "AiBotMessage"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiBotMessage_channel_providerId_key" ON "AiBotMessage"("channel", "providerId");

-- AddForeignKey
ALTER TABLE "AiBotLink" ADD CONSTRAINT "AiBotLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBotLink" ADD CONSTRAINT "AiBotLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBotLink" ADD CONSTRAINT "AiBotLink_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBotMessage" ADD CONSTRAINT "AiBotMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBotMessage" ADD CONSTRAINT "AiBotMessage_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "AiBotLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

