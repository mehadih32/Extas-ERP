-- v6.4: an expert's answer and the review board's findings on a tech pack are
-- the AI's own work, so they are saved under the company's AI account (as the
-- AI drafts are); "askedById" still names the person who asked. Additive: a new
-- column that may be empty. Answers kept before are given their company's AI
-- account when it has one (nothing else changes).

-- AlterTable
ALTER TABLE "TechPackExpertAnswer" ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "TechPackExpertAnswer" ADD CONSTRAINT "TechPackExpertAnswer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill
UPDATE "TechPackExpertAnswer" AS a
SET "createdById" = s."aiUserId"
FROM "AiSettings" AS s
WHERE s."companyId" = a."companyId"
  AND s."aiUserId" IS NOT NULL
  AND a."createdById" IS NULL;
