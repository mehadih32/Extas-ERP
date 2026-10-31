-- Loans & capital page (lenders, kept-in-capital loans, installments paid by themselves, a
-- person's renewable terms) and monthly fixed costs. Additive only.
-- CreateEnum
CREATE TYPE "CapitalLenderKind" AS ENUM ('BANK', 'NGO', 'PERSON');

-- AlterTable
ALTER TABLE "CapitalSource" ADD COLUMN     "autoPay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoPayAccountId" TEXT,
ADD COLUMN     "autoPayById" TEXT,
ADD COLUMN     "autoPayMethod" "PaymentMethod",
ADD COLUMN     "keepInCapital" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "keptInCapitalFrom" TIMESTAMP(3),
ADD COLUMN     "lenderId" TEXT,
ADD COLUMN     "periodMonths" INTEGER,
ADD COLUMN     "profitPerPeriod" DECIMAL(14,2),
ADD COLUMN     "renewals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "takenAmount" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "CapitalLender" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "CapitalLenderKind" NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalLender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "accountId" TEXT,
    "startMonth" TEXT NOT NULL,
    "lastPostedMonth" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CapitalLender_companyId_kind_name_key" ON "CapitalLender"("companyId", "kind", "name");

-- CreateIndex
CREATE INDEX "RecurringExpense_companyId_isActive_idx" ON "RecurringExpense"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "CapitalSource_lenderId_idx" ON "CapitalSource"("lenderId");

-- AddForeignKey
ALTER TABLE "CapitalSource" ADD CONSTRAINT "CapitalSource_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "CapitalLender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalLender" ADD CONSTRAINT "CapitalLender_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_headId_fkey" FOREIGN KEY ("headId") REFERENCES "ExpenseHead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

