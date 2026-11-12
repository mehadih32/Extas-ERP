-- T&A calendar: the company T&A template, its settings and each order's own steps.
-- Additive only: new enums and tables, nothing dropped or changed.

-- CreateEnum
CREATE TYPE "TaFact" AS ENUM ('TECH_PACK_APPROVED', 'BOOKING_APPROVED', 'FABRIC_IN_HOUSE', 'CUTTING_STARTED', 'SEWING_DONE', 'PACKED', 'SHIPPED');

-- CreateEnum
CREATE TYPE "TaDoneHow" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "TaTemplateStep" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysBeforeShip" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "fact" "TaFact",
    "critical" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dueSoonDays" INTEGER NOT NULL DEFAULT 3,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTaStep" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fact" "TaFact",
    "critical" BOOLEAN NOT NULL DEFAULT true,
    "daysBeforeShip" INTEGER NOT NULL,
    "plannedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "dueChanged" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneOn" DATE,
    "doneHow" "TaDoneHow",
    "doneById" TEXT,
    "lateNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTaStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaTemplateStep_companyId_position_idx" ON "TaTemplateStep"("companyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TaTemplateStep_companyId_key_key" ON "TaTemplateStep"("companyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TaSettings_companyId_key" ON "TaSettings"("companyId");

-- CreateIndex
CREATE INDEX "OrderTaStep_companyId_dueOn_idx" ON "OrderTaStep"("companyId", "dueOn");

-- CreateIndex
CREATE INDEX "OrderTaStep_companyId_doneAt_idx" ON "OrderTaStep"("companyId", "doneAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTaStep_salesOrderId_key_key" ON "OrderTaStep"("salesOrderId", "key");

-- AddForeignKey
ALTER TABLE "TaTemplateStep" ADD CONSTRAINT "TaTemplateStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaSettings" ADD CONSTRAINT "TaSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTaStep" ADD CONSTRAINT "OrderTaStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTaStep" ADD CONSTRAINT "OrderTaStep_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTaStep" ADD CONSTRAINT "OrderTaStep_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

