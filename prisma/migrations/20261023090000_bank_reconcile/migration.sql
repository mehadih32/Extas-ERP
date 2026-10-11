-- Accounts overhaul 4: bank reconcile. A journal line can be ticked as matching the
-- real bank statement. Additive only: two optional columns, empty on every existing row.
-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "clearedAt" TIMESTAMP(3),
ADD COLUMN     "clearedById" TEXT;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
