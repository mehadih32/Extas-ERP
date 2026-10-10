"use client";

import type { StockLotSource } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { productionHref } from "@/components/production/labels";
import { StatusBadge } from "@/components/sales/badges";
import { Button } from "@/components/ui/button";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { StockLotItem, StockLotPage } from "@/modules/inventory/lot.service";
import { listStockLotsAction } from "@/server/actions/inventory.actions";

import { EmptyState } from "./bits";
import { money, pieces } from "./labels";
import { HISTORY_PAGE_SIZE } from "./stock-history-view";

const SOURCE_LABELS: Record<StockLotSource, string> = {
  OPENING: "Opening stock",
  PRODUCTION: "From production",
};

const linkClass = "font-medium text-foreground underline-offset-4 hover:underline";

/** Where the batch came from: its delivery, project and supplier, as links where allowed. */
function Origin({ lot }: { lot: StockLotItem }) {
  const parts: React.ReactNode[] = [lot.warehouse.name];
  // Document numbers stay on one line; a supplier's name may wrap.
  const link = (href: string | null, text: string, whole = true) =>
    href ? (
      <Link href={href} className={cn(linkClass, whole && "whitespace-nowrap")}>
        {text}
      </Link>
    ) : (
      <span className={cn(whole && "whitespace-nowrap")}>{text}</span>
    );
  if (lot.delivery) {
    parts.push(
      <>
        Delivery{" "}
        {link(lot.delivery.id && productionHref.delivery(lot.delivery.id), lot.delivery.number)}
      </>,
    );
  }
  if (lot.project) {
    parts.push(
      <>
        Project {link(lot.project.id && productionHref.project(lot.project.id), lot.project.code)}
      </>,
    );
  }
  if (lot.supplier) {
    parts.push(
      link(
        lot.supplier.id && `/parties/suppliers/${encodeURIComponent(lot.supplier.id)}`,
        lot.supplier.name,
        false,
      ),
    );
  }
  return (
    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {part}
        </span>
      ))}
    </p>
  );
}

function Figure({ label, count, each }: { label: string; count: string; each?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 font-serif text-lg lining-nums tabular-nums">{count}</dd>
      {each && <dd className="text-xs text-muted-foreground tabular-nums">{each} each</dd>}
    </div>
  );
}

/**
 * The style's inward batches as a timeline, newest first: each lot's automatic
 * number, where it came from (opening stock, or a delivery with its project and
 * supplier), its fresh and B-grade pieces and, for people who see the
 * financials, what one piece cost.
 */
export function InwardBatches({
  initial,
  styleId,
  warehouseId,
  currency,
  timeZone,
}: {
  initial: StockLotPage;
  styleId: string;
  warehouseId: string | null;
  currency: string;
  timeZone: string;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const cost = (value: string | null) => (value === null ? null : money(value, currency));

  function more() {
    startTransition(async () => {
      const result = await listStockLotsAction({
        styleId,
        warehouseId: warehouseId ?? undefined,
        cursor,
        take: HISTORY_PAGE_SIZE,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems((shown) => [...shown, ...result.data.items]);
      setCursor(result.data.nextCursor);
    });
  }

  if (items.length === 0) {
    return (
      <EmptyState title="No batches have come in yet">
        Opening stock and each delivery from production show here with their own lot number.
      </EmptyState>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <ol className="grid grid-cols-1" aria-label="Inward batches">
        {items.map((lot) => (
          <li
            key={lot.id}
            className="group relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0"
          >
            <div aria-hidden className="relative flex justify-center">
              <span className="absolute top-5 -bottom-0 w-px bg-border group-last:hidden" />
              <span
                className={cn(
                  "relative mt-4 size-3 rounded-full ring-4 ring-background",
                  lot.undone ? "bg-muted-foreground/50" : "bg-primary",
                )}
              />
            </div>
            <article
              className={cn(
                "min-w-0 rounded-xl border bg-card p-4 shadow-sm",
                lot.undone && "opacity-75",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h4 className="font-medium tabular-nums">{lot.number}</h4>
                <StatusBadge tone="plain" className="rounded-full px-2">
                  {SOURCE_LABELS[lot.source]}
                </StatusBadge>
                {lot.undone && (
                  <StatusBadge tone="closed" className="rounded-full px-2">
                    Undone
                  </StatusBadge>
                )}
                <span className="ml-auto text-sm text-muted-foreground">
                  {formatDay(localDay(new Date(lot.createdAt), timeZone))}
                </span>
              </div>
              <Origin lot={lot} />
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-3">
                <Figure
                  label="Fresh"
                  count={pieces(lot.fresh, currency)}
                  each={cost(lot.unitCost.fresh)}
                />
                <Figure
                  label="B-grade"
                  count={pieces(lot.bGrade, currency)}
                  each={cost(lot.unitCost.bGrade)}
                />
                {lot.value !== null && <Figure label="Worth" count={cost(lot.value)!} />}
              </dl>
              {lot.undone && (
                <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                  This delivery was undone, so its pieces went back out of stock.
                </p>
              )}
            </article>
          </li>
        ))}
      </ol>
      {cursor && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-self-center sm:w-auto"
          disabled={pending}
          onClick={more}
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Loading" : "Show older batches"}
        </Button>
      )}
      <ActionErrorDialog
        error={error}
        title="We could not load more batches"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
