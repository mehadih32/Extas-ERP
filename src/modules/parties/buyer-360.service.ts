import { type InvoiceStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import { buyerSales, buyerTopStyles } from "@/modules/dashboard/sales-figures";
import {
  archiveTypes,
  mayPrintType,
  PRINT_INFO,
  visibleDocumentsWhere,
} from "@/modules/documents/print.service";
import type { PrintType } from "@/modules/documents/model";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { profileShows } from "@/modules/parties/profile-access";
import { isWalkIn } from "@/modules/parties/walk-in";

/*
 * Customer 360°: one buyer's whole relationship with the company, read from the
 * existing records (nothing here writes). On top of the profile:
 *   - total sales, the average order, what they owe and what is overdue;
 *   - gross profit: sales less what those goods cost (delivered lines at the
 *     cost recorded when they left, the rest at the SKU's average landed cost),
 *     the same figures as the dashboard's top sellers. Office overheads stay out;
 *   - the styles they buy most;
 *   - the order, quotation, payment and production history, and the documents
 *     printed for them.
 *
 * Sales figures and history need sales.view, gross profit the financials and
 * production production.view (parties/profile-access.ts); what the reader may
 * not see is left out (null), the same way on screen, in the API and the PDF.
 * Walk-in customers' sales are the orders without a buyer.
 */

/** Rows each history shows on the profile; the rest open with "Show all". */
export const PROFILE_ROWS = 8;

/** A history opened in full, and the PDF, list at most this many rows each. */
export const PROFILE_ALL_ROWS = 500;

/** Styles in "Bought most". */
export const TOP_STYLES = 5;

export const BUYER_HISTORIES = [
  "orders",
  "quotations",
  "payments",
  "production",
  "documents",
] as const;

export type BuyerHistory = (typeof BUYER_HISTORIES)[number];

const optionsSchema = z.object({
  /** One history to list in full, or all of them (the PDF). */
  all: z.union([z.enum(BUYER_HISTORIES), z.literal("everything")]).optional(),
  /** Styles to rank. */
  topStyles: z.number().int().min(1).max(50).default(TOP_STYLES),
});

export type Buyer360Options = z.input<typeof optionsSchema>;

type Amount = Prisma.Decimal;
const fixed = (value: Amount) => value.toFixed(2);
const OPEN_INVOICE: InvoiceStatus[] = ["UNPAID", "PARTIALLY_PAID"];
const DAY_MS = 86_400_000;

const pct = (part: Amount, whole: Amount) =>
  whole.isZero() ? null : part.dividedBy(whole).times(100).toFixed(1);

/** A history's rows: the latest few, or all of them (up to PROFILE_ALL_ROWS). */
function take(options: z.output<typeof optionsSchema>, history: BuyerHistory) {
  return options.all === "everything" || options.all === history ? PROFILE_ALL_ROWS : PROFILE_ROWS;
}

// =============================================================================
// Histories
// =============================================================================

async function orderHistory(
  c: CompanyContext,
  where: { partyId: string | null },
  rows: number,
  at: Date,
) {
  const tz = c.company.timezone;
  const [total, items] = await Promise.all([
    c.db.salesOrder.count({ where }),
    c.db.salesOrder.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        number: true,
        channel: true,
        status: true,
        orderDate: true,
        customerName: true,
        total: true,
        paidAmount: true,
        dueAmount: true,
        invoice: {
          select: { id: true, number: true, status: true, dueDate: true, dueAmount: true },
        },
      },
    }),
  ]);
  return {
    total,
    items: items.map((o) => ({
      id: o.id,
      number: o.number,
      channel: o.channel,
      status: o.status,
      orderedOn: localDay(o.orderDate, tz),
      customerName: o.customerName,
      total: fixed(o.total),
      paid: fixed(o.paidAmount),
      due: fixed(o.dueAmount),
      invoice: o.invoice
        ? {
            id: o.invoice.id,
            number: o.invoice.number,
            status: o.invoice.status,
            dueOn: o.invoice.dueDate ? localDay(o.invoice.dueDate, tz) : null,
            isOverdue:
              OPEN_INVOICE.includes(o.invoice.status) &&
              o.invoice.dueDate !== null &&
              o.invoice.dueDate < at,
          }
        : null,
    })),
  };
}

async function quotationHistory(c: CompanyContext, id: string, rows: number) {
  const tz = c.company.timezone;
  const where = { partyId: id };
  const [total, items] = await Promise.all([
    c.db.quotation.count({ where }),
    c.db.quotation.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        number: true,
        status: true,
        issueDate: true,
        validUntil: true,
        currency: true,
        total: true,
        _count: { select: { items: true } },
      },
    }),
  ]);
  return {
    total,
    items: items.map((q) => ({
      id: q.id,
      number: q.number,
      status: q.status,
      issuedOn: localDay(q.issueDate, tz),
      validUntil: q.validUntil ? localDay(q.validUntil, tz) : null,
      currency: q.currency,
      total: fixed(q.total),
      itemCount: q._count.items,
    })),
  };
}

