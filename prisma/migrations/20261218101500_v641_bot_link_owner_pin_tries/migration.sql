-- v6.4.1: pressing "Link" on AI Center > Bot no longer moves the bot to the
-- person who pressed it: who asked for the code is kept apart, and becomes the
-- bot's owner only when the code is sent from their chat. PIN tries (wrong PINs,
-- and the numbers the bot checks to hide a PIN typed by mistake) are counted in
-- the database, so a restart does not start the count again; only counts and
-- times are kept, never a PIN. Additive: one column that may be empty and one
-- new table.

-- AlterTable
ALTER TABLE "AiBotLink" ADD COLUMN     "linkCodeOwnerId" TEXT;

-- CreateTable
CREATE TABLE "AiPinTry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 0,
    "alarmedAt" TIMESTAMP(3),

    CONSTRAINT "AiPinTry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiPinTry_companyId_subjectKey_kind_key" ON "AiPinTry"("companyId", "subjectKey", "kind");

-- AddForeignKey
ALTER TABLE "AiBotLink" ADD CONSTRAINT "AiBotLink_linkCodeOwnerId_fkey" FOREIGN KEY ("linkCodeOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPinTry" ADD CONSTRAINT "AiPinTry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

