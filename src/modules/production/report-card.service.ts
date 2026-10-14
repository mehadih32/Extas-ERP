import { Prisma } from "@prisma/client";

import { quantity as materialQuantity } from "@/components/materials/labels";
import { FAULT_KIND_LABELS, FAULT_STATUS_LABELS } from "@/components/production/labels";
import { addDays, dateOnly, daysBetween, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount, formatDay } from "@/lib/format";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { aiText } from "@/modules/ai/ai-text";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf } from "@/modules/documents/builders";
import { documentFileName, type PrintDocument } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import { canSeeMaterialCosts } from "@/modules/materials/access";

/*
 * A supplier's report card for the last 12 months, on one PDF: its orders and
 * how many came on time, its deliveries against their challans (Short/Extra),
 * its fault log and what is still to deduct, its contracts, a grade, and a
 * short summary (worded by AI when set up, from plain rules otherwise). Made
 * when asked for and not kept; it carries values, so it follows the
 * material-cost rule (Production Managers, buyers and Accounts).
 */

const ZERO = new Prisma.Decimal(0);
const trimmed = (d: Prisma.Decimal) => d.toFixed(3).replace(/\.?0+$/, "") || "0";

export type Grade = "A" | "B" | "C" | "D";

/** A from 90% on time with at most one fault, B from 75%, C from 50%, else D (no orders: none). */
export function supplierGrade(onTimePercent: number | null, faults: number): Grade | null {
  if (onTimePercent === null) return null;
  if (onTimePercent >= 90 && faults <= 1) return "A";
  if (onTimePercent >= 75) return "B";
  if (onTimePercent >= 50) return "C";
  return "D";
}

/** The card's figures for a supplier over the 12 months to today. */
export async function supplierReportCard(ctx: CompanyContext, supplierId: string) {
  if (!canSeeMaterialCosts(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Report cards carry values: Production Managers, buyers and Accounts make them.",
    );
  }
  const supplier = await ctx.db.party.findUnique({
    where: { id: supplierId },
    select: { id: true, code: true, name: true, phone: true, kind: true, supplierCategories: true },
  });
  if (!supplier || supplier.kind === "BUYER")
    throw new AppError("NOT_FOUND", "Supplier not found.");
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const from = addDays(today, -365);
  const fromDate = new Date(`${from}T00:00:00Z`);

  const orders = await ctx.db.purchaseOrder.findMany({
    where: { supplierId: supplier.id, orderDate: { gte: fromDate }, status: { not: "CANCELLED" } },
    select: {
      id: true,
      number: true,
      status: true,
      orderDate: true,
      expectedDate: true,
      batch: { select: { code: true } },
      project: { select: { code: true } },
      bills: {
        where: { status: { not: "VOID" } },
        select: { billDate: true },
        orderBy: { billDate: "asc" },
        take: 1,
      },
    },
    orderBy: [{ orderDate: "asc" }, { number: "asc" }],
  });
  const orderRows = orders.map((o) => {
    const expected = dateOnly(o.expectedDate);
    const first = o.bills[0] ? localDay(o.bills[0].billDate, tz) : null;
    const late = expected ? (first ?? (today > expected ? today : null)) : null;
    const daysLate = expected && late && late > expected ? daysBetween(expected, late) : 0;
    return {
      number: o.number,
      for: o.batch?.code ?? o.project?.code ?? null,
      orderedOn: dateOnly(o.orderDate),
      expectedOn: expected,
      firstDeliveryOn: first,
      /** Null: no expected day, or not due and not delivered yet. */
      onTime: expected ? (first ? first <= expected : today > expected ? false : null) : null,
      daysLate,
    };
  });
  const judged = orderRows.filter((o) => o.onTime !== null);
  const onTime = judged.filter((o) => o.onTime).length;
  const onTimePercent = judged.length > 0 ? Math.round((onTime / judged.length) * 100) : null;

  const items = await ctx.db.supplierBillItem.findMany({
    where: {
      challanQuantity: { not: null },
      bill: { supplierId: supplier.id, status: { not: "VOID" }, billDate: { gte: fromDate } },
    },
    select: {
      quantity: true,
      challanQuantity: true,
      rawMaterial: { select: { code: true, name: true, unit: true } },
      bill: { select: { number: true, billDate: true } },
    },
    orderBy: [{ bill: { billDate: "asc" } }, { bill: { number: "asc" } }, { id: "asc" }],
  });
  const deliveries = items.map((i) => ({
    bill: i.bill.number,
    on: localDay(i.bill.billDate, tz),
    material: i.rawMaterial,
    challan: i.challanQuantity!,
    actual: i.quantity,
    difference: i.quantity.minus(i.challanQuantity!),
  }));
  const short = deliveries.filter((d) => d.difference.lt(0));

  const faults = await ctx.db.supplierFault.findMany({
    where: { supplierId: supplier.id, occurredOn: { gte: fromDate } },
    select: {
      number: true,
      kind: true,
      status: true,
      quantity: true,
      amount: true,
      occurredOn: true,
      rawMaterial: { select: { code: true, unit: true } },
      batch: { select: { code: true } },
    },
    orderBy: [{ occurredOn: "asc" }, { number: "asc" }],
  });
  const sum = (rows: typeof faults) => rows.reduce((t, f) => t.plus(f.amount ?? ZERO), ZERO);
  const open = faults.filter((f) => f.status === "OPEN");
  const contracts = await ctx.db.productionContract.findMany({
    where: { partyId: supplier.id },
    select: { number: true, kind: true, signedOn: true, batch: { select: { code: true } } },
    orderBy: [{ createdAt: "asc" }, { number: "asc" }],
  });
  return {
    supplier,
    from,
    today,
    orders: orderRows,
    onTime: { judged: judged.length, onTime, percent: onTimePercent },
    averageDaysLate:
      judged.filter((o) => o.daysLate > 0).length > 0
        ? Math.round(
            judged.reduce((t, o) => t + o.daysLate, 0) /
              judged.filter((o) => o.daysLate > 0).length,
          )
        : 0,
    deliveries,
    shortDeliveries: short.length,
    faults,
    openFaults: { count: open.length, amount: sum(open) },
    deducted: sum(faults.filter((f) => f.status === "DEDUCTED")),
    contracts: {
      count: contracts.length,
      signed: contracts.filter((c) => c.signedOn).length,
      list: contracts,
    },
    grade: supplierGrade(onTimePercent, faults.length),
  };
}