/** Money received from them (for Walk-in customers: payments on orders without a buyer). */
async function paymentHistory(
  c: CompanyContext,
  id: string,
  isWalkInAccount: boolean,
  rows: number,
) {
  const tz = c.company.timezone;
  const where: Prisma.PaymentWhereInput = isWalkInAccount
    ? { partyId: null, direction: "RECEIVED", orderId: { not: null } }
    : { partyId: id, direction: "RECEIVED" };
  const live: Prisma.PaymentWhereInput = {
    ...where,
    OR: [{ journalEntryId: null }, { journalEntry: { isReversed: false } }],
  };
  const [total, received, items] = await Promise.all([
    c.db.payment.count({ where }),
    c.db.payment.aggregate({ where: live, _sum: { amount: true } }),
    c.db.payment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        number: true,
        paymentDate: true,
        amount: true,
        method: true,
        reference: true,
        isAdvance: true,
        order: { select: { id: true, number: true } },
        proforma: { select: { id: true, number: true } },
        journalEntry: { select: { isReversed: true } },
      },
    }),
  ]);
  return {
    total,
    /** Everything received from them, less payments that were voided. */
    totalReceived: fixed(received._sum.amount ?? new Prisma.Decimal(0)),
    items: items.map((p) => ({
      id: p.id,
      number: p.number,
      paidOn: localDay(p.paymentDate, tz),
      amount: fixed(p.amount),
      method: p.method,
      reference: p.reference,
      isAdvance: p.isAdvance,
      order: p.order,
      proforma: p.proforma,
      voided: p.journalEntry?.isReversed ?? false,
    })),
  };
}

async function refundHistory(c: CompanyContext, where: { partyId: string | null }, rows: number) {
  const tz = c.company.timezone;
  const scoped: Prisma.RefundWhereInput =
    where.partyId === null ? { partyId: null, orderId: { not: null } } : where;
  const [total, items] = await Promise.all([
    c.db.refund.count({ where: scoped }),
    c.db.refund.findMany({
      where: scoped,
      orderBy: [{ refundDate: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        number: true,
        kind: true,
        amount: true,
        refundDate: true,
        voidedAt: true,
        order: { select: { id: true, number: true } },
        proforma: { select: { id: true, number: true } },
      },
    }),
  ]);
  return {
    total,
    items: items.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      amount: fixed(r.amount),
      refundedOn: localDay(r.refundDate, tz),
      voided: r.voidedAt !== null,
      order: r.order,
      proforma: r.proforma,
    })),
  };
}

async function productionHistory(c: CompanyContext, id: string, rows: number) {
  const tz = c.company.timezone;
  const where = { buyerId: id };
  const [total, items] = await Promise.all([
    c.db.productionProject.count({ where }),
    c.db.productionProject.findMany({
      where,
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        stage: true,
        startDate: true,
        targetDate: true,
        completedAt: true,
        targetQuantity: true,
        producedQtyA: true,
        producedQtyB: true,
        factoryName: true,
        factory: { select: { id: true, name: true } },
        style: { select: { id: true, code: true } },
      },
    }),
  ]);
  return {
    total,
    items: items.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      stage: p.stage,
      startedOn: localDay(p.startDate, tz),
      targetOn: localDay(p.targetDate, tz),
      completedOn: p.completedAt ? localDay(p.completedAt, tz) : null,
      targetQuantity: p.targetQuantity,
      produced: p.producedQtyA + p.producedQtyB,
      factory: p.factory?.name ?? p.factoryName,
      style: p.style,
    })),
  };
}

/** Documents printed for them that this person may open. */
async function documentHistory(c: CompanyContext, id: string, rows: number) {
  const tz = c.company.timezone;
  const types = archiveTypes(c);
  if (types.length === 0) return { total: 0, items: [] };
  const where = { ...visibleDocumentsWhere(c, types), partyId: id };
  const [total, items] = await Promise.all([
    c.db.generatedDocument.count({ where }),
    c.db.generatedDocument.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: rows,
      select: {
        id: true,
        documentType: true,
        title: true,
        createdAt: true,
        fileId: true,
        generatedBy: { select: { name: true } },
      },
    }),
  ]);
  return {
    total,
    items: items.map((d) => ({
      id: d.id,
      type: d.documentType as PrintType,
      typeLabel: PRINT_INFO[d.documentType as PrintType].label,
      title: d.title,
      madeOn: localDay(d.createdAt, tz),
      madeBy: d.generatedBy?.name ?? null,
      downloadable: d.fileId !== null,
    })),
  };
}

/**
 * One buyer's 360° view (parties.view; the walk-in account too). Suppliers are
 * not buyers: their profile answers "not found" here.
 */
