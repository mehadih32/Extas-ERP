-- B-grade lines for the shops (2026-11-11): a style's own B-grade price.
ALTER TABLE "Style" ADD COLUMN IF NOT EXISTS "bGradePrice" DECIMAL(14,2);

-- B-grade shop lines: which stock (A or B grade) an order line takes its pieces from.
ALTER TABLE "SalesOrderItem" ADD COLUMN IF NOT EXISTS "grade" "StockGrade" NOT NULL DEFAULT 'A_GRADE';
