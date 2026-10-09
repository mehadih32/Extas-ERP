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
import type { PaymentRow, RefundRow } from "@/modules/sales/screens.service";
import { listPaymentRowsAction, listRefundRowsAction } from "@/server/actions/sales.actions";

import { RefundBadge } from "./badges";
import { METHOD_LABELS, money, salesHref } from "./labels";
import { paymentListQuery, type PaymentListView } from "./list-view";
import { RowCard, RowLink, ShowMore, useLoadMore } from "./load-more";

/** What a payment or refund was against: "Order SO-0012", "Advance on PI-0003", "On account". */
function againstText(row: {
  order: { number: string } | null;
  proforma: { number: string } | null;
}): string {
  if (row.proforma) return `Advance on ${row.proforma.number}`;
  if (row.order) return `Order ${row.order.number}`;
  return "On account";
}

const who = (row: { buyer: { name: string } | null }) => row.buyer?.name ?? "Walk-in customer";

/** Money received: cards on phones, a table on computers, each opening its receipt. */
export function PaymentList({
  initial,
  view,
  currency,
}: {
  initial: { items: PaymentRow[]; nextCursor?: string };
  view: PaymentListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listPaymentRowsAction(paymentListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Money received">
        {list.items.map((p) => (
          <RowCard
            key={p.id}
            href={salesHref.payment(p.id)}
            eyebrow={`${p.number} · ${formatDay(p.paidOn)}`}
            title={who(p)}
            details={[againstText(p), METHOD_LABELS[p.method], p.reference]
              .filter(Boolean)
              .join(" · ")}
            footer={<span className="font-medium">{money(p.amount, currency)}</span>}
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Money received">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Receipt</TableHead>
              <TableHead>From</TableHead>
              <TableHead>For</TableHead>
              <TableHead className="hidden lg:table-cell">Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="py-3">
                  <RowLink href={salesHref.payment(p.id)}>{p.number}</RowLink>
                  <div className="mt-1 text-[0.8125rem] text-muted-foreground">
                    {formatDay(p.paidOn)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-64 truncate">{who(p)}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{againstText(p)}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div>{METHOD_LABELS[p.method]}</div>
                  {p.reference && (
                    <div className="max-w-48 truncate text-[0.8125rem] text-muted-foreground">
                      {p.reference}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap">
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

/** Where a refund was recorded: its order or proforma, else the buyer's profile. */
function refundHref(r: RefundRow): string | null {
  if (r.order) return salesHref.order(r.order.id);
  if (r.proforma) return salesHref.proforma(r.proforma.id);
  return null;
}

/** Money taken back off what buyers paid: paid back, kept as credit, or kept as a charge. */
export function RefundList({
  initial,
  view,
  currency,
}: {
  initial: { items: RefundRow[]; nextCursor?: string };
  view: PaymentListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listRefundRowsAction(paymentListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Refunds">
        {list.items.map((r) => {
          const href = refundHref(r);
          const card = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="eyebrow min-w-0 truncate">
                  {r.number} · {formatDay(r.refundedOn)}
                </p>
                <div className="-my-1 shrink-0">
                  <RefundBadge kind={r.kind} voided={r.voided} />
                </div>
              </div>
              <p className="mt-2 font-serif text-lg leading-snug break-words text-primary">
                {who(r)}
              </p>
              <p className="mt-1 text-sm break-words text-muted-foreground">
                {againstText(r)} · {r.reason}
              </p>
              <p className="mt-3 border-t pt-3 text-sm font-medium tabular-nums">
                {money(r.amount, currency)}
              </p>
            </>
          );
          return href ? (
            <RowCard
              key={r.id}
              href={href}
              eyebrow={`${r.number} · ${formatDay(r.refundedOn)}`}
              badges={<RefundBadge kind={r.kind} voided={r.voided} />}
              title={who(r)}
              details={`${againstText(r)} · ${r.reason}`}
              footer={<span className="font-medium">{money(r.amount, currency)}</span>}
            />
          ) : (
            <li key={r.id} className="min-w-0 rounded-lg border bg-card p-4">
              {card}
            </li>
          );
        })}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Refunds">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Refund</TableHead>
              <TableHead>To</TableHead>
              <TableHead>From</TableHead>
              <TableHead>How</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((r) => {
              const href = refundHref(r);
              return (
                <TableRow key={r.id}>
                  <TableCell className="py-3">
                    {href ? (
                      <RowLink href={href}>{r.number}</RowLink>
                    ) : (
                      <span className="font-medium">{r.number}</span>
                    )}
                    <div className="mt-1 text-[0.8125rem] text-muted-foreground">
                      {formatDay(r.refundedOn)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-56 truncate">{who(r)}</div>
                    <div className="max-w-56 truncate text-[0.8125rem] text-muted-foreground">
                      {r.reason}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{againstText(r)}</TableCell>
                  <TableCell>
                    <RefundBadge kind={r.kind} voided={r.voided} />
                    {r.method && (
                      <div className="mt-1 text-[0.8125rem] text-muted-foreground">
                        {METHOD_LABELS[r.method]}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">
                    {money(r.amount, currency)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="refunds" />
    </div>
  );
}
