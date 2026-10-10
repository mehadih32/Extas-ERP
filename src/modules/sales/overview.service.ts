import type { Prisma } from "@prisma/client";

import { dateColumn, dateOnly, localDay, localTime } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import { salesAccess } from "@/modules/sales/screens.service";
import { SHIPMENT_OPEN } from "@/modules/sales/rules";
import { getSalesSummary } from "@/modules/sales/summary.service";

/*
 * The Sales Overview tab: today's figures (from the sales summary), what still
 * has to leave the warehouse, what is overdue, the latest orders and the next
 * ones due to ship. Every figure is a count or a sum done by the database; the
 * lists read only the columns they show.
 */

const fixed = (value: Prisma.Decimal | null | undefined) => (value ?? 0).toFixed(2);

const orderBrief = {
  id: true,
  number: true,
  status: true,
  channel: true,
  orderDate: true,
  shipmentDate: true,
  total: true,
  dueAmount: true,
  customerName: true,
  party: { select: { name: true } },
} as const satisfies Prisma.SalesOrderSelect;

type OrderBrief = Prisma.SalesOrderGetPayload<{ select: typeof orderBrief }>;

const present = (o: OrderBrief, tz: string) => ({
  id: o.id,
  number: o.number,
  status: o.status,
  channel: o.channel,
  orderedOn: localDay(o.orderDate, tz),
  shipmentOn: dateOnly(o.shipmentDate),
  buyer: o.party?.name ?? o.customerName ?? "Walk-in customer",
  total: fixed(o.total),
  due: fixed(o.dueAmount),
});

export async function getSalesOverview(ctx: CompanyContext) {
  const tz = ctx.company.timezone;
  const now = new Date();
  const today = localDay(now, tz);
  const open = { status: { in: [...SHIPMENT_OPEN] } };
  const [summary, toDeliver, late, overdue, recent, shipping] = await Promise.all([
    getSalesSummary(ctx, {}),
    ctx.db.salesOrder.aggregate({ where: open, _count: { _all: true }, _sum: { total: true } }),
    ctx.db.salesOrder.count({ where: { ...open, shipmentDate: { lt: dateColumn(today) } } }),
    ctx.db.invoice.aggregate({
      where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, dueDate: { lt: now } },
      _count: { _all: true },
      _sum: { dueAmount: true },
    }),
    ctx.db.salesOrder.findMany({
      select: orderBrief,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 6,
    }),
    ctx.db.salesOrder.findMany({
      where: { ...open, shipmentDate: { not: null } },
      select: orderBrief,
      orderBy: [{ shipmentDate: "asc" }, { id: "asc" }],
      take: 5,
    }),
  ]);
  return {
    today,
    /** When the figures were read ("14:05", company time), so the screen can say how fresh they are. */
    updatedAt: localTime(now, tz),
    currency: ctx.company.currency,
    canCreate: salesAccess(ctx).sell,
    figures: {
      ordersToday: { count: summary.orderCount, value: summary.orderValue },
      invoicedToday: { count: summary.invoiceCount, value: summary.invoicedSales },
      collectedToday: { value: summary.netCollected, refunded: summary.refunded },
      toDeliver: { count: toDeliver._count._all, value: fixed(toDeliver._sum.total), late },
      outstanding: { count: summary.unpaidInvoices, value: summary.outstandingDue },
      overdue: { count: overdue._count._all, value: fixed(overdue._sum.dueAmount) },
      openQuotations: summary.openQuotations,
      awaitingAdvance: summary.proformasAwaitingAdvance,
    },
    recent: recent.map((o) => present(o, tz)),
    shipping: shipping.map((o) => present(o, tz)),
  };
}

export type SalesOverview = Awaited<ReturnType<typeof getSalesOverview>>;

/**
 * A quick look at one order for the slide-out panel: who, what (pieces and
 * amount by style), money, documents and logistics. Read with only the columns
 * shown; no costs.
 */
export async function getOrderPeek(ctx: CompanyContext, orderId: string) {
  const o = await ctx.db.salesOrder.findUnique({
    where: { id: orderId },
    select: {
      ...orderBrief,
      warehouse: { select: { name: true } },
      party: { select: { id: true, name: true, phone: true } },
      customerPhone: true,
      subtotal: true,
      discount: true,
      shippingCharge: true,
      tax: true,
      paidAmount: true,
      totalCartons: true,
      hasForceOverride: true,
      packedBy: { select: { name: true } },
      invoice: { select: { id: true, number: true, status: true, dueDate: true } },
      packingList: { select: { number: true } },
      _count: { select: { deliveryChallans: true } },
      items: {
        select: {
          quantity: true,
          lineTotal: true,
          variant: { select: { styleId: true, style: { select: { code: true, name: true } } } },
        },
      },
    },
  });
  if (!o) throw new AppError("NOT_FOUND", "Order not found.");
  const delivered = await ctx.db.deliveryChallanItem.aggregate({
    where: { challan: { orderId: o.id } },
    _sum: { quantity: true },
  });
  const tz = ctx.company.timezone;
  const styles = new Map<string, { code: string; name: string; pieces: number; amount: number }>();
  for (const item of o.items) {
    const group = styles.get(item.variant.styleId) ?? {
      ...item.variant.style,
      pieces: 0,
      amount: 0,
    };
    group.pieces += item.quantity;
    group.amount += Number(item.lineTotal);
    styles.set(item.variant.styleId, group);
  }
  const pieces = o.items.reduce((sum, i) => sum + i.quantity, 0);
  return {
    ...present(o, tz),
    buyerId: o.party?.id ?? null,
    phone: o.party?.phone ?? o.customerPhone,
    warehouse: o.warehouse?.name ?? null,
    styles: [...styles.values()].map((s) => ({ ...s, amount: s.amount.toFixed(2) })),
    pieces,
    delivered: delivered._sum.quantity ?? 0,
    subtotal: fixed(o.subtotal),
    discount: fixed(o.discount),
    shippingCharge: fixed(o.shippingCharge),
    tax: fixed(o.tax),
    paid: fixed(o.paidAmount),
    hasForceOverride: o.hasForceOverride,
    totalCartons: o.totalCartons,
    packedBy: o.packedBy?.name ?? null,
    invoice: o.invoice
      ? {
          id: o.invoice.id,
          number: o.invoice.number,
          status: o.invoice.status,
          dueOn: o.invoice.dueDate ? localDay(o.invoice.dueDate, tz) : null,
        }
      : null,
    packingList: o.packingList?.number ?? null,
    challans: o._count.deliveryChallans,
  };
}

export type OrderPeek = Awaited<ReturnType<typeof getOrderPeek>>;
