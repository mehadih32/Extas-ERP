"use client";

import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/feedback/toaster";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatCount, formatDay } from "@/lib/display";
import type { InvoiceScreen } from "@/modules/sales/screens.service";
import { getInvoiceScreenAction } from "@/server/actions/sales.actions";

import { InvoiceBadge, RevisedBadge } from "./badges";
import { Fact, Totals } from "./detail-bits";
import { InvoiceActions } from "./invoice-actions";
import { invoiceTotalLines } from "./invoice-totals";
import { METHOD_LABELS, money, salesHref } from "./labels";

/**
 * The invoice hub: a slide-out panel over the invoice list with the invoice's
 * state and everything that can be done with it (receive, PDF, share page 1 on
 * WhatsApp, edit, void), so nobody has to leave the list. Loads when opened and
 * again after a payment or a void; `onChanged` gives the list the new state.
 */
export function InvoiceHub({
  invoiceId,
  currency,
  today,
  onChanged,
  onClose,
}: {
  invoiceId: string;
  currency: string;
  today: string;
  onChanged?: (invoice: InvoiceScreen["invoice"]) => void;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState<InvoiceScreen | null>(null);
  const [failed, setFailed] = useState<string>();

  const load = useCallback(
    (after?: (screen: InvoiceScreen) => void) =>
      getInvoiceScreenAction(invoiceId)
        .then((result) => {
          if (result.ok) {
            setScreen(result.data);
            after?.(result.data);
          } else {
            setFailed(result.error.message);
            toast.error(result.error.message);
          }
        })
        .catch(() => {
          const message = "The invoice could not load. Check the connection and try again.";
          setFailed(message);
          toast.error(message);
        }),
    [invoiceId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent aria-describedby={undefined} className="gap-6 p-5 sm:max-w-lg sm:p-6">
        {!screen ? (
          <>
            <SheetTitle className="font-serif text-xl text-primary">Invoice</SheetTitle>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {failed ?? (
                <>
                  <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
                  Loading the invoice
                </>
              )}
            </p>
          </>
        ) : (
          <HubBody
            screen={screen}
            currency={currency}
            today={today}
            onChanged={() => void load((next) => onChanged?.(next.invoice))}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function HubBody({
  screen,
  currency,
  today,
  onChanged,
}: {
  screen: InvoiceScreen;
  currency: string;
  today: string;
  onChanged: () => void;
}) {
  const { invoice: inv } = screen;
  return (
    <>
      <div className="pr-8">
        <p className="eyebrow">
          Invoice · {formatDay(inv.issuedOn)}
          {inv.revisedOn ? ` · revised ${formatDay(inv.revisedOn)}` : ""}
        </p>
        <SheetTitle className="mt-2 font-serif text-[1.5rem] leading-tight text-primary">
          {inv.number}
        </SheetTitle>
        <SheetDescription className="mt-1 text-sm break-words">{inv.buyer.name}</SheetDescription>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <InvoiceBadge status={inv.status} isOverdue={inv.isOverdue} />
          <RevisedBadge revision={inv.revision} />
        </div>
      </div>

      <InvoiceActions screen={screen} currency={currency} today={today} onChanged={onChanged} />

      <dl className="grid grid-cols-2 gap-4">
        <Fact label="Order">
          <Link
            href={salesHref.order(inv.order.id)}
            className="text-primary underline-offset-4 hover:underline"
          >
            {inv.order.number}
          </Link>
        </Fact>
        <Fact label="Due day">{inv.dueOn ? formatDay(inv.dueOn) : "On receipt"}</Fact>
        <Fact label="Pieces">
          {formatCount(inv.pieces, currency)}
          {inv.delivered > 0 ? ` · ${formatCount(inv.delivered, currency)} delivered` : ""}
        </Fact>
        {inv.buyer.phone && <Fact label="Phone">{inv.buyer.phone}</Fact>}
        <Fact label="Packing list" className="col-span-2">
          {inv.packingList
            ? [
                inv.packingList.number,
                inv.packingList.cartons !== null
                  ? `${formatCount(inv.packingList.cartons, currency)} cartons`
                  : null,
                inv.packingList.packedBy ? `packed by ${inv.packingList.packedBy}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Not made (the PDF is one page)"}
        </Fact>
      </dl>

      <Totals currency={currency} lines={invoiceTotalLines(inv)} />

      {inv.payments.length > 0 && (
        <section aria-label="Payments" className="grid gap-2">
          <h3 className="eyebrow">Payments</h3>
          <ul className="grid divide-y rounded-md border">
            {inv.payments.map((p) => (
              <li key={p.number} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0 text-sm break-words">
                  <span className="font-medium">{p.number}</span> · {formatDay(p.paidOn)} ·{" "}
                  {METHOD_LABELS[p.method]}
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {money(p.amount, currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button asChild variant="outline" className="mt-auto">
        <Link href={salesHref.invoice(inv.id)}>
          <ExternalLinkIcon aria-hidden />
          Open the full invoice
        </Link>
      </Button>
    </>
  );
}
