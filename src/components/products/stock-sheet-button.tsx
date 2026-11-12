"use client";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { SendDocumentButtons } from "@/components/documents/send-buttons";

/** What the sheet shows: chosen styles or a whole brand, in one warehouse or all. */
export type StockSheetRequest = {
  type: "STOCK_AVAILABILITY";
  styleIds?: string[];
  brandId?: string;
  warehouseId?: string;
};

/**
 * Makes the price-free stock availability sheet (the total stock per colour and
 * size on the letterhead) and offers it to open or save. Anyone who sees the
 * stock may print it, as the documents API allows with inventory.view. People
 * who may send documents to buyers (`sendAs`, the company's name) also get
 * "Send by email" and "Send on WhatsApp" (the buyer's address is typed in).
 */
export function StockSheetButton({
  request,
  label = "Stock sheet (PDF)",
  className,
  sendAs,
}: {
  request: StockSheetRequest;
  label?: string;
  className?: string;
  /** The company's name, when this person may send the sheet to a buyer. */
  sendAs?: string | null;
}) {
  return (
    <>
      <PrintDocumentButton
        request={request}
        label={label}
        className={className}
        ready={{
          eyebrow: "Stock sheet ready",
          description:
            "The total stock in each colour and size (good and B-grade pieces together), on the company letterhead. It shows no prices, so it can go straight to a buyer.",
          errorTitle: "We could not make the stock sheet",
        }}
      />
      {sendAs && (
        <SendDocumentButtons request={request} what="the stock sheet" companyName={sendAs} />
      )}
    </>
  );
}
