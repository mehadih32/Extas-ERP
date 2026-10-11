-- Sales overhaul 3: Smart Edit. Additive; existing invoices read as never revised.
--   Invoice.revision   times the invoice was edited after it was issued (0: never)
--   Invoice.revisedAt  when it was last edited

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "revisedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;
