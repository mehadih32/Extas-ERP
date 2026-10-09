"use client";

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
import type { BillRow } from "@/modules/production/screens.service";
import { listBillRowsAction } from "@/server/actions/production.actions";

import { BillBadge } from "./badges";
import { productionHref } from "./labels";
import { billListQuery, type BillListView } from "./list-view";

const forWhat = (bill: BillRow) =>
  bill.isMaterialPurchase
    ? "Raw materials"
    : bill.projects.length > 0
      ? bill.projects.join(", ")
      : "No project";

function DueText({ bill, currency }: { bill: BillRow; currency: string }) {
  if (bill.status === "VOID") return <span className="text-muted-foreground">Void</span>;
  if (isZero(bill.due)) return <span className="text-muted-foreground">Paid</span>;
  return <span className="text-destructive">{money(bill.due, currency)} due</span>;
}

/**
 * The supplier bills found: cards on phones, a table on computers, each
 * opening the bill, with "Show more" for the next page.
 */
export function BillList({
  initial,
  view,
  currency,
}: {
  initial: { items: BillRow[]; nextCursor?: string };
  view: BillListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) => listBillRowsAction(billListQuery(view, cursor)));

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Bills">
        {list.items.map((bill) => (
          <RowCard
            key={bill.id}
            href={productionHref.bill(bill.id)}
            eyebrow={`${bill.number} · ${formatDay(bill.billOn)}`}
            badges={<BillBadge status={bill.status} />}
            title={bill.supplier?.name ?? "Supplier"}
            details={[forWhat(bill), bill.supplierRef ? `Their no. ${bill.supplierRef}` : null]
              .filter(Boolean)
              .join(" · ")}
            footer={
              <>
                <span className="font-medium">{money(bill.total, currency)}</span>
                <DueText bill={bill} currency={currency} />
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Bills">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Bill</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>For</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((bill) => (
              <TableRow key={bill.id}>
                <TableCell className="py-3">
                  <RowLink href={productionHref.bill(bill.id)}>{bill.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(bill.billOn)}</span>
                    <BillBadge status={bill.status} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{bill.supplier?.name}</div>
                  {bill.supplierRef && (
                    <div className="text-[0.8125rem] text-muted-foreground">
                      Their no. {bill.supplierRef}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate text-muted-foreground">{forWhat(bill)}</div>
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                  {money(bill.total, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  <DueText bill={bill} currency={currency} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="bills" />
    </div>
  );
}
