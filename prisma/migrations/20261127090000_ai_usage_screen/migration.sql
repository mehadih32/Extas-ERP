-- Where in the ERP each AI call was asked (Budget & Costs "By place"). Old lines keep null.
ALTER TABLE "AiUsage" ADD COLUMN     "screen" TEXT;
