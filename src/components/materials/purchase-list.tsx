"use client";

import { BillBadge } from "@/components/production/badges";
import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import { isZero, money } from "@/components/sales/labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { PurchaseRow } from "@/modules/materials/screens.service";
import { listPurchaseRowsAction } from "@/server/actions/materials.actions";

import { materialsHref } from "./labels";
import { purchaseListQuery, type PurchaseListView } from "./list-view";

const lines = (n: number) => `${n} ${n === 1 ? "material" : "materials"}`;

const what = (b: PurchaseRow) =>
  [lines(b.lineCount), b.store ? `into ${b.store}` : null, b.order ? `on ${b.order.number}` : null]
    .filter(Boolean)
    .join(" · ");

/**
 * Raw material purchases (the suppliers' bills), newest first: cards on
 * phones, a table on computers, each opening the bill, with "Show more".
 */
export function PurchaseList({
  initial,
  view,
  currency,
}: {
  initial: { items: PurchaseRow[]; nextCursor?: string };
  view: PurchaseListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listPurchaseRowsAction(purchaseListQuery(view, cursor)),
  );
  const owed = (b: PurchaseRow) =>
    b.status === "VOID" || isZero(b.due) ? null : `${money(b.due, currency)} owed`;

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Purchases">
        {list.items.map((b) => (
          <RowCard
            key={b.id}
            href={materialsHref.purchase(b.id)}
            eyebrow={`${b.number} · ${formatDay(b.billOn)}`}
            badges={<BillBadge status={b.status} />}
            title={b.supplier?.name ?? "Supplier"}
            details={what(b)}
            footer={
              <>
                <span className="text-destructive">{owed(b)}</span>
                <span
                  className={cn(
                    "font-medium",
                    b.status === "VOID" && "text-muted-foreground line-through",
                  )}
                >
                  {money(b.total, currency)}
                </span>
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Purchases">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Bill</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>What came in</TableHead>
              <TableHead className="text-right">Still owed</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="py-3">
                  <RowLink href={materialsHref.purchase(b.id)}>{b.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(b.billOn)}</span>
                    <BillBadge status={b.status} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{b.supplier?.name}</div>
                  {b.supplierRef && (
                    <div className="max-w-56 truncate text-[0.8125rem] text-muted-foreground">
                      Their no. {b.supplierRef}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="max-w-72 truncate text-muted-foreground">{what(b)}</div>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap text-destructive tabular-nums">
                  {owed(b) ? money(b.due, currency) : "–"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium whitespace-nowrap tabular-nums",
                    b.status === "VOID" && "text-muted-foreground line-through",
                  )}
                >
                  {money(b.total, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="purchases" />
    </div>
  );
}
