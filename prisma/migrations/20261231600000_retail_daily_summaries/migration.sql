-- AlterTable
ALTER TABLE "RetailStore" ADD COLUMN     "summaryAlertedOn" DATE,
ADD COLUMN     "summaryAskedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RetailDailySummary" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "incomplete" TEXT[],
    "netProfit" DECIMAL(14,2) NOT NULL,
    "checkedProfit" DECIMAL(14,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailFixedCost" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "utilities" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailFixedCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailBudget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "ads" DECIMAL(14,2),
    "packaging" DECIMAL(14,2),
    "delivery" DECIMAL(14,2),
    "salary" DECIMAL(14,2),
    "other" DECIMAL(14,2),
    "alerted" TEXT[],
    "setById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailTarget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sales" DECIMAL(14,2) NOT NULL,
    "setById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetailDailySummary_companyId_date_idx" ON "RetailDailySummary"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RetailDailySummary_storeId_date_version_key" ON "RetailDailySummary"("storeId", "date", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RetailFixedCost_storeId_month_version_key" ON "RetailFixedCost"("storeId", "month", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RetailBudget_storeId_month_key" ON "RetailBudget"("storeId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "RetailTarget_storeId_month_key" ON "RetailTarget"("storeId", "month");

-- AddForeignKey
ALTER TABLE "RetailDailySummary" ADD CONSTRAINT "RetailDailySummary_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailDailySummary" ADD CONSTRAINT "RetailDailySummary_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailFixedCost" ADD CONSTRAINT "RetailFixedCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailFixedCost" ADD CONSTRAINT "RetailFixedCost_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailBudget" ADD CONSTRAINT "RetailBudget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailBudget" ADD CONSTRAINT "RetailBudget_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailTarget" ADD CONSTRAINT "RetailTarget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailTarget" ADD CONSTRAINT "RetailTarget_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

