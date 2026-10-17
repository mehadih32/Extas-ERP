-- Tech Pack as its own module (v6.4). Additive only: nothing existing is lost or changes meaning.
--   * A tech pack can now start from a buyer's brief, before any order or production
--     project exists: its project link becomes optional (still one tech pack per
--     project), and it gets its own number, title, buyer, catalogue style, season,
--     the buyer's brief and who started it.
--   * Every tech pack made so far keeps all its data and its project, and is filled
--     in below: its buyer and style from its project, its title from the project's
--     name, and a number in the order they were made (per company and year).
--   * A tech pack is its own document now: if its project were ever removed it stays,
--     unlinked (the project link is set to empty instead of taking the tech pack with it).
--   * A new kind of numbered document, the tech pack (TP-2026-00001); its counter is set
--     in the next migration, once the new value is committed.

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'TECH_PACK';

-- DropForeignKey (added again below, keeping the tech pack when its project goes)
ALTER TABLE "TechPack" DROP CONSTRAINT "TechPack_projectId_fkey";

-- AlterTable
ALTER TABLE "TechPack" ADD COLUMN     "brief" TEXT,
ADD COLUMN     "buyerId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "season" TEXT,
ADD COLUMN     "styleId" TEXT,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "projectId" DROP NOT NULL;

-- Backfill (begin): the tech packs made so far, from their projects.
UPDATE "TechPack" t
SET "buyerId" = COALESCE(t."buyerId", p."buyerId"),
    "styleId" = COALESCE(t."styleId", p."styleId"),
    "title" = CASE WHEN t."title" <> '' THEN t."title" ELSE COALESCE(NULLIF(p."name", ''), NULLIF(s."name", ''), p."code") END
FROM "ProductionProject" p
LEFT JOIN "Style" s ON s."id" = p."styleId"
WHERE p."id" = t."projectId";

UPDATE "TechPack" t
SET "number" = 'TP-' || n."year" || '-' || CASE
    WHEN length(n."serial"::text) >= 5 THEN n."serial"::text
    ELSE lpad(n."serial"::text, 5, '0')
  END
FROM (
  SELECT "id",
    EXTRACT(YEAR FROM "createdAt")::int AS "year",
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", EXTRACT(YEAR FROM "createdAt")
      ORDER BY "createdAt", "id"
    ) AS "serial"
  FROM "TechPack"
) n
WHERE n."id" = t."id" AND t."number" IS NULL;
-- Backfill (end)

-- CreateIndex
CREATE INDEX "TechPack_companyId_updatedAt_idx" ON "TechPack"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "TechPack_companyId_buyerId_idx" ON "TechPack"("companyId", "buyerId");

-- CreateIndex
CREATE INDEX "TechPack_companyId_styleId_idx" ON "TechPack"("companyId", "styleId");

-- CreateIndex
CREATE INDEX "TechPack_companyId_season_idx" ON "TechPack"("companyId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "TechPack_companyId_number_key" ON "TechPack"("companyId", "number");

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPack" ADD CONSTRAINT "TechPack_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
