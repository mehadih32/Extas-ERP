"use client";

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
import type { InvoiceRow } from "@/modules/sales/screens.service";
import { listInvoiceRowsAction } from "@/server/actions/sales.actions";

import { InvoiceBadge } from "./badges";
import { buyerName, isZero, money, salesHref } from "./labels";
import { invoiceListQuery, type InvoiceListView } from "./list-view";
import { RowCard, RowLink, ShowMore, useLoadMore } from "./load-more";

function DueText({ invoice, currency }: { invoice: InvoiceRow; currency: string }) {
  if (invoice.status === "VOID") return <span className="text-muted-foreground">Void</span>;
  if (isZero(invoice.due)) return <span className="text-muted-foreground">Paid</span>;
  return (
    <span className={cn(invoice.isOverdue ? "text-destructive" : "text-foreground")}>
      {money(invoice.due, currency)} due
    </span>
  );
}

/** The invoices found: cards on phones, a table on computers, with "Show more". */
export function InvoiceList({
  initial,
  view,
  currency,
}: {
  initial: { items: InvoiceRow[]; nextCursor?: string };
  view: InvoiceListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listInvoiceRowsAction(invoiceListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Invoices">
        {list.items.map((inv) => (
          <RowCard
            key={inv.id}
            href={salesHref.invoice(inv.id)}
            eyebrow={`${inv.number} · ${formatDay(inv.issuedOn)}`}
            badges={<InvoiceBadge status={inv.status} isOverdue={inv.isOverdue} />}
            title={buyerName(inv.buyer, inv.customerName)}
            details={[`Order ${inv.order.number}`, inv.dueOn ? `Due ${formatDay(inv.dueOn)}` : null]
              .filter(Boolean)
              .join(" · ")}
            footer={
              <>
                <span className="font-medium">{money(inv.total, currency)}</span>
                <DueText invoice={inv} currency={currency} />
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Invoices">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Invoice</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="hidden lg:table-cell">Due day</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="py-3">
                  <RowLink href={salesHref.invoice(inv.id)}>{inv.number}</RowLink>
                  <div className="mt-1 text-[0.8125rem] whitespace-nowrap text-muted-foreground">
                    {formatDay(inv.issuedOn)} · {inv.order.number}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-64 truncate">{buyerName(inv.buyer, inv.customerName)}</div>
                  {inv.buyer && (
                    <div className="text-[0.8125rem] text-muted-foreground">{inv.buyer.code}</div>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {inv.dueOn ? formatDay(inv.dueOn) : "On receipt"}
                </TableCell>
                <TableCell>
                  <InvoiceBadge status={inv.status} isOverdue={inv.isOverdue} />
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap">
                  {money(inv.total, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <DueText invoice={inv} currency={currency} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="invoices" />
    </div>
  );
}
