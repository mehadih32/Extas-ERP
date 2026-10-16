-- The tech pack number counter for each company that has tech packs, continuing after
-- the tech packs numbered in the previous migration (a separate migration, so the new
-- TECH_PACK document type is committed before it is used). Adds rows only.
-- Counter (begin)
INSERT INTO "DocumentSequence" ("id", "companyId", "docType", "prefix", "nextNumber", "padding", "resetYearly", "year")
SELECT gen_random_uuid()::text, t."companyId", 'TECH_PACK'::"DocumentType", 'TP', COUNT(*) + 1, 5, true, y."year"
FROM (
  SELECT "companyId", MAX(EXTRACT(YEAR FROM "createdAt"))::int AS "year" FROM "TechPack" GROUP BY "companyId"
) y
JOIN "TechPack" t ON t."companyId" = y."companyId" AND EXTRACT(YEAR FROM t."createdAt")::int = y."year"
GROUP BY t."companyId", y."year"
ON CONFLICT ("companyId", "docType") DO NOTHING;
-- Counter (end)