export type SupplierReportCard = Awaited<ReturnType<typeof supplierReportCard>>;

/** The plain-rule summary: on time, shorts, faults and what is still to deduct. */
export function ruleSummary(card: SupplierReportCard, currency: string): string {
  const name = card.supplier.name;
  const parts: string[] = [];
  if (card.onTime.judged === 0) {
    parts.push(`${name} has no order with an expected day in the last 12 months.`);
  } else {
    parts.push(
      `${name} delivered ${card.onTime.onTime} of ${card.onTime.judged} orders on time (${card.onTime.percent}%) in the last 12 months` +
        (card.averageDaysLate > 0
          ? `; late ones came ${card.averageDaysLate} ${card.averageDaysLate === 1 ? "day" : "days"} late on average.`
          : "."),
    );
  }
  parts.push(
    card.shortDeliveries === 0
      ? "Every delivery checked against its challan was in full."
      : `${card.shortDeliveries} of ${card.deliveries.length} delivery ${card.deliveries.length === 1 ? "line" : "lines"} checked against the challan came short.`,
  );
  parts.push(
    card.openFaults.count === 0
      ? card.faults.length === 0
        ? "Nothing is in the fault log."
        : "Every fault in the log is settled."
      : `${card.openFaults.count} fault${card.openFaults.count === 1 ? " is" : "s are"} still open, ${formatAmount(card.openFaults.amount, 2, currency)} ${currency} to deduct from the next payment.`,
  );
  if (card.grade) {
    parts.push(
      card.grade === "A"
        ? "Grade A: keep ordering as usual."
        : card.grade === "B"
          ? "Grade B: reliable, follow up on the open points."
          : card.grade === "C"
            ? "Grade C: agree firmer days and check deliveries closely."
            : "Grade D: look for a second supplier before the next batch.",
    );
  }
  return parts.join(" ");
}

/** The summary, worded by AI from the card's figures when it is set up. */
export async function cardSummary(companyId: string, card: SupplierReportCard, currency: string) {
  const ai = await aiText(companyId, {
    why: `Report card summary for ${card.supplier.name}`,
    instructions:
      "You write a short supplier report card summary for a garment company in Bangladesh. " +
      "In 3 to 4 plain sentences: how reliable the supplier is on delivery days, how its " +
      "deliveries matched their challans (say Short/Extra, not variance), what is still to " +
      "deduct, and one practical next step. Use only the figures given; do not invent any.",
    facts: {
      supplier: card.supplier.name,
      period: `${card.from} to ${card.today}`,
      orders: card.orders.length,
      onTime: card.onTime,
      averageDaysLate: card.averageDaysLate,
      deliveryLinesChecked: card.deliveries.length,
      shortLines: card.shortDeliveries,
      faults: card.faults.length,
      openFaults: { count: card.openFaults.count, amount: card.openFaults.amount.toFixed(2) },
      deducted: card.deducted.toFixed(2),
      currency,
      grade: card.grade,
    },
    maxTokens: 300,
    maxChars: 900,
  });
  return ai ? { text: ai, byAi: true } : { text: ruleSummary(card, currency), byAi: false };
}

