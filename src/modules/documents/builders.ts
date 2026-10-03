import { type Company, type PaymentMethod, Prisma, type RefundKind } from "@prisma/client";

import { amountInWords } from "@/lib/amount-words";
import { dateColumn, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount, formatDay, formatInstantDay } from "@/lib/format";
import type { CompanyContext } from "@/modules/auth/context";
import { registrationNumbers } from "@/modules/companies/letterhead";
import { matrixAxes } from "@/modules/inventory/matrix.service";
import { stockByVariant } from "@/modules/inventory/stock.service";
import {
  type Block,
  type Letterhead,
  type PrintDocument,
  type PrintType,
  type Row,
  TICK,
} from "@/modules/documents/model";
import type { PrintRequest } from "@/modules/documents/schemas";
import { getStatement } from "@/modules/parties/ledger.service";
import {
  getChallanDocument,
  getInvoiceDocument,
  getPackingListDocument,
} from "@/modules/sales/documents.service";
import { getPaymentReceipt } from "@/modules/sales/payment.service";
import { getProforma } from "@/modules/sales/proforma.service";
import { getQuotation } from "@/modules/sales/quotation.service";
import { getRefund } from "@/modules/sales/refund.service";

/*
 * Turns the data behind each document (the same functions the JSON endpoints
 * use, so the PDF never shows anything the screen would not) into the printed
 * model: every label, amount and date formatted the way it is printed, in the
 * company's time zone and currency grouping (12,34,567.50 for taka).
 *
 * Price-free by design: the packing list, the delivery challan and the stock
 * availability sheet carry quantities only.
 *
 * Every document's letterhead also carries the company's BIN and trade licence
 * number from its licence records (buildDocument adds them), so a renewal with
 * a new number prints from then on.
 */

/** How the stored copy is described and filed (GeneratedDocument columns). */
export type DocumentRecord = {
  /** "Invoice INV-2026-00042": the list title, the audit text and the file name. */
  title: string;
  referenceType: string | null;
  referenceId: string | null;
  partyId: string | null;
  periodFrom?: Date | null;
  periodTo?: Date | null;
  options?: Prisma.InputJsonValue;
};

export type BuiltDocument = { model: PrintDocument; record: DocumentRecord };

/** Stock sheets show at most this many styles (each is a table). */
export const MAX_SHEET_STYLES = 100;

const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  BKASH: "bKash",
  NAGAD: "Nagad",
  ROCKET: "Rocket",
  CARD: "Card",
  COURIER_COD: "Courier COD",
  OTHER: "Other",
};

/** What a payment's reference is, by method ("Reference" for the rest). */
const REFERENCE_LABELS: Partial<Record<PaymentMethod, string>> = {
  CHEQUE: "Cheque no.",
  BANK_TRANSFER: "Bank reference",
  BKASH: "Transaction ID",
  NAGAD: "Transaction ID",
  ROCKET: "Transaction ID",
};

// =============================================================================
// Shared pieces
// =============================================================================

const lines = (text: string | null | undefined) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** The letterhead: name, contact lines and the footer line, from the company settings. */
export function letterheadOf(company: Company): Letterhead {
  const legalName = company.legalName?.trim() || null;
  return {
    name: company.name,
    legalName,
    contacts: [
      ...lines(company.address),
      ...[company.phone, company.email, company.website].flatMap(lines),
    ],
    footer:
      company.letterheadFooter?.trim() ||
      [legalName ?? company.name, company.website?.trim()].filter(Boolean).join(" · "),
    primaryColor: company.primaryColor,
    accentColor: company.accentColor,
  };
}

/** "BIN: 000123456-0101", "Trade licence: TRAD/DNCC/123": the lines under the contact details. */
export function registrationLines(numbers: {
  bin: string | null;
  tradeLicense: string | null;
}): string[] {
  return [
    numbers.bin ? `BIN: ${numbers.bin}` : null,
    numbers.tradeLicense ? `Trade licence: ${numbers.tradeLicense}` : null,
  ].filter((l): l is string => l !== null);
}

const money = (value: Prisma.Decimal.Value, currency: string) => formatAmount(value, 2, currency);
const count = (value: number, currency: string) => formatAmount(value, 0, currency);
const isPositive = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).gt(0);

/** "12,500.00 Dr" (owed to us), "3,000.00 Cr" (we owe), "0.00". */
export function drCr(value: Prisma.Decimal.Value, currency: string): string {
  const d = new Prisma.Decimal(value);
  if (d.isZero()) return money(0, currency);
  return `${money(d.abs(), currency)} ${d.gt(0) ? "Dr" : "Cr"}`;
}

type PartyLike = {
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
};

function partyLines(party: PartyLike, address?: string | null): string[] {
  return [
    party.name,
    party.contactPerson ? `Attn: ${party.contactPerson}` : null,
    party.phone ?? null,
    party.email ?? null,
    ...lines(address ?? party.address),
    party.taxId ? `BIN / Tax ID: ${party.taxId}` : null,
  ].filter((l): l is string => Boolean(l));
}

/** "S 20 · M 40 · L 40", sizes in the company's size order (null when there are none). */
export function sizeBreakdownText(
  breakdown: Prisma.JsonValue | null,
  sizeOrder: Map<string, number>,
  currency: string,
): string | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const entries = Object.entries(breakdown)
    .filter(([, qty]) => typeof qty === "number" && qty > 0)
    .map(([size, qty], index) => ({ size, qty: qty as number, index }));
  if (entries.length === 0) return null;
  const rank = (size: string) => sizeOrder.get(size.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  entries.sort((a, b) => rank(a.size) - rank(b.size) || a.index - b.index);
  return entries.map((e) => `${e.size} ${count(e.qty, currency)}`).join(" · ");
}

function sizesLine(
  breakdown: Prisma.JsonValue | null,
  sizeOrder: Map<string, number>,
  currency: string,
): string | null {
  const text = sizeBreakdownText(breakdown, sizeOrder, currency);
  return text ? `Sizes: ${text}` : null;
}

