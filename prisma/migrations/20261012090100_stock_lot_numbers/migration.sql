-- The lot number counter for each company that has lots, continuing after the
-- batches numbered in the previous migration (a separate migration, so the new
-- STOCK_LOT document type is committed before it is used).
INSERT INTO "DocumentSequence" ("id", "companyId", "docType", "prefix", "nextNumber", "padding", "resetYearly", "year")
SELECT gen_random_uuid()::text, l."companyId", 'STOCK_LOT'::"DocumentType", 'LOT', COUNT(*) + 1, 5, true, y.year
FROM (
  SELECT "companyId", MAX(EXTRACT(YEAR FROM "createdAt"))::int AS year FROM "StockLot" GROUP BY "companyId"
) y
JOIN "StockLot" l ON l."companyId" = y."companyId" AND EXTRACT(YEAR FROM l."createdAt")::int = y.year
GROUP BY l."companyId", y.year
ON CONFLICT ("companyId", "docType") DO NOTHING;