export function reportCardDocument(
  ctx: CompanyContext,
  card: SupplierReportCard,
  summary: { text: string; byAi: boolean },
): PrintDocument {
  const currency = ctx.company.currency;
  const amount = (v: Prisma.Decimal) => formatAmount(v, 2, currency);
  const q = (v: Prisma.Decimal, unit: Parameters<typeof materialQuantity>[1]) =>
    materialQuantity(trimmed(v), unit, currency);
  return {
    type: "SUPPLIER_REPORT_CARD",
    title: "Supplier report card",
    subtitle: card.supplier.name,
    reference: card.supplier.code ?? card.supplier.name,
    letterhead: letterheadOf(ctx.company),
    meta: [
      { label: "Supplier", value: card.supplier.code ?? card.supplier.name },
      { label: "From", value: formatDay(card.from) },
      { label: "To", value: formatDay(card.today) },
      ...(card.grade ? [{ label: "Grade", value: card.grade }] : []),
    ],
    parties: [
      {
        heading: "Supplier",
        lines: [card.supplier.name, card.supplier.phone].filter((l): l is string => Boolean(l)),
      },
    ],
    blocks: [
      {
        kind: "figures",
        figures: [
          { label: "Orders", value: String(card.orders.length) },
          {
            label: "On time",
            value: card.onTime.percent === null ? "–" : `${card.onTime.percent}%`,
            hint: `${card.onTime.onTime} of ${card.onTime.judged}`,
          },
          {
            label: "Short deliveries",
            value: String(card.shortDeliveries),
            hint: `of ${card.deliveries.length} checked`,
          },
          {
            label: "Open to deduct",
            value: amount(card.openFaults.amount),
            hint: `${card.openFaults.count} open fault${card.openFaults.count === 1 ? "" : "s"}`,
          },
        ],
      },
      {
        kind: "text",
        title: "Summary",
        paragraphs: [summary.text],
      },
      {
        kind: "note",
        text: summary.byAi
          ? "The summary is worded by AI from the figures on this card."
          : "The summary is worked out from the figures on this card.",
      },
      {
        kind: "table",
        title: "Orders",
        columns: [
          { label: "Order", weight: 1.5 },
          { label: "For", weight: 1.5 },
          { label: "Ordered", weight: 1.3 },
          { label: "Expected", weight: 1.3 },
          { label: "First delivery", weight: 1.4 },
          { label: "On time", weight: 1.1 },
        ],
        rows: card.orders.map((o) => ({
          cells: [
            o.number,
            o.for ?? "Stock",
            formatDay(o.orderedOn),
            o.expectedOn ? formatDay(o.expectedOn) : "–",
            o.firstDeliveryOn ? formatDay(o.firstDeliveryOn) : "Not yet",
            o.onTime === null ? "–" : o.onTime ? "Yes" : `No (${o.daysLate} days)`,
          ],
        })),
        empty: "No orders in these 12 months.",
      },
      {
        kind: "table",
        title: "Challan vs Actual",
        columns: [
          { label: "Bill", weight: 1.4 },
          { label: "Day", weight: 1.2 },
          { label: "Material", weight: 2.6 },
          { label: "Challan", align: "right", weight: 1.3 },
          { label: "Actual", align: "right", weight: 1.3 },
          { label: "Short/Extra", align: "right", weight: 1.3 },
        ],
        rows: card.deliveries.map((d) => ({
          cells: [
            d.bill,
            formatDay(d.on),
            `${d.material.code} · ${d.material.name}`,
            q(d.challan, d.material.unit),
            q(d.actual, d.material.unit),
            d.difference.isZero()
              ? "Final Match"
              : `${d.difference.gt(0) ? "Extra" : "Short"} ${q(d.difference.abs(), d.material.unit)}`,
          ],
        })),
        empty: "No delivery was checked against a challan.",
      },
      {
        kind: "table",
        title: "Fault log",
        columns: [
          { label: "Fault", weight: 1.4 },
          { label: "Day", weight: 1.2 },
          { label: "What", weight: 1.6 },
          { label: "For", weight: 1.6 },
          { label: "Value", align: "right", weight: 1.3 },
          { label: "Status", weight: 1.1 },
        ],
        rows: card.faults.map((f) => ({
          cells: [
            f.number,
            formatDay(dateOnly(f.occurredOn)),
            FAULT_KIND_LABELS[f.kind],
            [f.batch?.code, f.rawMaterial?.code].filter(Boolean).join(" · ") || "–",
            f.amount ? amount(f.amount) : "To agree",
            FAULT_STATUS_LABELS[f.status],
          ],
        })),
        empty: "Nothing in the fault log.",
      },
      ...(card.contracts.count > 0
        ? [
            {
              kind: "list" as const,
              title: "Contracts",
              items: card.contracts.list.map((c) => ({
                label: c.number,
                text: `${c.batch.code}, ${c.signedOn ? `signed ${formatDay(dateOnly(c.signedOn))}` : "draft"}`,
              })),
            },
          ]
        : []),
    ],
    signatures: [],
  };
}

/** The report card PDF (logged; nothing is kept). */
export async function reportCardPdf(ctx: CompanyContext, supplierId: string, meta?: RequestMeta) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const card = await supplierReportCard(ctx, supplierId);
  const summary = await cardSummary(ctx.company.id, card, ctx.company.currency);
  const bytes = await renderOnDemand(ctx, reportCardDocument(ctx, card, summary));
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "Party",
    entityId: card.supplier.id,
    summary: `Made the supplier report card of ${card.supplier.name} (${card.orders.length} orders, ${card.faults.length} faults)`,
  });
  return {
    fileName: documentFileName(ctx.company.name, `Report card ${card.supplier.name}`),
    bytes,
  };
}