/** The company's sizes in their sort order, by upper-case name. */
export async function sizeOrderOf(ctx: CompanyContext) {
  const sizes = await ctx.db.size.findMany({ select: { name: true, sortOrder: true } });
  return new Map(sizes.map((s) => [s.name.toUpperCase(), s.sortOrder]));
}

function customFieldText(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDay(value);
  if (Array.isArray(value)) return value.map(customFieldText).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

const textBlock = (title: string, text: string | null | undefined): Block[] =>
  text?.trim() ? [{ kind: "text", title, paragraphs: text.trim().split(/\r?\n/) }] : [];

/** Quotation-style item rows (# / description / qty / unit price / amount). */
function quotedItemRows(
  items: Array<{
    description: string;
    fabric: string | null;
    colorNote: string | null;
    sizeBreakdown: Prisma.JsonValue | null;
    quantity: number;
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    style?: { code: string; name: string } | null;
    category?: { name: string } | null;
  }>,
  sizeOrder: Map<string, number>,
  currency: string,
): Row[] {
  return items.map((item, i) => ({
    cells: [
      String(i + 1),
      item.description,
      count(item.quantity, currency),
      money(item.unitPrice, currency),
      money(item.lineTotal, currency),
    ],
    details: [
      [
        item.style ? `Style: ${item.style.code} ${item.style.name}` : null,
        item.category ? `Category: ${item.category.name}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      item.fabric ? `Fabric: ${item.fabric}` : "",
      item.colorNote ? `Colour: ${item.colorNote}` : "",
      sizesLine(item.sizeBreakdown, sizeOrder, currency) ?? "",
    ].filter(Boolean),
  }));
}

const quotedColumns = (currency: string) => [
  { label: "#", align: "right" as const, weight: 0.45 },
  { label: "Description", weight: 4.4 },
  { label: "Qty", align: "right" as const, weight: 0.9 },
  { label: `Unit price (${currency})`, align: "right" as const, weight: 1.5 },
  { label: `Amount (${currency})`, align: "right" as const, weight: 1.6 },
];

function paymentsTable(
  payments: Array<{
    number: string;
    paymentDate: Date;
    amount: Prisma.Decimal;
    method: PaymentMethod;
    reference?: string | null;
  }>,
  currency: string,
  timeZone: string,
): Block[] {
  if (payments.length === 0) return [];
  return [
    {
      kind: "table",
      title: "Payments received",
      columns: [
        { label: "Date", weight: 1.2 },
        { label: "Receipt", weight: 1.4 },
        { label: "Method", weight: 1.2 },
        { label: "Reference", weight: 1.6 },
        { label: `Amount (${currency})`, align: "right", weight: 1.4 },
      ],
      rows: payments.map((p) => ({
        cells: [
          formatInstantDay(p.paymentDate, timeZone),
          p.number,
          PAYMENT_METHODS[p.method],
          p.reference?.trim() || "–",
          money(p.amount, currency),
        ],
      })),
    },
  ];
}

/** How a refund was settled, as printed. */
const REFUND_KINDS: Record<RefundKind, string> = {
  CASH: "Paid back",
  CREDIT: "Credit on account",
  FORFEIT: "Cancellation charge",
};

/** Refunds that are not void, under the payments they came out of. */
function refundsTable(
  refunds: Array<{
    number: string;
    refundDate: Date;
    amount: Prisma.Decimal;
    kind: RefundKind;
    method: PaymentMethod | null;
    voidedAt?: Date | null;
  }>,
  currency: string,
  timeZone: string,
): Block[] {
  const live = refunds.filter((r) => !r.voidedAt);
  if (live.length === 0) return [];
  return [
    {
      kind: "table",
      title: "Refunds",
      columns: [
        { label: "Date", weight: 1.2 },
        { label: "Voucher", weight: 1.4 },
        { label: "Settled as", weight: 2.8 },
        { label: `Amount (${currency})`, align: "right", weight: 1.4 },
      ],
      rows: live.map((r) => ({
        cells: [
          formatInstantDay(r.refundDate, timeZone),
          r.number,
          r.kind === "CASH" && r.method
            ? `${REFUND_KINDS.CASH} (${PAYMENT_METHODS[r.method]})`
            : REFUND_KINDS[r.kind],
          money(r.amount, currency),
        ],
      })),
    },
  ];
}

function base(
  ctx: CompanyContext,
  type: PrintType,
  fields: Partial<PrintDocument> & Pick<PrintDocument, "title">,
): PrintDocument {
  return {
    type,
    letterhead: letterheadOf(ctx.company),
    meta: [],
    parties: [],
    blocks: [],
    signatures: [],
    ...fields,
  };
}

// =============================================================================
// Sales documents
// =============================================================================

export async function quotationDocument(
  ctx: CompanyContext,
  quotationId: string,
): Promise<BuiltDocument> {
  const q = await getQuotation(ctx, quotationId);
  const tz = ctx.company.timezone;
  const currency = q.currency;
  const sizeOrder = await sizeOrderOf(ctx);
  const totals = [
    { label: "Subtotal", value: money(q.subtotal, currency) },
    ...(isPositive(q.discount)
      ? [{ label: "Discount", value: `-${money(q.discount, currency)}` }]
      : []),
    ...(isPositive(q.tax) ? [{ label: "VAT / tax", value: money(q.tax, currency) }] : []),
    { label: `Total (${currency})`, value: money(q.total, currency), strong: true },
  ];
  const model = base(ctx, "QUOTATION", {
    title: "Quotation",
    reference: q.number,
    meta: [
      { label: "Quotation no.", value: q.number },
      { label: "Date", value: formatInstantDay(q.issueDate, tz) },
      ...(q.validUntil
        ? [{ label: "Valid until", value: formatInstantDay(q.validUntil, tz) }]
        : []),
    ],
    parties: [{ heading: "Prepared for", lines: partyLines(q.party) }],
    blocks: [
      {
        kind: "table",
        columns: quotedColumns(currency),
        rows: quotedItemRows(q.items, sizeOrder, currency),
      },
      { kind: "totals", rows: totals, words: amountInWords(q.total, currency) },
      ...(q.stylingRules.length > 0
        ? [
            {
              kind: "list" as const,
              title: "Styling instructions",
              items: q.stylingRules.map((r) => ({
                label: r.area ?? undefined,
                text: r.instruction,
              })),
            },
          ]
        : []),
      ...(q.customFieldValues.length > 0
        ? [
            {
              kind: "list" as const,
              title: "Specifications",
              items: q.customFieldValues.map((f) => ({
                label: f.label,
                text: customFieldText(f.value),
              })),
            },
          ]
        : []),
      ...textBlock("Terms & conditions", q.terms),
      ...textBlock("Notes", q.notes),
    ],
    signatures: ["Authorised signature"],
  });
  return {
    model,
    record: {
      title: `Quotation ${q.number}`,
      referenceType: "Quotation",
      referenceId: q.id,
      partyId: q.partyId,
    },
  };
}

export async function proformaDocument(
  ctx: CompanyContext,
  proformaId: string,
): Promise<BuiltDocument> {
  const pi = await getProforma(ctx, proformaId);
  const tz = ctx.company.timezone;
  const quotation = pi.quotation;
  const currency = quotation?.currency ?? ctx.company.currency;
  const sizeOrder = await sizeOrderOf(ctx);
  const percent = new Prisma.Decimal(pi.advancePercent).toDecimalPlaces(2).toString();
  const totals = [
    ...(quotation
      ? [
          { label: "Subtotal", value: money(quotation.subtotal, currency) },
          ...(isPositive(quotation.discount)
            ? [{ label: "Discount", value: `-${money(quotation.discount, currency)}` }]
            : []),
          ...(isPositive(quotation.tax)
            ? [{ label: "VAT / tax", value: money(quotation.tax, currency) }]
            : []),
        ]
      : []),
    { label: `Total (${currency})`, value: money(pi.total, currency), strong: true },
    { label: `Advance (${percent}%)`, value: money(pi.advanceAmount, currency) },
    {
      label: pi.refunds.some((r) => !r.voidedAt)
        ? "Advance received, less refunds"
        : "Advance received",
      value: money(pi.advancePaid, currency),
    },
    { label: "Advance due", value: money(pi.advanceDue, currency), strong: true },
    { label: "Balance due", value: money(pi.balanceDue, currency) },
  ];
  const model = base(ctx, "PROFORMA_INVOICE", {
    title: "Proforma Invoice",
    reference: pi.number,
    stamp: pi.status === "CANCELLED" ? { text: "Cancelled", tone: "danger" } : undefined,
    meta: [
      { label: "Proforma no.", value: pi.number },
      { label: "Date", value: formatInstantDay(pi.issueDate, tz) },
      ...(quotation ? [{ label: "Quotation", value: quotation.number }] : []),
    ],
    parties: [{ heading: "Bill to", lines: partyLines(pi.party) }],
    blocks: [
      {
        kind: "table",
        columns: quotedColumns(currency),
        rows: quotation ? quotedItemRows(quotation.items, sizeOrder, currency) : [],
        empty: "Items as agreed.",
      },
      { kind: "totals", rows: totals, words: amountInWords(pi.total, currency) },
      ...paymentsTable(pi.payments, currency, tz),
      ...refundsTable(pi.refunds, currency, tz),
      { kind: "note", text: "Production starts when the advance is received." },
      ...textBlock("Terms & conditions", quotation?.terms),
    ],
    signatures: ["Authorised signature"],
  });
  return {
    model,
    record: {
      title: `Proforma invoice ${pi.number}`,
      referenceType: "ProformaInvoice",
      referenceId: pi.id,
      partyId: pi.partyId,
    },
  };
}

export async function invoiceDocument(
  ctx: CompanyContext,
  invoiceId: string,
): Promise<BuiltDocument> {
  const inv = await getInvoiceDocument(ctx, invoiceId);
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const hasLineDiscount = inv.items.some((i) => isPositive(i.discount));
  const totals = [
    { label: "Subtotal", value: money(inv.subtotal, currency) },
    ...(isPositive(inv.discount)
      ? [{ label: "Discount", value: `-${money(inv.discount, currency)}` }]
      : []),
    ...(isPositive(inv.shippingCharge)
      ? [{ label: "Delivery charge", value: money(inv.shippingCharge, currency) }]
      : []),
    ...(isPositive(inv.tax) ? [{ label: "VAT / tax", value: money(inv.tax, currency) }] : []),
    { label: `Total (${currency})`, value: money(inv.total, currency), strong: true },
    ...(isPositive(inv.paidAmount)
      ? [
          {
            label: inv.refunds.length > 0 ? "Paid, less refunds" : "Paid",
            value: money(inv.paidAmount, currency),
          },
        ]
      : []),
    { label: "Due", value: money(inv.dueAmount, currency), strong: true },
  ];
  const model = base(ctx, "COMMERCIAL_INVOICE", {
    title: "Commercial Invoice",
    reference: inv.number,
    stamp:
      inv.status === "VOID"
        ? { text: "Void", tone: "danger" }
        : inv.status === "PAID"
          ? { text: "Paid", tone: "success" }
          : undefined,
    meta: [
      { label: "Invoice no.", value: inv.number },
      { label: "Date", value: formatInstantDay(inv.issueDate, tz) },
      ...(inv.dueDate ? [{ label: "Due date", value: formatInstantDay(inv.dueDate, tz) }] : []),
      { label: "Order no.", value: inv.orderNumber },
    ],
    parties: [{ heading: "Bill to", lines: partyLines(inv.buyer) }],
    blocks: [
      {
        kind: "table",
        columns: [
          { label: "#", align: "right", weight: 0.45 },
          { label: "Item", weight: hasLineDiscount ? 3.6 : 4.4 },
          { label: "Qty", align: "right", weight: 0.8 },
          { label: `Unit price (${currency})`, align: "right", weight: 1.5 },
          ...(hasLineDiscount ? [{ label: "Discount", align: "right" as const, weight: 1.1 }] : []),
          { label: `Amount (${currency})`, align: "right", weight: 1.6 },
        ],
        rows: inv.items.map((item, i) => ({
          cells: [
            String(i + 1),
            `${item.style} – ${item.color} / ${item.size}`,
            count(item.quantity, currency),
            money(item.unitPrice, currency),
            ...(hasLineDiscount
              ? [isPositive(item.discount) ? money(item.discount, currency) : "–"]
              : []),
            money(item.lineTotal, currency),
          ],
          details: [item.sku],
        })),
      },
      { kind: "totals", rows: totals, words: amountInWords(inv.total, currency) },
      ...paymentsTable(inv.payments, currency, tz),
      ...refundsTable(inv.refunds, currency, tz),
    ],
    signatures: ["Customer signature", "Authorised signature"],
  });
  return {
    model,
    record: {
      title: `Invoice ${inv.number}`,
      referenceType: "Invoice",
      referenceId: inv.id,
      partyId: "id" in inv.buyer ? inv.buyer.id : null,
    },
  };
}

const cartonCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Cartons in counting order ("2" before "10", "C-2" before "C-10"); loose pieces (none) last. */
function compareCartons(a: string | null, b: string | null): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return cartonCollator.compare(a, b);
}

/**
 * The pick-list / packing list: every SKU with its pieces and a tick box for
 * picking (ticked once picked in the system). Lines packed in cartons are sorted
 * by carton, with each carton's pieces when there is more than one.
 */
export async function packingListDocument(
  ctx: CompanyContext,
  packingListId: string,
): Promise<BuiltDocument> {
  const pl = await getPackingListDocument(ctx, packingListId);
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const { order } = pl;
  const receiver: PartyLike = order.party ?? {
    name: order.customerName ?? "Walk-in customer",
    phone: order.customerPhone,
  };

  const items = pl.items.map((item) => ({ ...item, carton: item.cartonNo?.trim() || null }));
  const byCarton = items.some((i) => i.carton !== null);
  // Within a carton the lines keep the order they were added in (the sort is stable).
  if (byCarton) items.sort((a, b) => compareCartons(a.carton, b.carton));
  const groups: Array<{ carton: string | null; items: typeof items }> = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && compareCartons(last.carton, item.carton) === 0) last.items.push(item);
    else groups.push({ carton: item.carton, items: [item] });
  }

  const rows: Row[] = [];
  let line = 0;
  for (const group of groups) {
    for (const item of group.items) {
      line += 1;
      rows.push({
        cells: [
          byCarton ? (item.carton ?? "Loose") : String(line),
          item.variant.sku,
          item.variant.style.name,
          item.variant.color.name,
          item.variant.size.name,
          count(item.quantity, currency),
          item.isPicked ? TICK : "",
        ],
      });
    }
    if (byCarton && groups.length > 1) {
      const pieces = group.items.reduce((sum, i) => sum + i.quantity, 0);
      rows.push({
        cells: [
          "",
          "",
          group.carton === null ? "Loose pieces" : `Carton ${group.carton} total`,
          "",
          "",
          count(pieces, currency),
          "",
        ],
        style: "subtotal",
      });
    }
  }
  rows.push({
    cells: ["", "", "Total pieces", "", "", count(pl.totalPieces, currency), ""],
    style: "total",
  });

  const model = base(ctx, "PACKING_LIST", {
    title: "Packing List",
    reference: pl.number,
    meta: [
      { label: "Packing list no.", value: pl.number },
      { label: "Date", value: formatInstantDay(pl.createdAt, tz) },
      { label: "Order no.", value: order.number },
      ...(pl.cartons !== null ? [{ label: "Cartons", value: count(pl.cartons, currency) }] : []),
      ...(pl.grossWeightKg !== null
        ? [{ label: "Gross weight", value: `${formatAmount(pl.grossWeightKg, 2, currency)} kg` }]
        : []),
      {
        label: "Picked",
        value: `${count(pl.pickedPieces, currency)} of ${count(pl.totalPieces, currency)} pcs`,
      },
    ],
    parties: [
      {
        heading: "Deliver to",
        lines: partyLines(receiver, order.shippingAddress ?? receiver.address),
      },
    ],
    blocks: [
      {
        kind: "table",
        columns: [
          byCarton
            ? { label: "Carton", weight: 0.9 }
            : { label: "#", align: "right" as const, weight: 0.45 },
          { label: "SKU", weight: 2.1 },
          { label: "Item", weight: 2.2 },
          { label: "Colour", weight: 1.2 },
          { label: "Size", weight: 0.75 },
          { label: "Qty (pcs)", align: "right", weight: 0.95 },
          { label: "Picked", align: "center", weight: 0.75, check: true },
        ],
        rows,
        empty: "No items on this packing list.",
      },
      ...textBlock("Notes", pl.notes),
      {
        kind: "note",
        text: "A ticked box means the line is picked. This packing list carries no prices.",
      },
    ],
    signatures: ["Packed by", "Checked by", "Authorised signature"],
  });
  return {
    model,
    record: {
      title: `Packing list ${pl.number}`,
      referenceType: "PackingList",
      referenceId: pl.id,
      partyId: order.party?.id ?? null,
    },
  };
}

export async function challanDocument(
  ctx: CompanyContext,
  challanId: string,
): Promise<BuiltDocument> {
  const ch = await getChallanDocument(ctx, challanId);
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const { order } = ch;
  const receiver: PartyLike = order.party ?? {
    name: order.customerName ?? "Walk-in customer",
    phone: order.customerPhone,
  };
  const driver = [ch.driverName, ch.driverPhone].filter(Boolean).join(", ");
  const model = base(ctx, "DELIVERY_CHALLAN", {
    title: "Delivery Challan",
    reference: ch.number,
    meta: [
      { label: "Challan no.", value: ch.number },
      { label: "Date", value: formatInstantDay(ch.deliveryDate, tz) },
      { label: "Order no.", value: order.number },
      ...(ch.vehicleNo ? [{ label: "Vehicle no.", value: ch.vehicleNo }] : []),
      ...(driver ? [{ label: "Driver", value: driver }] : []),
    ],
    parties: [
      {
        heading: "Deliver to",
        lines: partyLines(receiver, order.shippingAddress ?? receiver.address),
      },
    ],
    blocks: [
      {
        kind: "table",
        columns: [
          { label: "#", align: "right", weight: 0.45 },
          { label: "SKU", weight: 2.2 },
          { label: "Item", weight: 2.4 },
          { label: "Colour", weight: 1.2 },
          { label: "Size", weight: 0.8 },
          { label: "Qty (pcs)", align: "right", weight: 1 },
        ],
        rows: [
          ...ch.items.map((item, i) => ({
            cells: [
              String(i + 1),
              item.sku,
              item.style,
              item.color,
              item.size,
              count(item.quantity, currency),
            ],
          })),
          {
            cells: ["", "", "Total pieces", "", "", count(ch.totalPieces, currency)],
            style: "total" as const,
          },
        ],
      },
      ...(ch.receivedBy ? [{ kind: "note" as const, text: `Received by: ${ch.receivedBy}` }] : []),
      ...textBlock("Notes", ch.notes),
      {
        kind: "note",
        text: "Please check the goods on delivery and sign below. This challan carries no prices.",
      },
    ],
    signatures: ["Received by (name, signature & date)", "Authorised signature"],
  });
  return {
    model,
    record: {
      title: `Delivery challan ${ch.number}`,
      referenceType: "DeliveryChallan",
      referenceId: ch.id,
      partyId: order.party?.id ?? null,
    },
  };
}

/**
 * The money receipt for a payment from a buyer: who paid, how much (in words),
 * how and against what, and where the proforma or order stood once it was paid.
 * The position counts payments up to this one only, so printing the receipt
 * again later shows the same figures.
 */
export async function receiptDocument(
  ctx: CompanyContext,
  paymentId: string,
): Promise<BuiltDocument> {
  const r = await getPaymentReceipt(ctx, paymentId);
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const { order, proforma } = r;
  const invoice = order?.invoice && order.invoice.status !== "VOID" ? order.invoice : null;
  const payer: PartyLike = r.party ?? {
    name: order?.customerName ?? "Walk-in customer",
    phone: order?.customerPhone,
    address: order?.shippingAddress,
  };
  const particulars = proforma
    ? `Advance against proforma invoice ${proforma.number}`
    : order
      ? r.isAdvance
        ? `Advance against order ${order.number}`
        : invoice
          ? `Payment against invoice ${invoice.number}`
          : `Payment against order ${order.number}`
      : "Payment on account";

  const received = new Prisma.Decimal(r.receivedToDate ?? 0);
  const left = (total: Prisma.Decimal) => Prisma.Decimal.max(total.minus(received), 0);
  const receivedHint = isPositive(r.refundedToDate ?? 0)
    ? `Up to this receipt, less ${money(r.refundedToDate!, currency)} refunded`
    : "Up to this receipt";
  const position: Block[] = [];
  if (proforma) {
    const percent = new Prisma.Decimal(proforma.advancePercent).toDecimalPlaces(2).toString();
    position.push({
      kind: "figures",
      figures: [
        { label: "Proforma total", value: money(proforma.total, currency), hint: proforma.number },
        { label: `Advance (${percent}%)`, value: money(proforma.advanceAmount, currency) },
        { label: "Total received", value: money(received, currency), hint: receivedHint },
        {
          label: "Advance due",
          value: money(left(proforma.advanceAmount), currency),
          hint: `Balance due ${money(left(proforma.total), currency)}`,
        },
      ],
    });
  } else if (order) {
    position.push({
      kind: "figures",
      figures: [
        { label: "Order total", value: money(order.total, currency), hint: order.number },
        { label: "Total received", value: money(received, currency), hint: receivedHint },
        {
          label: "Balance due",
          value: money(left(order.total), currency),
          hint: "After this receipt",
        },
      ],
    });
  }

  const reference = r.reference?.trim();
  const model = base(ctx, "PAYMENT_RECEIPT", {
    title: "Money Receipt",
    reference: r.number,
    meta: [
      { label: "Receipt no.", value: r.number },
      { label: "Date", value: formatInstantDay(r.paymentDate, tz) },
      { label: "Payment method", value: PAYMENT_METHODS[r.method] },
      ...(reference
        ? [{ label: REFERENCE_LABELS[r.method] ?? "Reference", value: reference }]
        : []),
      ...(proforma ? [{ label: "Proforma no.", value: proforma.number }] : []),
      ...(order ? [{ label: "Order no.", value: order.number }] : []),
      ...(invoice ? [{ label: "Invoice no.", value: invoice.number }] : []),
    ],
    parties: [
      {
        heading: "Received with thanks from",
        lines: partyLines(payer),
      },
    ],
    blocks: [
      {
        kind: "table",
        columns: [
          { label: "Particulars", weight: 5 },
          { label: `Amount (${currency})`, align: "right", weight: 1.6 },
        ],
        rows: [{ cells: [particulars, money(r.amount, currency)] }],
      },
      {
        kind: "totals",
        rows: [{ label: `Received (${currency})`, value: money(r.amount, currency), strong: true }],
        words: amountInWords(r.amount, currency),
      },
      ...position,
      ...textBlock("Notes", r.notes),
      ...(r.method === "CHEQUE"
        ? [
            {
              kind: "note" as const,
              text: "Paid by cheque: this receipt holds once the cheque is cleared.",
            },
          ]
        : []),
    ],
    signatures: ["Received by", "Authorised signature"],
  });
  return {
    model,
    record: {
      title: `Money receipt ${r.number}`,
      referenceType: "Payment",
      referenceId: r.id,
      partyId: r.partyId,
    },
  };
}

const REFUND_TITLES: Record<RefundKind, { title: string; record: string; heading: string }> = {
  CASH: { title: "Refund Voucher", record: "Refund voucher", heading: "Paid to" },
  CREDIT: { title: "Credit Note", record: "Credit note", heading: "Credited to" },
  FORFEIT: { title: "Cancellation Charge", record: "Cancellation charge", heading: "Buyer" },
};

/**
 * Refund voucher: money a buyer paid, taken back off a proforma, an order or
 * their account. Paid back it is a voucher the buyer signs for; kept as credit
 * on their account it is a credit note; kept by the company it is a
 * cancellation charge note. The position counts what the proforma (or order)
 * held up to this refund, so printing it again later shows the same figures.
 */
export async function refundDocument(
  ctx: CompanyContext,
  refundId: string,
): Promise<BuiltDocument> {
  const r = await getRefund(ctx, refundId);
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const { order, proforma } = r;
  const titles = REFUND_TITLES[r.kind];
  const buyer: PartyLike = r.party ?? {
    name: order?.customerName ?? "Walk-in customer",
    phone: order?.customerPhone,
    address: order?.shippingAddress,
  };
  const from = proforma
    ? `the advance paid on proforma invoice ${proforma.number}`
    : order
      ? `the money paid on order ${order.number}`
      : "credit on the buyer's account";
  const particulars =
    r.kind === "CASH"
      ? `Refund of ${from}`
      : r.kind === "CREDIT"
        ? `${from.charAt(0).toUpperCase()}${from.slice(1)}, kept as credit on the buyer's account`
        : `Cancellation charge kept from ${from}`;

  const position: Block[] = [];
  const against = proforma ?? order;
  if (against && r.heldBefore && r.heldAfter) {
    position.push({
      kind: "figures",
      figures: [
        {
          label: `${proforma ? "Proforma" : "Order"} total`,
          value: money(against.total, currency),
          hint: against.number,
        },
        {
          label: "Paid before",
          value: money(r.heldBefore, currency),
          hint: "Received, less earlier refunds",
        },
        { label: "Paid after", value: money(r.heldAfter, currency), hint: "Less this voucher" },
      ],
    });
  }

  const reference = r.reference?.trim();
  const model = base(ctx, "REFUND_VOUCHER", {
    title: titles.title,
    reference: r.number,
    stamp: r.voidedAt ? { text: "Void", tone: "danger" } : undefined,
    meta: [
      { label: "Voucher no.", value: r.number },
      { label: "Date", value: formatInstantDay(r.refundDate, tz) },
      ...(r.method ? [{ label: "Paid by", value: PAYMENT_METHODS[r.method] }] : []),
      ...(reference && r.method
        ? [{ label: REFERENCE_LABELS[r.method] ?? "Reference", value: reference }]
        : reference
          ? [{ label: "Reference", value: reference }]
          : []),
      ...(proforma ? [{ label: "Proforma no.", value: proforma.number }] : []),
      ...(order ? [{ label: "Order no.", value: order.number }] : []),
    ],
    parties: [{ heading: titles.heading, lines: partyLines(buyer) }],
    blocks: [
      {
        kind: "table",
        columns: [
          { label: "Particulars", weight: 5 },
          { label: `Amount (${currency})`, align: "right", weight: 1.6 },
        ],
        rows: [
          { cells: [particulars, money(r.amount, currency)], details: [`Reason: ${r.reason}`] },
        ],
      },
      {
        kind: "totals",
        rows: [
          {
            label: `${r.kind === "CASH" ? "Paid back" : r.kind === "CREDIT" ? "Credited" : "Kept"} (${currency})`,
            value: money(r.amount, currency),
            strong: true,
          },
        ],
        words: amountInWords(r.amount, currency),
      },
      ...position,
      ...textBlock("Notes", r.notes),
      ...(r.kind === "CREDIT"
        ? [
            {
              kind: "note" as const,
              text: "This credit stays on the buyer's account and counts against what they owe on later invoices.",
            },
          ]
        : []),
      ...(r.voidedAt
        ? [{ kind: "note" as const, text: `Voided: ${r.voidReason ?? "no reason given"}` }]
        : []),
    ],
    signatures:
      r.kind === "CASH" ? ["Received by", "Authorised signature"] : ["Authorised signature"],
  });
  return {
    model,
    record: {
      title: `${titles.record} ${r.number}`,
      referenceType: "Refund",
      referenceId: r.id,
      partyId: r.partyId,
    },
  };
}

// =============================================================================
// Buyer / supplier statement
// =============================================================================

const STATEMENT_LIMIT = 10_000; // getStatement's row cap

export async function statementDocument(
  ctx: CompanyContext,
  input: Extract<PrintRequest, { type: "LEDGER_STATEMENT" }>,
  now: Date,
): Promise<BuiltDocument> {
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const st = await getStatement(ctx, input.partyId, { from: input.from, to: input.to });
  const asOf = input.to ?? localDay(now, tz);
  const period = input.from
    ? `${formatDay(input.from)} – ${formatDay(asOf)}`
    : input.to
      ? `Up to ${formatDay(input.to)}`
      : "All transactions";
  const { party, summary } = st;
  const company = ctx.company.name;
  const closing = new Prisma.Decimal(summary.closingBalance);
  const position = closing.gt(0)
    ? `${party.name} owes ${company} ${money(closing, currency)} ${currency}.`
    : closing.lt(0)
      ? `${company} owes ${party.name} ${money(closing.abs(), currency)} ${currency}.`
      : "The account is settled: nothing is owed either way.";
  const hints =
    party.kind === "BUYER"
      ? { debit: "Invoices and charges", credit: "Payments and returns" }
      : party.kind === "SUPPLIER"
        ? { debit: "Payments and returns", credit: "Bills" }
        : { debit: "Billed to them, paid to them", credit: "Received, billed by them" };

  const rows: Row[] = [
    ...(input.from
      ? [
          {
            cells: [
              formatDay(input.from),
              "",
              "Opening balance",
              "",
              "",
              drCr(summary.openingBalance, currency),
            ],
            style: "subtotal" as const,
          },
        ]
      : []),
    ...st.lines.map((l) => ({
      cells: [
        formatInstantDay(l.date, tz),
        l.number,
        l.description?.trim() || l.memo?.trim() || l.account,
        isPositive(l.debit) ? money(l.debit, currency) : "",
        isPositive(l.credit) ? money(l.credit, currency) : "",
        drCr(l.balance, currency),
      ],
      details: l.memo?.trim() && l.description?.trim() ? [l.memo.trim()] : [],
    })),
  ];
  if (st.lines.length > 0) {
    rows.push({
      cells: [
        formatDay(asOf),
        "",
        "Closing balance",
        money(summary.totalDebit, currency),
        money(summary.totalCredit, currency),
        drCr(summary.closingBalance, currency),
      ],
      style: "total",
    });
  }

  const transactions = `${count(st.lines.length, currency)} transaction${st.lines.length === 1 ? "" : "s"}`;
  const model = base(ctx, "LEDGER_STATEMENT", {
    title: "Statement of Account",
    subtitle: `${party.name} (${party.code})`,
    reference: party.code,
    meta: [
      { label: "Statement date", value: formatDay(asOf) },
      { label: "Period", value: period },
      { label: "Account", value: party.code },
    ],
    parties: [{ heading: "Account of", lines: partyLines(party) }],
    blocks: [
      {
        kind: "figures",
        figures: [
          {
            label: "Opening balance",
            value: drCr(summary.openingBalance, currency),
            hint: input.from ? `On ${formatDay(input.from)}` : "Start of the account",
          },
          { label: "Total debit", value: money(summary.totalDebit, currency), hint: hints.debit },
          {
            label: "Total credit",
            value: money(summary.totalCredit, currency),
            hint: hints.credit,
          },
          {
            label: "Closing balance",
            value: drCr(summary.closingBalance, currency),
            hint: `On ${formatDay(asOf)}`,
          },
        ],
      },
      {
        kind: "text",
        title: "Balance",
        paragraphs: [
          position,
          st.lines.length > 0
            ? `${transactions} in this period, listed date by date on the following pages.`
            : "There are no transactions in this period.",
        ],
      },
      ...(st.lines.length >= STATEMENT_LIMIT
        ? [
            {
              kind: "note" as const,
              text: `Only the first ${count(STATEMENT_LIMIT, currency)} transactions fit in one statement; choose a shorter period for the rest.`,
            },
          ]
        : []),
      ...(st.lines.length > 0
        ? [
            { kind: "pageBreak" as const },
            {
              kind: "table" as const,
              title: "Transactions",
              columns: [
                { label: "Date", weight: 1.1 },
                { label: "Voucher", weight: 1.3 },
                { label: "Details", weight: 3.3 },
                { label: "Debit", align: "right" as const, weight: 1.25 },
                { label: "Credit", align: "right" as const, weight: 1.25 },
                { label: "Balance", align: "right" as const, weight: 1.5 },
              ],
              rows,
            },
          ]
        : []),
    ],
    signatures: ["Authorised signature"],
  });
  return {
    model,
    record: {
      title: `Statement: ${party.name} (${period})`,
      referenceType: "Party",
      referenceId: party.id,
      partyId: party.id,
      periodFrom: input.from ? dateColumn(input.from) : null,
      periodTo: dateColumn(asOf),
      options: { from: input.from ?? null, to: input.to ?? null },
    },
  };
}

// =============================================================================
// Stock availability sheet (price-free)
// =============================================================================

export async function stockSheetDocument(
  ctx: CompanyContext,
  input: Extract<PrintRequest, { type: "STOCK_AVAILABILITY" }>,
  now: Date,
): Promise<BuiltDocument> {
  const tz = ctx.company.timezone;
  const currency = ctx.company.currency;
  const styleIds = input.styleIds ? [...new Set(input.styleIds)].sort() : undefined;
  if (!styleIds && !input.brandId) {
    throw new AppError("VALIDATION", "Choose the styles or a brand to show.");
  }
  const [brand, warehouse] = await Promise.all([
    input.brandId ? ctx.db.brand.findUnique({ where: { id: input.brandId } }) : null,
    input.warehouseId ? ctx.db.warehouse.findUnique({ where: { id: input.warehouseId } }) : null,
  ]);
  if (input.brandId && !brand) throw new AppError("NOT_FOUND", "Brand not found.");
  if (input.warehouseId && !warehouse) throw new AppError("NOT_FOUND", "Warehouse not found.");

  const styles = await ctx.db.style.findMany({
    where: styleIds
      ? { id: { in: styleIds }, ...(brand ? { brandId: brand.id } : {}) }
      : { brandId: brand!.id, isActive: true },
    include: { variants: { include: { color: true, size: true } } },
    orderBy: [{ code: "asc" }, { id: "asc" }],
    take: MAX_SHEET_STYLES + 1,
  });
  if (styleIds && styles.length !== styleIds.length) {
    throw new AppError(
      "NOT_FOUND",
      brand
        ? "One or more styles were not found in this brand."
        : "One or more styles were not found.",
    );
  }
  if (styles.length > MAX_SHEET_STYLES) {
    throw new AppError(
      "VALIDATION",
      `This brand has more than ${MAX_SHEET_STYLES} styles; choose the styles to show.`,
    );
  }
  const stock = await stockByVariant(
    ctx,
    styles.flatMap((s) => s.variants.map((v) => v.id)),
    warehouse?.id,
  );

  // Sellable pieces only, never below zero (a force-override sale can dip under).
  const sellable = (variantId: string) => Math.max(0, stock.get(variantId)?.available ?? 0);
  const blocks: Block[] = [];
  let shown = 0;
  let leftOut = 0;
  let pieces = 0;
  for (const style of styles) {
    const { colors, sizes } = matrixAxes(style.variants);
    const byCell = new Map(style.variants.map((v) => [`${v.colorId}:${v.sizeId}`, v]));
    const columnTotals = sizes.map(() => 0);
    const rows: Row[] = colors.map((color) => {
      let total = 0;
      const cells = sizes.map((size, i) => {
        const variant = byCell.get(`${color.id}:${size.id}`);
        if (!variant || !variant.isActive) return "–";
        const qty = sellable(variant.id);
        total += qty;
        columnTotals[i]! += qty;
        return count(qty, currency);
      });
      return { cells: [color.name, ...cells, count(total, currency)], swatch: color.hexCode };
    });
    const styleTotal = columnTotals.reduce((a, b) => a + b, 0);
    if (styleTotal === 0 && !styleIds && !input.includeEmpty) {
      leftOut += 1;
      continue;
    }
    shown += 1;
    pieces += styleTotal;
    blocks.push({
      kind: "table",
      title: `${style.code} · ${style.name}`,
      columns: [
        { label: "Colour", weight: 2.4 },
        ...sizes.map((s) => ({ label: s.name, align: "right" as const })),
        { label: "Total", align: "right", weight: 1.2 },
      ],
      rows: [
        ...rows,
        {
          cells: [
            "Total",
            ...columnTotals.map((t) => count(t, currency)),
            count(styleTotal, currency),
          ],
          style: "total",
        },
      ],
      empty: "No colours or sizes set up for this style yet.",
    });
  }
  if (shown === 0)
    blocks.push({ kind: "note", text: "Nothing is in stock for these styles right now." });
  if (leftOut > 0) {
    blocks.push({
      kind: "note",
      text: `${count(leftOut, currency)} style${leftOut === 1 ? "" : "s"} with nothing in stock ${leftOut === 1 ? "is" : "are"} left out.`,
    });
  }
  blocks.push({
    kind: "note",
    text: "Pieces ready to ship: first-quality stock less pieces already set aside for orders. A dash means the size is not offered in that colour.",
  });

  const today = localDay(now, tz);
  const scope = brand
    ? `Brand: ${brand.name}`
    : styles.length === 1
      ? `${styles[0]!.code} · ${styles[0]!.name}`
      : `${count(styles.length, currency)} styles`;
  const model = base(ctx, "STOCK_AVAILABILITY", {
    title: "Stock Availability",
    subtitle: `${scope} · ${count(pieces, currency)} pieces`,
    reference: formatDay(today),
    meta: [
      { label: "As of", value: formatDay(today) },
      { label: "Warehouse", value: warehouse?.name ?? "All warehouses" },
      { label: "Styles", value: count(shown, currency) },
    ],
    blocks,
  });
  const single = !brand && styles.length === 1 ? styles[0]! : null;
  return {
    model,
    record: {
      title: `Stock availability: ${brand?.name ?? (single ? single.name : `${count(styles.length, currency)} styles`)} (${formatDay(today)})`,
      referenceType: brand ? "Brand" : single ? "Style" : null,
      referenceId: brand?.id ?? single?.id ?? null,
      partyId: null,
      options: {
        styleIds: styleIds ?? null,
        brandId: brand?.id ?? null,
        warehouseId: warehouse?.id ?? null,
        includeEmpty: input.includeEmpty ?? false,
      },
    },
  };
}

// =============================================================================
// Blank letterhead pad
// =============================================================================

export function letterheadDocument(ctx: CompanyContext): BuiltDocument {
  return {
    model: base(ctx, "LETTERHEAD", { title: "" }),
    record: { title: "Blank letterhead", referenceType: null, referenceId: null, partyId: null },
  };
}

async function buildModel(
  ctx: CompanyContext,
  input: PrintRequest,
  now: Date,
): Promise<BuiltDocument> {
  switch (input.type) {
    case "QUOTATION":
      return quotationDocument(ctx, input.id);
    case "PROFORMA_INVOICE":
      return proformaDocument(ctx, input.id);
    case "COMMERCIAL_INVOICE":
      return invoiceDocument(ctx, input.id);
    case "PACKING_LIST":
      return packingListDocument(ctx, input.id);
    case "DELIVERY_CHALLAN":
      return challanDocument(ctx, input.id);
    case "PAYMENT_RECEIPT":
      return receiptDocument(ctx, input.id);
    case "REFUND_VOUCHER":
      return refundDocument(ctx, input.id);
    case "LEDGER_STATEMENT":
      return statementDocument(ctx, input, now);
    case "STOCK_AVAILABILITY":
      return stockSheetDocument(ctx, input, now);
    case "LETTERHEAD":
      return letterheadDocument(ctx);
  }
}

/**
 * The printed model and its record for any print request, on a letterhead that
 * carries the BIN and trade licence number on file (nothing is added when the
 * company has recorded neither, so those documents print as before).
 */
export async function buildDocument(
  ctx: CompanyContext,
  input: PrintRequest,
  now: Date,
): Promise<BuiltDocument> {
  const [built, numbers] = await Promise.all([
    buildModel(ctx, input, now),
    registrationNumbers(ctx.company.id),
  ]);
  const registrations = registrationLines(numbers);
  if (registrations.length === 0) return built;
  return {
    ...built,
    model: { ...built.model, letterhead: { ...built.model.letterhead, registrations } },
  };
}
