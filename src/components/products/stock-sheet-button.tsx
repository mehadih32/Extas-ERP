"use client";

import { PrintDocumentButton } from "@/components/documents/print-button";

/** What the sheet shows: chosen styles or a whole brand, in one warehouse or all. */
export type StockSheetRequest = {
  type: "STOCK_AVAILABILITY";
  styleIds?: string[];
  brandId?: string;
  warehouseId?: string;
};

/**
 * Makes the price-free stock availability sheet (pieces per colour and size on
 * the letterhead) and offers it to open or save. Anyone who sees the stock may
 * print it, as the documents API allows with inventory.view.
 */
export function StockSheetButton({
  request,
  label = "Stock sheet (PDF)",
  className,
}: {
  request: StockSheetRequest;
  label?: string;
  className?: string;
}) {
  return (
    <PrintDocumentButton
      request={request}
      label={label}
      className={className}
      ready={{
        eyebrow: "Stock sheet ready",
        description:
          "The pieces ready to ship in each colour and size, on the company letterhead. It shows no prices, so it can go straight to a buyer.",
        errorTitle: "We could not make the stock sheet",
      }}
    />
  );
}
