"use client";

import { BanknoteIcon, FileXIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import type { InvoiceScreen } from "@/modules/sales/screens.service";
import { voidInvoiceAction } from "@/server/actions/sales.actions";

import { FormDialog, readReason, ReasonField, ReceivePaymentDialog } from "./dialogs";

type Open = "receive" | "void" | null;

/**
 * What can be done with an invoice, from the flags the screen came with
 * (screen.can): Accounts receives a payment against its order;
 * sales.invoice.edit voids it. Everyone who sees it can print it.
 */
export function InvoiceActions({
  screen,
  currency,
  today,
}: {
  screen: InvoiceScreen;
  currency: string;
  today: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string>();
  const { invoice: inv, can } = screen;
  const close = () => setOpen(null);

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
        <div className="flex gap-2">
          {inv.status !== "VOID" && (
            <PrintDocumentButton
              request={{ type: "COMMERCIAL_INVOICE", id: inv.id }}
              label="PDF"
              className="flex-1 sm:flex-none"
              ready={{
                eyebrow: "Commercial invoice",
                description: `${inv.number} for ${inv.buyer.name}, on the company letterhead.`,
                errorTitle: "We could not make the invoice PDF",
              }}
            />
          )}
          {can.void && (
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

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "receive" && (
        <ReceivePaymentDialog
          target={{ orderId: inv.order.id, label: inv.number }}
          due={inv.due}
          currency={currency}
          today={today}
          onDone={(message) => {
            setNotice(message);
            close();
          }}
          onClose={close}
        />
      )}
      {open === "void" && (
        <FormDialog
          title={`Void invoice ${inv.number}?`}
          description={`The buyer no longer owes it. Order ${inv.order.number} stays open, so it can be edited and invoiced again. The voided invoice stays on record.`}
          submitLabel="Void the invoice"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the invoice"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidInvoiceAction(inv.id, { reason });
            if (!result.ok) return result.error;
            setNotice(`Invoice ${inv.number} was voided.`);
            close();
          }}
        >
          {(fieldError) => <ReasonField id="void-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
