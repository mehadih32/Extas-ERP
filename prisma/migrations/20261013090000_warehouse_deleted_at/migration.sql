-- A deleted warehouse is kept (its stock movements, lots and documents still name
-- it) but leaves every list and picker.
ALTER TABLE "Warehouse" ADD COLUMN "deletedAt" TIMESTAMP(3);
