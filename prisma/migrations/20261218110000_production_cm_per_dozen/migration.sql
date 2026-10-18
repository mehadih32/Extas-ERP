-- The factory CM can be agreed per piece or per dozen (CLAUDE.md section 3). Additive:
-- every existing agreement stays per piece, exactly as before.
ALTER TABLE "ProductionProject" ADD COLUMN "cmPer" "CmPer" NOT NULL DEFAULT 'PIECE';
ALTER TABLE "ProductionProject" ADD COLUMN "cmPerDozen" DECIMAL(14,2);
