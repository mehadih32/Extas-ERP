"use client";

import { FileDownIcon, LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { printDocumentAction } from "@/server/actions/documents.actions";

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
  const [pending, startTransition] = useTransition();
  const [ready, setReady] = useState<{ id: string; title: string }>();
  const [error, setError] = useState<ActionError>();

  function print() {
    startTransition(async () => {
      const result = await printDocumentAction(request);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReady({ id: result.data.id, title: result.data.title });
    });
  }

  const download = ready ? `/api/documents/${encodeURIComponent(ready.id)}/download` : "";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        disabled={pending}
        onClick={print}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : (
          <FileDownIcon aria-hidden />
        )}
        {pending ? "Making the PDF" : label}
      </Button>
      {ready && (
        <Dialog open onOpenChange={(open) => !open && setReady(undefined)}>
          <DialogContent>
            <DialogHeader>
              <p className="eyebrow text-primary">Stock sheet ready</p>
              <DialogTitle>{ready.title}</DialogTitle>
              <DialogDescription>
                The pieces ready to ship in each colour and size, on the company letterhead. It
                shows no prices, so it can go straight to a buyer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button asChild variant="outline">
                <a href={download} download>
                  Download
                </a>
              </Button>
              <Button asChild>
                <a href={`${download}?inline=1`} target="_blank" rel="noopener">
                  Open the PDF
                </a>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ActionErrorDialog
        error={error}
        title="We could not make the stock sheet"
        onClose={() => setError(undefined)}
      />
    </>
  );
}
