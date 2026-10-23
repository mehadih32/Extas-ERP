"use client";

import { BanknoteIcon, FileXIcon, LockIcon, PackageXIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { UseTemplateButton } from "@/components/reports/use-template";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import type { TemplateChoice } from "@/modules/reports/screens.service";
import type { InvoiceScreen } from "@/modules/sales/screens.service";

import { salesHref } from "./labels";
import { ReceivePaymentDialog } from "./receive-payment-dialog";
import { ShareInvoiceImageButton } from "./share-invoice-image";
import { VoidInvoiceDialog } from "./void-invoice-dialog";

type Open = "receive" | "void" | null;

/**
 * What can be done with an invoice, from the flags the screen came with
 * (screen.can): Accounts receives a payment against its order; people who may
 * edit invoices edit it (Smart Edit, kept under the same number, until it is
 * fully paid) and void it (Safe Void) while no sales return stands on it;
 * Accounts records goods coming back on it (Sales return). Everyone who sees it can print it and
 * share page 1 as a picture on WhatsApp. Used on the invoice page and in the
 * invoice hub; `onChanged` runs after a payment or a void.
 */
export function InvoiceActions({
  screen,
  currency,
  today,
  templates = [],
  onChanged,
}: {
  screen: InvoiceScreen;
  currency: string;
  today: string;
  /** The company's own invoice designs this person may fill. */
  templates?: TemplateChoice[];
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string>();
  const { invoice: inv, can } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
    onChanged?.();
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.receive && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("receive")}>
            <BanknoteIcon aria-hidden />
            Receive a payment
          </Button>
        )}
        {can.share && (
          <ShareInvoiceImageButton
            invoice={{ id: inv.id, number: inv.number }}
            phone={inv.buyer.phone}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {inv.status !== "VOID" && (
            <PrintDocumentButton
              request={{ type: "COMMERCIAL_INVOICE", id: inv.id }}
              label="PDF"
              className="flex-1 sm:flex-none"
              ready={{
                eyebrow: "Commercial invoice",
                description: inv.packingList
                  ? `${inv.number} for ${inv.buyer.name}, on the company letterhead, with packing list ${inv.packingList.number} as page 2.`
                  : `${inv.number} for ${inv.buyer.name}, on the company letterhead.`,
                errorTitle: "We could not make the invoice PDF",
              }}
            />
          )}
          {inv.status !== "VOID" && (
            <UseTemplateButton
              id={inv.id}
              templates={templates}
              what={`Invoice ${inv.number}`}
              className="flex-1 sm:flex-none"
            />
          )}
          {can.edit && (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href={`${salesHref.order(inv.order.id)}/edit`}>
                <PencilIcon aria-hidden />
                Edit
              </Link>
            </Button>
          )}
          {can.makeReturn && (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href={`/sales/returns/new?invoice=${encodeURIComponent(inv.id)}`}>
                <PackageXIcon aria-hidden />
                Sales return
              </Link>
            </Button>
          )}
          {can.void && screen.voidChoice && (
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setOpen("void")}
            >
              <FileXIcon aria-hidden />
              Void
            </Button>
          )}
        </div>
      </div>

      {[screen.notes.edit, screen.notes.void].filter(Boolean).map((note) => (
        <p key={note} className="flex items-start gap-2 text-sm text-muted-foreground">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {note}
        </p>
      ))}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "receive" && (
        <ReceivePaymentDialog
          target={{ orderId: inv.order.id, label: inv.number }}
          due={inv.due}
          most={can.receiveUpTo ?? undefined}
          extraAllowed={inv.buyer.id !== null}
          currency={currency}
          today={today}
          onDone={done}
          onClose={close}
        />
      )}
      {open === "void" && screen.voidChoice && (
        <VoidInvoiceDialog
          invoice={{ id: inv.id, number: inv.number }}
          orderNumber={inv.order.number}
          choice={screen.voidChoice}
          currency={currency}
          onDone={done}
          onClose={close}
        />
      )}
    </div>
  );
}
