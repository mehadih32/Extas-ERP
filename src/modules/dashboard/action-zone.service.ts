import { Prisma } from "@prisma/client";

import { dateOnly, daysBetween, localDay } from "@/lib/dates";
import { formatDay, groupAmount } from "@/lib/display";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials, canSeeSalesAmounts, canSeeStock } from "@/modules/dashboard/access";
import { homePeriod, homeRangeSchema, type HomePeriod } from "@/modules/dashboard/home.service";
import { stockWindow } from "@/modules/dashboard/insights.service";
import { lowStock } from "@/modules/dashboard/stock-figures";
import { whatsappLink } from "@/modules/parties/contact";

/*
 * The Home screen's Action Zone: what needs someone now, each with the one
 * click that deals with it.
 *
 *   Overdue invoices   buyers with unpaid invoices past their due day (as the
 *                      invoice list's Overdue filter reads them), the most owed
 *                      first, each with a WhatsApp link that opens the chat with
 *                      a payment reminder already written. Nothing is sent by
 *                      the app itself.
 *   Low stock          the Insights' low stock list (below the company's
 *                      threshold, 5 pieces by default), out of stock first, with
 *                      "Order now": a new in-house production project for the style.
 *   Pending approvals  leave requests and payroll waiting to be approved, and,
 *                      for the owner, the sales returns made in the period and
 *                      its orders with a discount over 10%. Returns and discounts
 *                      have no approval step (a return is a credit note at once;
 *                      QC of returned goods comes later), so these are flagged
 *                      for the owner to look over.
 *
 * The alerts show what is open now; the returns and discounts follow the period
 * chosen at the top. Each part is only read for the people who handle it.
 */

/** Rows each part lists; the rest are a click away. */
const LIMIT = 5;
const FEW = 3;

/** An order whose discounts come to more than this share of its goods is flagged. */
export const BIG_DISCOUNT_PCT = 10;

/** Who sees which part of the Action Zone. */
export function actionZoneAccess(ctx: Pick<CompanyContext, "can">) {
  return {
    /** Those who follow up buyers' dues: sales with the buyer ledgers, Accounts and the owner. */
    overdue: canSeeSalesAmounts(ctx) && (ctx.can("parties.ledger.view") || canSeeFinancials(ctx)),
    lowStock: canSeeStock(ctx),
    leave: ctx.can("hr.manage"),
    payroll: ctx.can("hr.payroll.approve"),
    /** The owner (company settings) looks over the period's returns and big discounts. */
    returns: ownerReview(ctx),
    discounts: ownerReview(ctx),
  };
}

const ownerReview = (ctx: Pick<CompanyContext, "can">) =>
  ctx.can("company.settings") && canSeeSalesAmounts(ctx);

export type ActionZoneAccess = ReturnType<typeof actionZoneAccess>;

/** Whether this person sees any of the Action Zone. */
export const hasActionZone = (access: ActionZoneAccess) => Object.values(access).some(Boolean);

// --- Overdue invoices -------------------------------------------------------------------

type OverdueRow = {
  partyId: string | null;
  name: string | null;
  phone: string | null;
  whatsapp: string | null;
  customerName: string | null;
  customerPhone: string | null;
  due: Prisma.Decimal;
  invoices: number;
  oldestDue: Date;
  numbers: string[];
  firstInvoiceId: string;
  buyers: number;
  totalDue: Prisma.Decimal;
  totalInvoices: number;
};

