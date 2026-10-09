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
import type { OrderRow } from "@/modules/materials/screens.service";
import { listOrderRowsAction } from "@/server/actions/materials.actions";

import { FlagBadge, OrderBadge } from "./badges";
import { materialsHref } from "./labels";
import { orderListQuery, type OrderListView } from "./list-view";

/** "FAB-0001, TRM-0002 and 2 more" */
export function codesText(codes: string[], shown = 2) {
  const first = codes.slice(0, shown).join(", ");
  return codes.length > shown ? `${first} and ${codes.length - shown} more` : first;
}

const arrival = (o: OrderRow) =>
  o.status === "PARTIALLY_RECEIVED"
    ? `${o.arrivedCount} of ${o.lineCount} ${o.lineCount === 1 ? "line" : "lines"} in`
    : o.expectedOn
      ? `Expected ${formatDay(o.expectedOn)}`
      : null;

/**
 * Purchase orders, newest first: cards on phones, a table on computers, each
 * opening the order, with "Show more" for the next page.
 */
export function OrderList({
  initial,
  view,
  currency,
  seeCosts,
}: {
  initial: { items: OrderRow[]; nextCursor?: string };
  view: OrderListView;
  currency: string;
  seeCosts: boolean;
}) {
  const list = useLoadMore(initial, (cursor) => listOrderRowsAction(orderListQuery(view, cursor)));

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Purchase orders">
        {list.items.map((o) => (
          <RowCard
            key={o.id}
            href={materialsHref.order(o.id)}
            eyebrow={`${o.number} · ${formatDay(o.orderedOn)}`}
            badges={
              <>
                <OrderBadge status={o.status} />
                {o.isOverdue && <FlagBadge>Late</FlagBadge>}
              </>
            }
            title={o.supplier?.name ?? "Supplier"}
            details={[codesText(o.materials), o.project?.code].filter(Boolean).join(" · ")}
            footer={
              <>
                <span className="text-muted-foreground">{arrival(o)}</span>
                {seeCosts && o.total && (
                  <span className="font-medium">{money(o.total, currency)}</span>
                )}
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Purchase orders">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Order</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Materials</TableHead>
              <TableHead>Arrival</TableHead>
              {seeCosts && <TableHead className="text-right">Amount</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="py-3">
                  <RowLink href={materialsHref.order(o.id)}>{o.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(o.orderedOn)}</span>
                    <OrderBadge status={o.status} />
                    {o.isOverdue && <FlagBadge>Late</FlagBadge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-56 truncate">{o.supplier?.name}</div>
                  {o.supplierRef && (
                    <div className="max-w-56 truncate text-[0.8125rem] text-muted-foreground">
                      Their no. {o.supplierRef}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="max-w-64 truncate text-muted-foreground">
                    {codesText(o.materials)}
                  </div>
                  {o.project && (
                    <div className="text-[0.8125rem] text-muted-foreground">
                      For {o.project.code}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {arrival(o) ?? "–"}
                </TableCell>
                {seeCosts && (
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {o.total ? money(o.total, currency) : "–"}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="orders" />
    </div>
  );
}
