import { Prisma } from "@prisma/client";

import { dayRange } from "@/lib/dates";
import type { CompanyContext } from "@/modules/auth/context";
import { salesSummarySchema } from "@/modules/sales/schemas";

/** "YYYY-MM-DD" for today in the company's timezone. */
function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

/**
 * Sales figures for the dashboard ("Today's Sales") and the sales overview:
 * invoiced sales, orders by channel, money collected and dues still open.
 * Defaults to today in company time.
 */
export async function getSalesSummary(ctx: CompanyContext, raw: unknown = {}) {
  const q = salesSummarySchema.parse(raw);
  const today = todayIn(ctx.company.timezone);
  const { start, end } = dayRange(q.from ?? today, q.to ?? q.from ?? today, ctx.company.timezone);
  const range = { gte: start, lt: end };

  const [invoiced, orders, byChannel, collected, outstanding, awaitingAdvance, openQuotations] =
    await Promise.all([
      ctx.db.invoice.aggregate({
        where: { status: { not: "VOID" }, issueDate: range },
        _sum: { total: true },
        _count: { _all: true },
      }),
      ctx.db.salesOrder.aggregate({
        where: { status: { not: "CANCELLED" }, orderDate: range },
        _sum: { total: true },
        _count: { _all: true },
      }),
      ctx.db.salesOrder.groupBy({
        by: ["channel"],
        where: { status: { not: "CANCELLED" }, orderDate: range },
        _sum: { total: true },
        _count: { _all: true },
      }),
      ctx.db.payment.aggregate({
        where: { direction: "RECEIVED", paymentDate: range },
        _sum: { amount: true },
      }),
      ctx.db.invoice.aggregate({
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
        _sum: { dueAmount: true },
        _count: { _all: true },
      }),
      ctx.db.proformaInvoice.count({ where: { status: "ISSUED" } }),
      ctx.db.quotation.count({ where: { status: { in: ["DRAFT", "SENT"] } } }),
    ]);
  const amount = (v: Prisma.Decimal | null | undefined) => (v ?? new Prisma.Decimal(0)).toFixed(2);
  return {
    period: { from: q.from ?? today, to: q.to ?? q.from ?? today, timezone: ctx.company.timezone },
    invoicedSales: amount(invoiced._sum.total),
    invoiceCount: invoiced._count._all,
    orderValue: amount(orders._sum.total),
    orderCount: orders._count._all,
    byChannel: byChannel.map((c) => ({
      channel: c.channel,
      orders: c._count._all,
      value: amount(c._sum.total),
    })),
    collected: amount(collected._sum.amount),
    outstandingDue: amount(outstanding._sum.dueAmount),
    unpaidInvoices: outstanding._count._all,
    proformasAwaitingAdvance: awaitingAdvance,
    openQuotations,
  };
}
