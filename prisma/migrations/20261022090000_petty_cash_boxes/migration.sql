-- Accounts overhaul 3: petty cash boxes, each on its own cash ledger account.
-- Additive only: a new table; no existing table or row changes.
-- CreateTable
CREATE TABLE "PettyCashBox" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "float" DECIMAL(14,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashBox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashBox_ledgerAccountId_key" ON "PettyCashBox"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "PettyCashBox_holderId_idx" ON "PettyCashBox"("holderId");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashBox_companyId_name_key" ON "PettyCashBox"("companyId", "name");

-- AddForeignKey
ALTER TABLE "PettyCashBox" ADD CONSTRAINT "PettyCashBox_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashBox" ADD CONSTRAINT "PettyCashBox_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashBox" ADD CONSTRAINT "PettyCashBox_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

