"use client";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import { money } from "@/components/sales/labels";
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
import type { ReturnRow } from "@/modules/materials/screens.service";
import { listReturnRowsAction } from "@/server/actions/materials.actions";

import { FlagBadge } from "./badges";
import { materialsHref } from "./labels";
import { returnListQuery, type ReturnListView } from "./list-view";

/**
 * Goods sent back to suppliers (debit notes), newest first: cards on phones,
 * a table on computers, each opening the return, with "Show more".
 */
export function ReturnList({
  initial,
  view,
  currency,
}: {
  initial: { items: ReturnRow[]; nextCursor?: string };
  view: ReturnListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listReturnRowsAction(returnListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Returns">
        {list.items.map((r) => (
          <RowCard
            key={r.id}
            href={materialsHref.supplierReturn(r.id)}
            eyebrow={`${r.number} · ${formatDay(r.day)}`}
            badges={r.isVoid ? <FlagBadge tone="closed">Void</FlagBadge> : undefined}
            title={r.supplier?.name ?? "Supplier"}
            details={`From ${r.bill.number} · ${r.reason}`}
            footer={
              <span className={cn("font-medium", r.isVoid && "text-muted-foreground line-through")}>
                {money(r.total, currency)} credited
              </span>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Returns">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Return</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Why</TableHead>
              <TableHead className="text-right">Credited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="py-3">
                  <RowLink href={materialsHref.supplierReturn(r.id)}>{r.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(r.day)}</span>
                    {r.isVoid && <FlagBadge tone="closed">Void</FlagBadge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{r.supplier?.name}</div>
                  <div className="text-[0.8125rem] text-muted-foreground">From {r.bill.number}</div>
                </TableCell>
                <TableCell>
                  <div className="max-w-80 truncate text-muted-foreground">{r.reason}</div>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium whitespace-nowrap tabular-nums",
                    r.isVoid && "text-muted-foreground line-through",
                  )}
                >
                  {money(r.total, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="returns" />
    </div>
  );
}