export async function getBuyer360(
  ctx: CompanyContext,
  partyId: string,
  raw: Buyer360Options = {},
  now: Date = new Date(),
) {
  const options = optionsSchema.parse(raw);
  const party = await ctx.db.party.findUnique({ where: { id: partyId } });
  if (!party || party.kind === "SUPPLIER") throw new AppError("NOT_FOUND", "Buyer not found.");

  const tz = ctx.company.timezone;
  const shows = profileShows(ctx);
  const walkIn = isWalkIn(party);
  // Walk-in customers' sales are the orders without a buyer.
  const ownSales = walkIn ? { partyId: null } : { partyId: party.id };
  const liveInvoice = {
    ...ownSales,
    status: { not: "VOID" as const },
    order: { status: { not: "CANCELLED" as const } },
  };
  const salesAmounts = shows.sales || shows.profit;

  const [balance, sales, topStyles, invoiceDates, overdue] = await Promise.all([
    getPartyBalance(ctx, party.id),
    salesAmounts ? buyerSales(ctx.company.id, { partyId: walkIn ? null : party.id }) : null,
    salesAmounts
      ? buyerTopStyles(ctx.company.id, { partyId: walkIn ? null : party.id }, options.topStyles)
      : null,
    salesAmounts
      ? ctx.db.invoice.aggregate({
          where: liveInvoice,
          _min: { issueDate: true },
          _max: { issueDate: true },
        })
      : null,
    shows.sales
      ? ctx.db.invoice.aggregate({
          where: { ...liveInvoice, status: { in: OPEN_INVOICE }, dueDate: { lt: now } },
          _sum: { dueAmount: true },
          _count: { _all: true },
          _min: { dueDate: true },
        })
      : null,
  ]);

  const figures = {
    /** What they owe today (their account's balance when positive). */
    outstanding: fixed(balance.gt(0) ? balance : new Prisma.Decimal(0)),
    /** Money of theirs the company holds (an advance or credit), when the balance is negative. */
    heldForThem: fixed(balance.lt(0) ? balance.negated() : new Prisma.Decimal(0)),
    sales: sales
      ? {
          /** Goods invoiced, after discounts, without delivery charges or VAT. */
          total: fixed(sales.net),
          orders: sales.orders,
          pieces: sales.pieces,
          averageOrder: sales.orders > 0 ? fixed(sales.net.dividedBy(sales.orders)) : null,
          firstOn: invoiceDates?._min.issueDate ? localDay(invoiceDates._min.issueDate, tz) : null,
          lastOn: invoiceDates?._max.issueDate ? localDay(invoiceDates._max.issueDate, tz) : null,
        }
      : null,
    overdue: overdue
      ? {
          amount: fixed(overdue._sum.dueAmount ?? new Prisma.Decimal(0)),
          invoices: overdue._count._all,
          /** Days since the oldest overdue invoice fell due. */
          oldestDays: overdue._min.dueDate
            ? Math.max(0, Math.floor((now.getTime() - overdue._min.dueDate.getTime()) / DAY_MS))
            : null,
        }
      : null,
    profit:
      shows.profit && sales
        ? {
            /** Sales less what the goods cost. */
            gross: fixed(sales.net.minus(sales.cost)),
            cost: fixed(sales.cost),
            marginPct: pct(sales.net.minus(sales.cost), sales.net),
          }
        : null,
  };

  const styles = topStyles
    ? topStyles.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        orders: s.orders,
        pieces: s.pieces,
        value: fixed(s.net),
        /** Share of everything they bought, by value. */
        sharePct: sales ? pct(s.net, sales.net) : null,
        profit: shows.profit ? fixed(s.net.minus(s.cost)) : null,
        marginPct: shows.profit ? pct(s.net.minus(s.cost), s.net) : null,
      }))
    : null;

  const [orders, quotations, payments, refunds, production, documents] = await Promise.all([
    shows.sales ? orderHistory(ctx, ownSales, take(options, "orders"), now) : null,
    shows.sales && !walkIn ? quotationHistory(ctx, party.id, take(options, "quotations")) : null,
    shows.sales ? paymentHistory(ctx, party.id, walkIn, take(options, "payments")) : null,
    shows.sales ? refundHistory(ctx, ownSales, take(options, "payments")) : null,
    shows.production && !walkIn
      ? productionHistory(ctx, party.id, take(options, "production"))
      : null,
    documentHistory(ctx, party.id, take(options, "documents")),
  ]);

  return {
    party: {
      id: party.id,
      code: party.code,
      name: party.name,
      kind: party.kind,
      contactPerson: party.contactPerson,
      phone: party.phone,
      email: party.email,
      address: party.address,
      city: party.city,
      country: party.country,
      taxId: party.taxId,
      grade: party.grade,
      status: party.status,
      isVerified: party.isVerified,
      isWalkIn: walkIn,
      addedOn: localDay(party.createdAt, tz),
    },
    asOf: localDay(now, tz),
    shows,
    figures,
    topStyles: styles,
    orders,
    quotations,
    payments,
    refunds,
    production,
    documents,
    can: { print: mayPrintType(ctx, "BUYER_360") },
  };
}

export type Buyer360 = Awaited<ReturnType<typeof getBuyer360>>;
