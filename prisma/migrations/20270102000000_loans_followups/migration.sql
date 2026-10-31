-- Loans follow-ups: interest or profit paid before the ERP, and the term-end reminder mark.
ALTER TABLE "CapitalSource" ADD COLUMN "interestPaidBefore" DECIMAL(14,2);
ALTER TABLE "CapitalInstallment" ADD COLUMN "remindedAt" TIMESTAMP(3);
