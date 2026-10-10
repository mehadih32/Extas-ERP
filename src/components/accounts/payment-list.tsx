"use client";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import { METHOD_LABELS, money } from "@/components/sales/labels";
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
import type { SupplierPaymentRow } from "@/modules/accounts/screens.service";
import { listSupplierPaymentRowsAction } from "@/server/actions/accounts.actions";

import { OffBadge } from "./badges";
import { accountsHref } from "./labels";
import { paymentListQuery, type PaymentListView } from "./list-view";

const what = (p: SupplierPaymentRow) =>
  [
    `${METHOD_LABELS[p.method]}${p.account ? ` from ${p.account.name}` : ""}`,
    p.bill ? `for ${p.bill.number}` : p.project ? `for ${p.project.code}` : "on account",
  ].join(" · ");

/**
 * Payments made to suppliers: cards on phones, a table on computers, each
 * opening the payment, with "Show more" for the next page.
 */
export function PaymentList({
  initial,
  view,
  currency,
}: {
  initial: { items: SupplierPaymentRow[]; nextCursor?: string };
  view: PaymentListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listSupplierPaymentRowsAction(paymentListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Payments">
        {list.items.map((p) => (
          <RowCard
            key={p.id}
            href={accountsHref.payment(p.id)}
            eyebrow={`${p.number} · ${formatDay(p.paidOn)}`}
            badges={p.isVoid ? <OffBadge>Void</OffBadge> : undefined}
            title={p.supplier?.name ?? "Supplier"}
            details={what(p)}
            footer={
              <span className={cn("font-medium", p.isVoid && "text-muted-foreground line-through")}>
                {money(p.amount, currency)}
              </span>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Payments">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Payment</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>How</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="py-3">
                  <RowLink href={accountsHref.payment(p.id)}>{p.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(p.paidOn)}</span>
                    {p.isVoid && <OffBadge>Void</OffBadge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{p.supplier?.name}</div>
                  {p.reference && (
                    <div className="max-w-56 truncate text-[0.8125rem] text-muted-foreground">
                      {p.reference}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="max-w-72 truncate text-muted-foreground">{what(p)}</div>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium whitespace-nowrap tabular-nums",
                    p.isVoid && "text-muted-foreground line-through",
                  )}
                >
                  {money(p.amount, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="payments" />
    </div>
  );
}
