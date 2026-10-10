"use client";

import { EyeIcon, LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { toast } from "@/components/feedback/toaster";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatCount, formatDay } from "@/lib/display";
import type { OrderPeek } from "@/modules/sales/overview.service";
import { getOrderPeekAction } from "@/server/actions/sales.actions";

import { InvoiceBadge, OrderBadge, OverrideBadge } from "./badges";
import { Fact, Totals } from "./detail-bits";
import { CHANNEL_LABELS, money, salesHref } from "./labels";

/**
 * A slide-out quick look at an order: buyer, styles, money, documents and how
 * it ships, with a link to open it in full. Loads when opened.
 */
export function OrderQuickView({
  orderId,
  currency,
  onClose,
}: {
  orderId: string;
  currency: string;
  onClose: () => void;
}) {
  const [peek, setPeek] = useState<OrderPeek | null>(null);
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    let live = true;
    const fail = (message: string) => {
      setFailed(message);
      toast.error(message);
    };
    void getOrderPeekAction(orderId)
      .then((result) => {
        if (!live) return;
        if (result.ok) setPeek(result.data);
        else fail(result.error.message);
      })
      .catch(() => live && fail("The order could not load. Check the connection and try again."));
    return () => {
      live = false;
    };
  }, [orderId]);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent aria-describedby={undefined} className="gap-6 p-5 sm:p-6">
        {!peek ? (
          <>
            <SheetTitle className="font-serif text-xl text-primary">Order</SheetTitle>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {failed ?? (
                <>
                  <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
                  Loading the order
                </>
              )}
            </p>
          </>
        ) : (
          <PeekBody peek={peek} currency={currency} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PeekBody({ peek: o, currency }: { peek: OrderPeek; currency: string }) {
  return (
    <>
      <div className="pr-8">
        <p className="eyebrow">
          {CHANNEL_LABELS[o.channel]} · {formatDay(o.orderedOn)}
        </p>
        <SheetTitle className="mt-2 font-serif text-[1.5rem] leading-tight text-primary">
          {o.number}
        </SheetTitle>
        <SheetDescription className="mt-1 text-sm break-words">{o.buyer}</SheetDescription>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <OrderBadge status={o.status} />
          {o.invoice && <InvoiceBadge status={o.invoice.status} />}
          {o.hasForceOverride && <OverrideBadge />}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        {o.phone && <Fact label="Phone">{o.phone}</Fact>}
        {o.warehouse && <Fact label="Warehouse">{o.warehouse}</Fact>}
        <Fact label="Delivered">
          {formatCount(o.delivered, currency)} of {formatCount(o.pieces, currency)} pcs
        </Fact>
        {o.shipmentOn && <Fact label="Ships by">{formatDay(o.shipmentOn)}</Fact>}
        {o.totalCartons !== null && (
          <Fact label="Total cartons">{formatCount(o.totalCartons, currency)}</Fact>
        )}
        {o.packedBy && <Fact label="Packed by">{o.packedBy}</Fact>}
      </dl>

      <section aria-label="Styles" className="grid gap-2">
        <h3 className="eyebrow">Styles</h3>
        <ul className="grid divide-y rounded-md border">
          {o.styles.map((s) => (
            <li key={s.code} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0 text-sm break-words">
                <span className="font-medium">{s.code}</span> · {s.name}
              </span>
              <span className="shrink-0 text-right text-[0.8125rem] text-muted-foreground tabular-nums">
                {formatCount(s.pieces, currency)} pcs · {money(s.amount, currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Totals
        currency={currency}
        lines={[
          { label: "Subtotal", amount: o.subtotal },
          { label: "Discount", amount: o.discount, minus: true, optional: true },
          { label: "Delivery charge", amount: o.shippingCharge, optional: true },
          { label: "Tax / VAT", amount: o.tax, optional: true },
          { label: "Total", amount: o.total, strong: true },
          { label: "Paid", amount: o.paid, tone: "muted" },
          { label: "Due", amount: o.due, strong: true, tone: "due" },
        ]}
      />

      <dl className="grid gap-2 border-t pt-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Invoice</dt>
          <dd className="text-right">
            {o.invoice
              ? `${o.invoice.number}${o.invoice.dueOn ? ` · due ${formatDay(o.invoice.dueOn)}` : ""}`
              : "Not invoiced"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Packing list</dt>
          <dd className="text-right">{o.packingList ?? "Not made"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Delivery challans</dt>
          <dd className="text-right">{formatCount(o.challans, currency)}</dd>
        </div>
      </dl>

      <div className="mt-auto grid gap-2 sm:grid-cols-2">
        <Button asChild>
          <Link href={salesHref.order(o.id)}>Open the order</Link>
        </Button>
        {o.invoice && (
          <Button asChild variant="outline">
            <Link href={salesHref.invoice(o.invoice.id)}>Open the invoice</Link>
          </Button>
        )}
      </div>
    </>
  );
}

/** An eye button that opens an order's quick view. */
export function QuickViewButton({
  orderId,
  number,
  currency,
}: {
  orderId: string;
  number: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={`Quick view of ${number}`}
        title="Quick view"
      >
        <EyeIcon aria-hidden />
      </Button>
      {open && (
        <OrderQuickView orderId={orderId} currency={currency} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
