"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { SalesOverview } from "@/modules/sales/overview.service";

import { OrderBadge } from "./badges";
import { isZero, money } from "./labels";
import { OrderQuickView } from "./order-quick-view";

type Brief = SalesOverview["recent"][number];

/**
 * A short list of orders on the Overview; tapping one slides its quick view
 * out from the side. `late` marks ship-by days already gone.
 */
export function OrderPeekList({
  id,
  title,
  orders,
  empty,
  currency,
  today,
  kind,
}: {
  id: string;
  title: string;
  orders: Brief[];
  empty: string;
  currency: string;
  today: string;
  /** "recent": order day and what is due; "shipping": the ship-by day. */
  kind: "recent" | "shipping";
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-lg border bg-card p-5 sm:p-6">
      <h3 id={id} className="font-serif text-xl text-primary">
        {title}
      </h3>
      {orders.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 divide-y">
          {orders.map((o) => {
            const late = kind === "shipping" && o.shipmentOn !== null && o.shipmentOn < today;
            return (
              <li key={o.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setOpen(o.id)}
                  aria-label={`Quick view of ${o.number}, ${o.buyer}`}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-3 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{o.number}</span>
                      <OrderBadge status={o.status} />
                    </span>
                    <span className="truncate text-[0.8125rem] text-muted-foreground">
                      {o.buyer}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[0.8125rem] tabular-nums">
                    {kind === "shipping" && o.shipmentOn ? (
                      <span
                        className={cn(late ? "font-medium text-destructive" : "text-foreground")}
                      >
                        {late ? "Late · " : ""}
                        {formatDay(o.shipmentOn)}
                      </span>
                    ) : (
                      <span className="block font-medium">{money(o.total, currency)}</span>
                    )}
                    <span className="block text-muted-foreground">
                      {kind === "recent"
                        ? isZero(o.due)
                          ? formatDay(o.orderedOn)
                          : `${money(o.due, currency)} due`
                        : money(o.total, currency)}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <OrderQuickView orderId={open} currency={currency} onClose={() => setOpen(null)} />}
    </section>
  );
}
