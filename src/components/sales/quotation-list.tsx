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
import type { ProformaRow, QuotationRow } from "@/modules/sales/screens.service";
import { listProformaRowsAction, listQuotationRowsAction } from "@/server/actions/sales.actions";

import { ProformaBadge, QuotationBadge } from "./badges";
import { isZero, money, salesHref } from "./labels";
import {
  proformaListQuery,
  type ProformaListView,
  quotationListQuery,
  type QuotationListView,
} from "./list-view";
import { RowCard, RowLink, ShowMore, useLoadMore } from "./load-more";

const items = (count: number, currency: string) =>
  `${formatCount(count, currency)} ${count === 1 ? "item" : "items"}`;

/** The quotations found: cards on phones, a table on computers, with "Show more". */
export function QuotationList({
  initial,
  view,
  currency,
}: {
  initial: { items: QuotationRow[]; nextCursor?: string };
  view: QuotationListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listQuotationRowsAction(quotationListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Quotations">
        {list.items.map((q) => (
          <RowCard
            key={q.id}
            href={salesHref.quotation(q.id)}
            eyebrow={`${q.number} · ${formatDay(q.issuedOn)}`}
            badges={<QuotationBadge status={q.status} isExpired={q.isExpired} />}
            title={q.buyer.name}
            details={[
              items(q.itemCount, currency),
              q.validUntil ? `Valid until ${formatDay(q.validUntil)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            footer={<span className="font-medium">{money(q.total, q.currency)}</span>}
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Quotations">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Quotation</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="hidden lg:table-cell">Valid until</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((q) => (
              <TableRow key={q.id}>
                <TableCell className="py-3">
                  <RowLink href={salesHref.quotation(q.id)}>{q.number}</RowLink>
                  <div className="mt-1 text-[0.8125rem] text-muted-foreground">
                    {formatDay(q.issuedOn)} · {items(q.itemCount, currency)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-64 truncate">{q.buyer.name}</div>
                  <div className="text-[0.8125rem] text-muted-foreground">{q.buyer.code}</div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {q.validUntil ? formatDay(q.validUntil) : "Open"}
                </TableCell>
                <TableCell>
                  <QuotationBadge status={q.status} isExpired={q.isExpired} />
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap">
                  {money(q.total, q.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="quotations" />
    </div>
  );
}

function AdvanceText({ p, currency }: { p: ProformaRow; currency: string }) {
  if (p.status === "CANCELLED") return <span className="text-muted-foreground">Cancelled</span>;
  const due = Number(p.advanceAmount) - Number(p.advancePaid);
  if (due <= 0 || isZero(p.advanceAmount)) {
    return <span className="text-muted-foreground">Advance received</span>;
  }
  return <span className="text-destructive">{money(due.toFixed(2), currency)} advance due</span>;
}

/** The proforma invoices found: cards on phones, a table on computers, with "Show more". */
export function ProformaList({
  initial,
  view,
  currency,
}: {
  initial: { items: ProformaRow[]; nextCursor?: string };
  view: ProformaListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listProformaRowsAction(proformaListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul
        className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden"
        aria-label="Proforma invoices"
      >
        {list.items.map((p) => (
          <RowCard
            key={p.id}
            href={salesHref.proforma(p.id)}
            eyebrow={`${p.number} · ${formatDay(p.issuedOn)}`}
            badges={<ProformaBadge status={p.status} />}
            title={p.buyer.name}
            details={`Advance ${p.advancePercent}%: ${money(p.advanceAmount, currency)}`}
            footer={
              <>
                <span className="font-medium">{money(p.total, currency)}</span>
                <AdvanceText p={p} currency={currency} />
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Proforma invoices">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Proforma</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Advance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="py-3">
                  <RowLink href={salesHref.proforma(p.id)}>{p.number}</RowLink>
                  <div className="mt-1 text-[0.8125rem] text-muted-foreground">
                    {formatDay(p.issuedOn)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-64 truncate">{p.buyer.name}</div>
                  <div className="text-[0.8125rem] text-muted-foreground">{p.buyer.code}</div>
                </TableCell>
                <TableCell>
                  <ProformaBadge status={p.status} />
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap">
                  {money(p.total, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div>
                    {money(p.advanceAmount, currency)} ({p.advancePercent}%)
                  </div>
                  <div className="text-[0.8125rem]">
                    <AdvanceText p={p} currency={currency} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="proformas" />
    </div>
  );
}
