-- Production overhaul 4: a completed project's pieces all cost the same.
-- Additive only: existing delivery lines keep their cost, with no adjustment.
ALTER TABLE "StockIntakeLine" ADD COLUMN "costAdjustment" DECIMAL(14,4) NOT NULL DEFAULT 0;
