"use client";

import { MessageCircleIcon } from "lucide-react";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { IntegrationPendingButton } from "@/components/feedback/integration-pending";

/** What the sheet shows: chosen styles or a whole brand, in one warehouse or all. */
export type StockSheetRequest = {
  type: "STOCK_AVAILABILITY";
  styleIds?: string[];
  brandId?: string;
  warehouseId?: string;
};

/**
 * Makes the price-free stock availability sheet (the total stock per colour and
 * size on the letterhead) and offers it to open or save, with "Share to
 * WhatsApp" beside it (Integration Pending for now). Anyone who sees the stock
 * may print it, as the documents API allows with inventory.view.
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
      <IntegrationPendingButton icon={MessageCircleIcon} label="Share to WhatsApp">
        Sending the stock sheet on WhatsApp comes with the integrations, which are on hold for now.
        Until then, download the PDF and share it from your phone.
      </IntegrationPendingButton>
    </>
  );
}
