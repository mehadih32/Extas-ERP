-- B-grade lines for the shops (2026-11-11): a style's own B-grade price.
ALTER TABLE "Style" ADD COLUMN IF NOT EXISTS "bGradePrice" DECIMAL(14,2);
