-- One-time ("random") suppliers, the extra costs of a ready stock purchase one by one,
-- and each style's size chart (2026-10-31). Additive only.
ALTER TABLE "Party" ADD COLUMN "oneTime" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReadyStockPurchase" ADD COLUMN "extraCosts" JSONB;

CREATE TABLE "StyleSizeChart" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "garment" TEXT NOT NULL DEFAULT 'TOP',
    "unit" "MeasureUnit" NOT NULL DEFAULT 'INCH',
    "points" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StyleSizeChart_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StyleSizeChart_styleId_key" ON "StyleSizeChart"("styleId");
CREATE INDEX "StyleSizeChart_companyId_updatedAt_idx" ON "StyleSizeChart"("companyId", "updatedAt");
ALTER TABLE "StyleSizeChart" ADD CONSTRAINT "StyleSizeChart_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StyleSizeChart" ADD CONSTRAINT "StyleSizeChart_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The Report Builder's "Past 6 months" period (Production vs ready stock).
ALTER TYPE "ReportPeriod" ADD VALUE IF NOT EXISTS 'SIX_MONTHS' AFTER 'ONE_MONTH';
