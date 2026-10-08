"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { localDay, localTime } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { listMovements } from "@/modules/inventory/stock.service";
import { listStockMovementsAction } from "@/server/actions/inventory.actions";

import { EmptyState } from "./bits";
import { GRADE_LABELS, money, MOVEMENT_LABELS, signed } from "./labels";
import { HISTORY_PAGE_SIZE } from "./stock-history-view";

export type MovementPage = Awaited<ReturnType<typeof listMovements>>;
type Movement = MovementPage["items"][number];

/**
 * Every change to a style's stock, newest first: what happened, to which SKU,
 * where, and who did it. What the pieces were worth shows only to people who see
 * the financials (the server leaves it out for everyone else).
 */
export function StockHistory({
  initial,
  styleId,
  warehouseId,
  showsCosts,
  currency,
  timeZone,
}: {
  initial: MovementPage;
  styleId: string;
  warehouseId: string | null;
  showsCosts: boolean;
  currency: string;
  timeZone: string;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  const when = (m: Movement) => {
    const at = new Date(m.createdAt);
    return `${formatDay(localDay(at, timeZone))}, ${localTime(at, timeZone)}`;
  };
  const what = (m: Movement) => MOVEMENT_LABELS[m.type];
  const sku = (m: Movement) => `${m.variant.color.name} / ${m.variant.size.name}`;
  const value = (m: Movement) => (m.value === null ? "—" : money(m.value, currency));

  function more() {
    startTransition(async () => {
      const result = await listStockMovementsAction({
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

  return (
    <section aria-labelledby="history-heading" className="grid gap-4">
      <div>
        <h3 id="history-heading" className="font-serif text-xl text-primary">
          Stock history
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Every piece in and out, newest first.</p>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No stock movements yet">
          Opening stock, deliveries from production, sales and counts show here.
        </EmptyState>
      ) : (
        <>
          <div className="hidden rounded-lg border bg-card px-5 py-1 md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead>By</TableHead>
                  {showsCosts && <TableHead className="text-right">Value</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-muted-foreground">{when(m)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{sku(m)}</div>
                      <div className="text-xs text-muted-foreground">{m.variant.sku}</div>
                    </TableCell>
                    <TableCell
                      className={cn("text-right font-medium", m.quantity < 0 && "text-destructive")}
                    >
                      {signed(m.quantity, currency)}
                    </TableCell>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <div>{what(m)}</div>
                      {m.note && <div className="text-xs text-muted-foreground">{m.note}</div>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.warehouse.name} · {GRADE_LABELS[m.grade]}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.recordedBy?.name ?? "—"}
                    </TableCell>
                    {showsCosts && <TableCell className="text-right">{value(m)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 md:hidden" aria-label="Stock history">
            {items.map((m) => (
              <li key={m.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{what(m)}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {sku(m)} · {m.variant.sku}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "font-serif text-lg tabular-nums",
                      m.quantity < 0 && "text-destructive",
                    )}
                  >
                    {signed(m.quantity, currency)}
                  </p>
                </div>
                {m.note && <p className="mt-2 text-sm">{m.note}</p>}
                <p className="mt-3 text-xs text-muted-foreground">
                  {when(m)} · {m.warehouse.name} · {GRADE_LABELS[m.grade]}
                  {m.recordedBy ? ` · ${m.recordedBy.name}` : ""}
                  {showsCosts && m.value !== null ? ` · ${value(m)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {cursor && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-self-center sm:w-auto"
          disabled={pending}
          onClick={more}
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Loading" : "Show older movements"}
        </Button>
      )}
      <ActionErrorDialog
        error={error}
        title="We could not load more of the history"
        onClose={() => setError(undefined)}
      />
    </section>
  );
}
