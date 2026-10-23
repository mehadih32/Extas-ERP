"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatDay } from "@/lib/display";
import type { SalesReturnRow } from "@/modules/sales/return-screens.service";
import { listSalesReturnRowsAction } from "@/server/actions/sales.actions";

import { SalesReturnBadge } from "./badges";
import { money, salesHref } from "./labels";
import { returnListQuery, type ReturnListView } from "./list-view";
import { RowCard, RowLink, ShowMore, useLoadMore } from "./load-more";

const who = (row: SalesReturnRow) => row.buyer?.name ?? row.customerName ?? "Buyer removed";

/** Sales returns (credit notes): cards on phones, a table on computers, each opening its note. */
export function ReturnList({
  initial,
  view,
  currency,
}: {
  initial: { items: SalesReturnRow[]; nextCursor?: string };
  view: ReturnListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listSalesReturnRowsAction(returnListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Sales returns">
        {list.items.map((r) => (
          <RowCard
            key={r.id}
            href={salesHref.salesReturn(r.id)}
            eyebrow={`${r.number} · ${formatDay(r.returnedOn)}`}
            badges={<SalesReturnBadge voided={r.voided} />}
            title={who(r)}
            details={`Invoice ${r.invoice.number} · ${formatCount(r.pieces, currency)} pcs · ${r.reason}`}
            footer={<span className="font-medium">{money(r.amount, currency)} credited</span>}
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Sales returns">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Credit note</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Pieces</TableHead>
              <TableHead className="text-right">Credited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="py-3">
                  <RowLink href={salesHref.salesReturn(r.id)}>{r.number}</RowLink>
                  <div className="mt-1 text-[0.8125rem] text-muted-foreground">
                    {formatDay(r.returnedOn)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 min-w-40 break-words whitespace-normal">{who(r)}</div>
                  <div className="max-w-56 min-w-40 text-[0.8125rem] break-words whitespace-normal text-muted-foreground">
                    {r.reason}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.invoice.number}
                  <div className="mt-1 text-[0.8125rem]">Order {r.order.number}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(r.pieces, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <span className="font-medium">{money(r.amount, currency)}</span>
                  {r.voided && (
                    <div className="mt-1">
                      <SalesReturnBadge voided />
                    </div>
                  )}
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
