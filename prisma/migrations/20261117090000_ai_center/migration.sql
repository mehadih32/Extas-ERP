-- CreateEnum
CREATE TYPE "AiCellState" AS ENUM ('DO', 'ASK', 'OFF');

-- CreateEnum
CREATE TYPE "AiGrantScope" AS ENUM ('ONCE', 'TODAY', 'RECORD', 'UNTIL');

-- CreateEnum
CREATE TYPE "AiChannel" AS ENUM ('ERP', 'BOT');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('PENDING', 'ONCE', 'TODAY', 'ALWAYS', 'REFUSED');

-- CreateEnum
CREATE TYPE "AiDeletionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AppModule" ADD VALUE 'AI';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "byAi" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "changedAt" TIMESTAMP(3),
    "changedById" TEXT,
    "pausedAt" TIMESTAMP(3),
    "apiKeySealed" TEXT,
    "apiKeyHint" TEXT,
    "apiKeySetAt" TIMESTAMP(3),
    "models" JSONB,
    "allowFable" BOOLEAN NOT NULL DEFAULT false,
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "assistantName" TEXT NOT NULL DEFAULT 'Mehedi 2.0',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiControlCell" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "state" "AiCellState" NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiControlCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGrant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "scope" "AiGrantScope" NOT NULL,
    "recordType" TEXT,
    "recordId" TEXT,
    "recordLabel" TEXT,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "requestId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPermissionRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "why" TEXT,
    "recordType" TEXT,
    "recordId" TEXT,
    "recordLabel" TEXT,
    "channel" "AiChannel" NOT NULL DEFAULT 'ERP',
    "askedBy" TEXT NOT NULL,
    "status" "AiRequestStatus" NOT NULL DEFAULT 'PENDING',
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPermissionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDeletionRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "href" TEXT,
    "why" TEXT NOT NULL,
    "ifKept" TEXT NOT NULL,
    "channel" "AiChannel" NOT NULL DEFAULT 'ERP',
    "askedBy" TEXT NOT NULL,
    "status" "AiDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "note" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_companyId_key" ON "AiSettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AiControlCell_companyId_node_key" ON "AiControlCell"("companyId", "node");

-- CreateIndex
CREATE INDEX "AiGrant_companyId_expiresAt_idx" ON "AiGrant"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "AiPermissionRequest_companyId_status_createdAt_idx" ON "AiPermissionRequest"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiDeletionRequest_companyId_status_createdAt_idx" ON "AiDeletionRequest"("companyId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiControlCell" ADD CONSTRAINT "AiControlCell_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiControlCell" ADD CONSTRAINT "AiControlCell_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGrant" ADD CONSTRAINT "AiGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGrant" ADD CONSTRAINT "AiGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPermissionRequest" ADD CONSTRAINT "AiPermissionRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPermissionRequest" ADD CONSTRAINT "AiPermissionRequest_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDeletionRequest" ADD CONSTRAINT "AiDeletionRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDeletionRequest" ADD CONSTRAINT "AiDeletionRequest_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

