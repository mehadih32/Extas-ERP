-- Inward batches (lots) for finished goods, and SKUs taken off a style's matrix.
-- Additive only: nothing existing changes meaning.
--   * Every inward batch (opening stock, a delivery from production) becomes a
--     numbered StockLot for one style and warehouse; the movements name their lot.
--     Batches already received are given lots below, numbered by year in the
--     order they came in.
--   * A SKU taken off its style's matrix (its colour or size unticked with no
--     stock left) keeps its history and is marked removed.
--   * A new kind of numbered document, the lot number (its counter is set in the
--     next migration, once the new value is committed).

-- CreateEnum
CREATE TYPE "StockLotSource" AS ENUM ('OPENING', 'PRODUCTION');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'STOCK_LOT';

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "removedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "lotId" TEXT;

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "source" "StockLotSource" NOT NULL,
    "intakeId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockLot_styleId_createdAt_idx" ON "StockLot"("styleId", "createdAt");

-- CreateIndex
CREATE INDEX "StockLot_intakeId_idx" ON "StockLot"("intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_companyId_number_key" ON "StockLot"("companyId", "number");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_idx" ON "StockMovement"("lotId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "StockIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: the inward movements already recorded, grouped into batches. A
-- delivery from production is one batch per style and warehouse; opening stock
-- is one batch per style, warehouse, person and minute it was entered.
CREATE TEMP TABLE "_inward" ON COMMIT DROP AS
SELECT sm.id AS "movementId", sm."companyId", sm."warehouseId", pv."styleId", sm."createdAt",
       sm."createdById", sm.type::text AS type,
       CASE WHEN sm.type IN ('PRODUCTION_IN', 'PRODUCTION_REVERSAL') THEN 'P:' || sm."referenceId"
            ELSE 'O:' || COALESCE(sm."createdById", '-') || ':' || to_char(date_trunc('minute', sm."createdAt"), 'YYYYMMDDHH24MI')
       END AS batch
FROM "StockMovement" sm
JOIN "ProductVariant" pv ON pv.id = sm."variantId"
WHERE (sm.type IN ('PRODUCTION_IN', 'PRODUCTION_REVERSAL') AND sm."referenceType" = 'StockIntake' AND sm."referenceId" IS NOT NULL)
   OR (sm.type = 'OPENING' AND sm.quantity > 0);

CREATE TEMP TABLE "_lots" ON COMMIT DROP AS
SELECT gen_random_uuid()::text AS id, g.*,
       ROW_NUMBER() OVER (
         PARTITION BY g."companyId", EXTRACT(YEAR FROM g."createdAt")
         ORDER BY g."createdAt", g."styleId", g."warehouseId", g.batch
       ) AS n
FROM (
  SELECT "companyId", "styleId", "warehouseId", batch,
         MIN("createdAt") AS "createdAt", MIN("createdById") AS "createdById"
  FROM "_inward"
  WHERE type IN ('PRODUCTION_IN', 'OPENING')
  GROUP BY "companyId", "styleId", "warehouseId", batch
) g;

INSERT INTO "StockLot" ("id", "companyId", "number", "styleId", "warehouseId", "source", "intakeId", "createdById", "createdAt")
SELECT l.id, l."companyId",
       'LOT-' || EXTRACT(YEAR FROM l."createdAt")::int || '-' || lpad(l.n::text, 5, '0'),
       l."styleId", l."warehouseId",
       (CASE WHEN l.batch LIKE 'P:%' THEN 'PRODUCTION' ELSE 'OPENING' END)::"StockLotSource",
       si.id, l."createdById", l."createdAt"
FROM "_lots" l
LEFT JOIN "StockIntake" si ON l.batch LIKE 'P:%' AND si.id = substr(l.batch, 3);

UPDATE "StockMovement" sm
SET "lotId" = l.id
FROM "_inward" i
JOIN "_lots" l ON l."companyId" = i."companyId" AND l."styleId" = i."styleId"
  AND l."warehouseId" = i."warehouseId" AND l.batch = i.batch
WHERE sm.id = i."movementId";