/** "INV-0001", "INV-0001 and INV-0002", "INV-0001, INV-0002, INV-0003 and 2 more". */
function invoiceList(numbers: string[]) {
  const shown = numbers.slice(0, FEW);
  const more = numbers.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length === 1) return shown[0]!;
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** The payment reminder the WhatsApp button opens the chat with. */
export function reminderMessage(r: {
  company: string;
  buyer: string | null;
  amount: string;
  numbers: string[];
  oldestDueOn: string;
}) {
  const invoices =
    r.numbers.length === 1 ? `invoice ${r.numbers[0]}` : `invoices ${invoiceList(r.numbers)}`;
  const due =
    r.numbers.length === 1
      ? ` (due ${formatDay(r.oldestDueOn)})`
      : `, the oldest due ${formatDay(r.oldestDueOn)}`;
  return (
    `Dear ${r.buyer ?? "customer"}, a gentle reminder from ${r.company}: ${r.amount} is overdue ` +
    `on ${invoices}${due}. Please arrange the payment at your earliest convenience. Thank you.`
  );
}

/**
 * Buyers with overdue invoices, the most owed first. A walk-in sale has no buyer
 * account, so each of its invoices is a row of its own, under the customer's
 * name and phone from the order.
 */
async function overdueInvoices(ctx: CompanyContext, now: Date, today: string) {
  const rows = await prisma.$queryRaw<OverdueRow[]>`
    WITH due AS (
      SELECT inv.id, inv.number, inv."dueDate", inv."dueAmount", inv."partyId",
             so."customerName", so."customerPhone",
             COALESCE(inv."partyId", 'invoice:' || inv.id) AS key
      FROM "Invoice" inv
      JOIN "SalesOrder" so ON so.id = inv."orderId"
      WHERE inv."companyId" = ${ctx.company.id}
        AND inv.status IN ('UNPAID', 'PARTIALLY_PAID')
        AND inv."dueDate" < ${now}
        AND inv."dueAmount" > 0
    ),
    buyer AS (
      SELECT key, MAX("partyId") AS "partyId",
             MAX("customerName") AS "customerName", MAX("customerPhone") AS "customerPhone",
             SUM("dueAmount") AS due, COUNT(*)::int AS invoices, MIN("dueDate") AS "oldestDue",
             ARRAY_AGG(number ORDER BY "dueDate", number) AS numbers,
             (ARRAY_AGG(id ORDER BY "dueDate", number))[1] AS "firstInvoiceId"
      FROM due
      GROUP BY key
    )
    SELECT b."partyId", b."customerName", b."customerPhone", b.due, b.invoices, b."oldestDue",
           b.numbers, b."firstInvoiceId", p.name, p.phone, p.whatsapp,
           (COUNT(*) OVER ())::int AS buyers,
           SUM(b.due) OVER () AS "totalDue",
           (SUM(b.invoices) OVER ())::int AS "totalInvoices"
    FROM buyer b
    LEFT JOIN "Party" p ON p.id = b."partyId"
    ORDER BY b.due DESC, b."oldestDue", b.key
    LIMIT ${LIMIT}`;
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const first = rows[0];
  return {
    /** Buyers (each walk-in invoice counts as one), invoices and what they owe, all of them. */
    buyers: first?.buyers ?? 0,
    invoices: first?.totalInvoices ?? 0,
    total: new Prisma.Decimal(first?.totalDue ?? 0).toFixed(2),
    items: rows.map((r) => {
      const due = new Prisma.Decimal(r.due).toFixed(2);
      const oldestDueOn = localDay(r.oldestDue, tz);
      const buyer = r.partyId ? r.name : r.customerName;
      const phone = r.partyId ? (r.whatsapp ?? r.phone) : r.customerPhone;
      return {
        partyId: r.partyId,
        /** Null for a walk-in sale with no name on the order. */
        buyer,
        walkIn: !r.partyId,
        due,
        invoices: r.invoices,
        /** The first few invoice numbers, oldest due first. */
        numbers: r.numbers.slice(0, FEW),
        /** The oldest overdue invoice, to open when there is only the one. */
        invoiceId: r.firstInvoiceId,
        oldestDueOn,
        /** Days since the oldest one fell due (0: due earlier today). */
        daysLate: Math.max(daysBetween(oldestDueOn, today), 0),
        /** A wa.me link with the reminder typed in; null without a usable number. */
        whatsapp: whatsappLink(
          phone,
          reminderMessage({
            company: ctx.company.name,
            buyer,
            amount: `${currency} ${groupAmount(due, currency)}`,
            numbers: r.numbers,
            oldestDueOn,
          }),
        ),
      };
    }),
  };
}

