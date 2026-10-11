-- Sales overhaul 4: quotation and proforma. All additive; existing rows keep working unchanged.
--   QuotationItem.gsm            fabric weight in grams per square metre
--   QuotationItem.sizeRatio      free text, e.g. "1:2:2:1"
--   QuotationItem.accessories    trims, labels, buttons and packing notes
--   QuotationItem.imageId        a reference picture (JPEG or PNG), printed on the PDFs
--   ProformaInvoice.buyerPoNumber  the buyer's purchase order number
--   ProformaInvoice.validUntil     the last day of the PI's offer (a calendar day)
--   ProformaInvoice.bankAccountId  the account printed as bank details

-- AlterTable
ALTER TABLE "ProformaInvoice" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "buyerPoNumber" TEXT,
ADD COLUMN     "validUntil" DATE;

-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "accessories" TEXT,
ADD COLUMN     "gsm" INTEGER,
ADD COLUMN     "imageId" TEXT,
ADD COLUMN     "sizeRatio" TEXT;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProformaInvoice" ADD CONSTRAINT "ProformaInvoice_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
