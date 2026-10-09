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
import type { OrderRow } from "@/modules/sales/screens.service";
import { listOrderRowsAction } from "@/server/actions/sales.actions";

import { InvoiceBadge, OrderBadge, OverrideBadge } from "./badges";
import { buyerName, CHANNEL_LABELS, isZero, money, salesHref } from "./labels";
import { orderListQuery, type OrderListView } from "./list-view";
import { RowCard, RowLink, ShowMore, useLoadMore } from "./load-more";

function DueText({ order, currency }: { order: OrderRow; currency: string }) {
  if (order.status === "CANCELLED") return <span className="text-muted-foreground">Cancelled</span>;
  if (isZero(order.due)) return <span className="text-muted-foreground">Paid</span>;
  return <span className="text-destructive">{money(order.due, currency)} due</span>;
}

/**
 * The orders found: cards on phones, a table on computers, each opening the
 * order, with "Show more" for the next page.
 */
export function OrderList({
  initial,
  view,
  currency,
}: {
  initial: { items: OrderRow[]; nextCursor?: string };
  view: OrderListView;
  currency: string;
}) {
  const list = useLoadMore(initial, (cursor) => listOrderRowsAction(orderListQuery(view, cursor)));

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Orders">
        {list.items.map((order) => (
          <RowCard
            key={order.id}
            href={salesHref.order(order.id)}
            eyebrow={`${order.number} · ${formatDay(order.orderedOn)}`}
            badges={
              <>
                {order.hasForceOverride && <OverrideBadge />}
                <OrderBadge status={order.status} />
              </>
            }
            title={buyerName(order.buyer, order.customerName)}
            details={[
              CHANNEL_LABELS[order.channel],
              order.invoice ? `Invoice ${order.invoice.number}` : "Not invoiced",
              order.shipmentOn ? `Ships ${formatDay(order.shipmentOn)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            footer={
              <>
                <span className="font-medium">{money(order.total, currency)}</span>
                <DueText order={order} currency={currency} />
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Orders">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Order</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="hidden lg:table-cell">Channel</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="py-3">
                  <RowLink href={salesHref.order(order.id)}>{order.number}</RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <span>{formatDay(order.orderedOn)}</span>
                    <OrderBadge status={order.status} />
                    {order.hasForceOverride && <OverrideBadge />}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-64 truncate">
                    {buyerName(order.buyer, order.customerName)}
                  </div>
                  {order.shipmentOn && (
                    <div className="text-[0.8125rem] text-muted-foreground">
                      Ships {formatDay(order.shipmentOn)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {CHANNEL_LABELS[order.channel]}
                </TableCell>
                <TableCell>
                  {order.invoice ? (
                    <div className="grid gap-1">
                      <span className="text-[0.8125rem] whitespace-nowrap">
                        {order.invoice.number}
                      </span>
                      <InvoiceBadge status={order.invoice.status} />
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Not invoiced</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium whitespace-nowrap">
                  {money(order.total, currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <DueText order={order} currency={currency} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="orders" />
    </div>
  );
}