// --- Low stock --------------------------------------------------------------------------

/**
 * The SKUs below the threshold, as the Insights list them. "Order now" starts a
 * production project for the style (production.manage); others open the product.
 */
async function lowStockAlerts(ctx: CompanyContext, now: Date) {
  const threshold = ctx.company.lowStockThreshold;
  // Only the "sold in the last 30 days" window matters here; the slow-stock days do not.
  const window = stockWindow(ctx.company, { slowDays: 90, coverDays: 180 }, now);
  const low = await lowStock(ctx.company.id, window, threshold, LIMIT);
  return {
    threshold,
    total: low.total,
    outOfStock: low.outOfStock,
    orderNow: ctx.can("production.manage")
      ? ("PRODUCTION" as const)
      : ctx.can("inventory.view")
        ? ("PRODUCT" as const)
        : null,
    items: low.items.map((r) => ({
      variantId: r.variantId,
      styleId: r.styleId,
      sku: r.sku,
      styleCode: r.styleCode,
      styleName: r.styleName,
      colorName: r.colorName,
      sizeName: r.sizeName,
      available: r.available,
      soldRecently: r.soldRecently,
    })),
  };
}

// --- Pending approvals ------------------------------------------------------------------

/** Sales returns (credit notes) made in the period and not void, the latest first. */
async function periodReturns(ctx: CompanyContext, period: HomePeriod) {
  const where = { voidedAt: null, receivedAt: { gte: period.start, lt: period.end } };
  const [count, rows] = await Promise.all([
    ctx.db.salesReturn.count({ where }),
    ctx.db.salesReturn.findMany({
      where,
      select: {
        id: true,
        number: true,
        receivedAt: true,
        amount: true,
        party: { select: { name: true } },
        order: { select: { customerName: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: FEW,
    }),
  ]);
  return {
    count,
    items: rows.map((r) => ({
      id: r.id,
      number: r.number,
      buyer: r.party?.name ?? r.order.customerName ?? null,
      returnedOn: localDay(r.receivedAt, ctx.company.timezone),
      /** What the buyer was credited. */
      amount: new Prisma.Decimal(r.amount).toFixed(2),
      by: r.createdBy?.name ?? null,
    })),
  };
}

/** Leave requests waiting for a decision, the earliest leave first. */
async function pendingLeave(ctx: CompanyContext) {
  const where = { status: "PENDING" as const };
  const [count, rows] = await Promise.all([
    ctx.db.leaveRequest.count({ where }),
    ctx.db.leaveRequest.findMany({
      where,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        days: true,
        employee: { select: { name: true } },
        leaveType: { select: { name: true } },
      },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      take: FEW,
    }),
  ]);
  return {
    count,
    items: rows.map((r) => ({
      id: r.id,
      employee: r.employee.name,
      type: r.leaveType.name,
      from: dateOnly(r.startDate),
      to: dateOnly(r.endDate),
      days: new Prisma.Decimal(r.days).toString(),
    })),
  };
}

/** Payroll prepared but not yet approved, the earliest month first. */
async function pendingPayroll(ctx: CompanyContext) {
  const rows = await ctx.db.payrollRun.findMany({
    where: { status: "DRAFT" },
    select: { id: true, year: true, month: true },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    take: FEW,
  });
  return {
    count: rows.length,
    items: rows.map((r) => ({ id: r.id, month: `${r.year}-${String(r.month).padStart(2, "0")}` })),
  };
}

type DiscountRow = {
  id: string;
  number: string;
  orderDate: Date;
  buyer: string | null;
  discount: Prisma.Decimal;
  gross: Prisma.Decimal;
  byName: string | null;
  total: number;
};

/**
 * Orders in the period whose discounts (line and order discounts together) come
 * to more than BIG_DISCOUNT_PCT of the goods before discount, the biggest share
 * first, with who made each one (from the audit trail). Cancelled orders are left out.
 */
async function bigDiscounts(ctx: CompanyContext, period: HomePeriod) {
  const rows = await prisma.$queryRaw<DiscountRow[]>`
    WITH o AS (
      SELECT so.id, so.number, so."orderDate", so."companyId",
             COALESCE(p.name, so."customerName") AS buyer,
             so.discount + COALESCE(li.disc, 0) AS discount,
             so.subtotal + COALESCE(li.disc, 0) AS gross
      FROM "SalesOrder" so
      LEFT JOIN "Party" p ON p.id = so."partyId"
      LEFT JOIN LATERAL (
        SELECT SUM(i.discount) AS disc FROM "SalesOrderItem" i WHERE i."orderId" = so.id
      ) li ON true
      WHERE so."companyId" = ${ctx.company.id}
        AND so.status <> 'CANCELLED'
        AND so."orderDate" >= ${period.start} AND so."orderDate" < ${period.end}
    )
    SELECT o.id, o.number, o."orderDate", o.buyer, o.discount, o.gross, u.name AS "byName",
           (COUNT(*) OVER ())::int AS total
    FROM o
    LEFT JOIN LATERAL (
      SELECT a."userId" FROM "AuditLog" a
      WHERE a."companyId" = o."companyId" AND a."entityType" = 'SalesOrder'
        AND a."entityId" = o.id AND a.action = 'CREATE'
      ORDER BY a."createdAt"
      LIMIT 1
    ) made ON true
    LEFT JOIN "User" u ON u.id = made."userId"
    WHERE o.gross > 0 AND o.discount * 100 > o.gross * ${BIG_DISCOUNT_PCT}
    ORDER BY o.discount / o.gross DESC, o."orderDate" DESC, o.id
    LIMIT ${LIMIT}`;
  return {
    threshold: BIG_DISCOUNT_PCT,
    count: rows[0]?.total ?? 0,
    items: rows.map((r) => {
      const discount = new Prisma.Decimal(r.discount);
      return {
        id: r.id,
        number: r.number,
        buyer: r.buyer,
        orderedOn: localDay(r.orderDate, ctx.company.timezone),
        /** The share of the goods given away, to one decimal place. */
        percent: discount.dividedBy(r.gross).times(100).toFixed(1),
        discount: discount.toFixed(2),
        /** Who made the order; null when the audit trail does not say. */
        by: r.byName,
      };
    }),
  };
}

/**
 * The Action Zone for the period chosen at the top. A part this person does not
 * handle comes back as null; so does Pending approvals as a whole when none of
 * its parts are theirs.
 */
export async function getActionZone(ctx: CompanyContext, raw: unknown = {}, now = new Date()) {
  const { range } = homeRangeSchema.parse(raw);
  const tz = ctx.company.timezone;
  const today = localDay(now, tz);
  const period = homePeriod(range, today, tz);
  const can = actionZoneAccess(ctx);
  const [overdue, low, returns, leave, payroll, discounts] = await Promise.all([
    can.overdue ? overdueInvoices(ctx, now, today) : null,
    can.lowStock ? lowStockAlerts(ctx, now) : null,
    can.returns ? periodReturns(ctx, period) : null,
    can.leave ? pendingLeave(ctx) : null,
    can.payroll ? pendingPayroll(ctx) : null,
    can.discounts ? bigDiscounts(ctx, period) : null,
  ]);
  const approvals =
    returns || leave || payroll || discounts ? { returns, leave, payroll, discounts } : null;
  return {
    range,
    from: period.from,
    to: period.to,
    today,
    currency: ctx.company.currency,
    overdue,
    lowStock: low,
    approvals,
    /** Which pages the rows may link to. */
    open: { buyers: ctx.can("parties.view"), sales: ctx.can("sales.view") },
  };
}

export type ActionZone = Awaited<ReturnType<typeof getActionZone>>;
