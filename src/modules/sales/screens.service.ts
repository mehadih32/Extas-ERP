import type {
  CustomFieldType,
  InvoiceStatus,
  PartyGrade,
  PaymentMethod,
  Prisma,
  ProductionStage,
  ProductionStatus,
  RefundKind,
  SalesChannel,
} from "@prisma/client";

import { dateOnly, dayRange, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { assertAllowed } from "@/lib/verdict";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { listSizes } from "@/modules/inventory/catalog.service";
import { getStyleMatrix } from "@/modules/inventory/matrix.service";
import { listCategoryOptions } from "@/modules/inventory/screens.service";
import { listWarehouses } from "@/modules/inventory/stock.service";
import { listStyles } from "@/modules/inventory/style.service";
import { balancesFor } from "@/modules/parties/ledger.service";
import { isWalkIn } from "@/modules/parties/walk-in";
import { canStartFromOrder, canStartFromProforma } from "@/modules/production/rules";
import { ORDER_CHANNELS, RECEIVE_METHODS } from "@/modules/sales/choices";
import { listCustomFields } from "@/modules/sales/custom-fields.service";
import {
  deliveredByVariant,
  getInvoiceDocument,
  listInvoices,
} from "@/modules/sales/documents.service";
import { getOrder, listOrders, listPackers } from "@/modules/sales/order.service";
import { prisma } from "@/lib/prisma";
import { chequeFigures, listCheques } from "@/modules/sales/cheque.service";
import { creditPosition, returnCreditOnOrder } from "@/modules/sales/credit.service";
import { getPaymentReceipt, listPayments } from "@/modules/sales/payment.service";
import { getProforma, listProformas } from "@/modules/sales/proforma.service";
import { getQuotation, listQuotations } from "@/modules/sales/quotation.service";
import { listRefunds } from "@/modules/sales/refund.service";
import { returnsOf } from "@/modules/sales/return.service";
import {
  canCancelOrder,
  canCancelProforma,
  canConvertProforma,
  canConvertQuotation,
  canCreateChallan,
  canCreatePackingList,
  canDeleteQuotation,
  canEditOrder,
  canEditProformaDetails,
  canEditQuotation,
  canIssueInvoice,
  canReceiveOnOrder,
  canReceiveOnProforma,
  canSetLogistics,
  canRefundOrder,
  canRefundProforma,
  canReturnOnInvoice,
  canSetShipmentDate,
  canVoidInvoice,
  canVoidRefund,
  canVoidRefundAs,
  isProformaExpired,
  liveInvoice,
  quotationMarks,
  settleKinds,
} from "@/modules/sales/rules";
import { money } from "@/modules/sales/totals";

/*
 * What the Sales screens show, as plain values (amounts as "12500.00" strings,
 * days as "2026-10-08" in company time), with what the person looking may do
 * decided by the same permissions and rules the sales actions enforce:
 *   sales.quotation.manage    quotations, and cancelling a proforma
 *   sales.order.create        orders, invoices, packing lists and challans
 *   sales.invoice.edit        voiding an invoice (and cancelling an invoiced order)
 *   sales.force_override      selling beyond the stock available
 *   accounts.receipts.record  money received; keeping a refund as the buyer's credit;
 *                             sales returns (credit notes)
 *   accounts.payments.record  money paid back to a buyer
 *   accounts.manage           money kept as a cancellation charge
 * and the rules in sales/rules.ts. What goods cost, and the margin, show only to
 * people who see the financials (dashboard.financials or accounts.view).
 */

type Amount = Prisma.Decimal;
const fixed = (value: Amount) => value.toFixed(2);
const isPositive = (value: Amount) => value.gt(0);

/** What this person may do anywhere in Sales (each screen narrows it to the record). */
export function salesAccess(ctx: CompanyContext) {
  return {
    quote: ctx.can("sales.quotation.manage"),
    sell: ctx.can("sales.order.create"),
    voidInvoice: ctx.can("sales.invoice.edit"),
    /** Edit an invoiced order, revising its invoice under the same number (Smart Edit). */
    reviseInvoice: ctx.can("sales.invoice.edit"),
    forceOverride: ctx.can("sales.force_override"),
    receive: ctx.can("accounts.receipts.record"),
    seeCosts: canSeeFinancials(ctx),
    /** Open a buyer's profile (Buyers & suppliers). */
    openBuyer: ctx.can("parties.view"),
    /** "Start production" on an order or a proforma (Production Managers). */
    startProduction: ctx.can("production.manage"),
    /** Open the production projects started from it. */
    openProduction: ctx.can("production.view"),
  };
}

type ProductionRow = {
  id: string;
  code: string;
  name: string;
  stage: ProductionStage;
  status: ProductionStatus;
  targetDate: Date | null;
};

/** The production projects started from an order or a proforma, as their pages list them. */
const presentProduction = (rows: ProductionRow[], tz: string) =>
  rows.map((project) => ({
    id: project.id,
    code: project.code,
    name: project.name,
    stage: project.stage,
    status: project.status,
    targetOn: project.targetDate ? localDay(project.targetDate, tz) : null,
  }));

/**
 * What voiding an order's invoice may also do (Safe Void): cancel the order, so
 * its stock comes back (delivered pieces included) and the money held on it is
 * settled the ways this person may. `note` says why cancelling is not offered.
 */
function voidChoiceFor(
  ctx: CompanyContext,
  order: Parameters<typeof canCancelOrder>[0] & { partyId: string | null },
  delivered: number,
  held: Amount,
) {
  const kinds = settleKinds(ctx, { onAccount: order.partyId !== null });
  const verdict = canCancelOrder(order, delivered, { returnDelivered: true });
  const settleMissing = isPositive(held) && kinds.length === 0;
  return {
    cancel: verdict.ok && !settleMissing,
    /** Pieces delivered, which come back into stock when the order is cancelled. */
    delivered,
    held: fixed(held),
    settleKinds: isPositive(held) ? kinds : [],
    note: !verdict.ok
      ? verdict.message
      : settleMissing
        ? `${fixed(held)} paid on ${order.number} has to be settled by Accounts before the order can be cancelled.`
        : null,
  };
}

export type VoidChoice = ReturnType<typeof voidChoiceFor>;

/** The sales returns on an invoice or order, for its screen ("Returned" panel). */
function presentReturns(rows: Awaited<ReturnType<typeof returnsOf>>, tz: string) {
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    returnedOn: localDay(r.receivedAt, tz),
    pieces: r.items.reduce((s, i) => s + i.quantity, 0),
    amount: fixed(r.amount),
    voided: r.voidedAt !== null,
  }));
}

/** Pieces on returns that stand (not void). */
const piecesBack = (returns: ReturnType<typeof presentReturns>) =>
  returns.reduce((s, r) => (r.voided ? s : s + r.pieces), 0);

type PartyLike = { id: string; code: string; name: string };
const partyOf = (party: PartyLike | null) =>
  party ? { id: party.id, code: party.code, name: party.name } : null;

// =============================================================================
// Pickers: buyers, styles and a style's matrix
// =============================================================================

/**
 * Buyers to choose for a quotation or order (open accounts) or a payment on
 * account (any buyer, as money can still come in on a closing account). Walk-in
 * customers is never chosen: a sale without a buyer leaves it empty. The
 * balance shows to people who see buyers' accounts.
 */
export async function findBuyers(
  ctx: CompanyContext,
  query: { search?: string; purpose?: "SALE" | "PAYMENT" } = {},
) {
  const search = (query.search ?? "").trim().slice(0, 100);
  const rows = await ctx.db.party.findMany({
    where: {
      kind: { in: ["BUYER", "BOTH"] },
      ...(query.purpose === "PAYMENT" ? {} : { status: { in: ["ACTIVE", "DORMANT"] } }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
              { contactPerson: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 21,
  });
  const buyers = rows.filter((p) => !isWalkIn(p)).slice(0, 20);
  const showBalance = ctx.can("parties.view");
  const balances = showBalance
    ? await balancesFor(
        ctx.company.id,
        buyers.map((b) => b.id),
      )
    : null;
  return buyers.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    phone: b.phone,
    city: b.city,
    grade: b.grade as PartyGrade | null,
    isVerified: b.isVerified,
    status: b.status,
    /** Positive: they owe the company. Null when this person does not see balances. */
    balance: balances ? fixed(balances.get(b.id)!) : null,
  }));
}

export type BuyerOption = Awaited<ReturnType<typeof findBuyers>>[number];

/** Active styles to sell or quote, with their list prices and the pieces ready to sell. */
export async function findSaleStyles(ctx: CompanyContext, query: { search?: string } = {}) {
  const page = await listStyles(ctx, {
    search: (query.search ?? "").trim().slice(0, 100) || undefined,
    take: 20,
  });
  return page.items.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    categoryId: s.categoryId,
    wholesalePrice: s.wholesalePrice.toFixed(2),
    retailPrice: s.retailPrice.toFixed(2),
    available: s.stock.available,
    skuCount: s.variantCount,
  }));
}

export type SaleStyle = Awaited<ReturnType<typeof findSaleStyles>>[number];

/**
 * A style's matrix for order entry: colours by sizes, each SKU with its list
 * prices and the pieces ready to sell in the warehouse (no costs).
 */
export async function getSaleMatrix(ctx: CompanyContext, styleId: string, warehouseId?: string) {
  const style = await ctx.db.style.findUnique({ where: { id: styleId } });
  if (!style) throw new AppError("NOT_FOUND", "Style not found.");
  if (warehouseId && !(await ctx.db.warehouse.findUnique({ where: { id: warehouseId } }))) {
    throw new AppError("NOT_FOUND", "Warehouse not found.");
  }
  const matrix = await getStyleMatrix(ctx, styleId, { warehouseId });
  return {
    style: { ...matrix.style, isActive: style.isActive },
    sizes: matrix.sizes.map((s) => ({ id: s.id, name: s.name })),
    rows: matrix.rows.map((row) => ({
      color: row.color,
      cells: row.cells.map((cell) =>
        cell
          ? {
              variantId: cell.variantId,
              sku: cell.sku,
              isActive: cell.isActive,
              available: cell.available,
              wholesalePrice: cell.wholesalePrice,
              retailPrice: cell.retailPrice,
            }
          : null,
      ),
    })),
  };
}

export type SaleMatrix = Awaited<ReturnType<typeof getSaleMatrix>>;

// =============================================================================
// Quotations
// =============================================================================

type ListedQuotation = Awaited<ReturnType<typeof listQuotations>>["items"][number];

function presentQuotationRow(q: ListedQuotation, tz: string) {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    isExpired: q.isExpired,
    issuedOn: localDay(q.issueDate, tz),
    validUntil: q.validUntil ? localDay(q.validUntil, tz) : null,
    buyer: partyOf(q.party)!,
    itemCount: q._count.items,
    currency: q.currency,
    total: fixed(q.total),
  };
}

export type QuotationRow = ReturnType<typeof presentQuotationRow>;

export async function listQuotationRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listQuotations(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((q) => presentQuotationRow(q, tz)), nextCursor: page.nextCursor };
}

/** The Quotations tab: the first page, and whether this person may write one. */
export async function getQuotationList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listQuotationRows(ctx, raw)), canCreate: salesAccess(ctx).quote };
}

export type QuotationList = Awaited<ReturnType<typeof getQuotationList>>;

type SizeOrder = Map<string, number>;

/** Where each of the company's sizes sits in its size list (S before M before L). */
async function sizeOrder(ctx: CompanyContext): Promise<SizeOrder> {
  return new Map((await listSizes(ctx)).map((s, index) => [s.name, index]));
}

/**
 * A size breakdown as stored ({"S": 20, "M": 40}), as rows in the company's size
 * order (the database keeps the keys in its own order); sizes not on the list last.
 */
function sizesOf(
  value: Prisma.JsonValue | null,
  order: SizeOrder,
): Array<{ size: string; quantity: number }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rank = (size: string) => order.get(size) ?? Number.MAX_SAFE_INTEGER;
  const rows = Object.entries(value as Record<string, unknown>)
    .filter(([, q]) => typeof q === "number")
    .map(([size, quantity]) => ({ size, quantity: quantity as number }))
    .sort((a, b) => rank(a.size) - rank(b.size) || a.size.localeCompare(b.size));
  return rows.length > 0 ? rows : null;
}

/** A custom field's value as text for the screen. */
function fieldText(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value === null || value === undefined ? "" : String(value);
}

type QuotationData = Awaited<ReturnType<typeof getQuotation>>;

function presentQuotationItems(items: QuotationData["items"], order: SizeOrder) {
  return items.map((item) => ({
    id: item.id,
    description: item.description,
    style: item.style ? { id: item.style.id, code: item.style.code, name: item.style.name } : null,
    /** Not from the catalogue: kept on the quotation only, never added to Products. */
    custom: item.styleId === null,
    category: item.category ? { id: item.category.id, name: item.category.name } : null,
    fabric: item.fabric,
    gsm: item.gsm,
    colorNote: item.colorNote,
    sizeRatio: item.sizeRatio,
    accessories: item.accessories,
    /** The reference picture (opens at /api/files/:id), or null. */
    imageId: item.imageId,
    sizes: sizesOf(item.sizeBreakdown, order),
    quantity: item.quantity,
    unitPrice: fixed(item.unitPrice),
    lineTotal: fixed(item.lineTotal),
  }));
}

/** How a bank account reads in a list: "Dutch-Bangla Bank · 1234567890". */
const bankLabel = (b: { bankName: string; accountNumber: string; isActive: boolean }) =>
  `${b.bankName} · ${b.accountNumber}${b.isActive ? "" : " (closed)"}`;

/**
 * The bank accounts a proforma may print as its bank details: the company's open
 * ones, plus the one it already has (even if closed since).
 */
async function bankChoices(ctx: CompanyContext, current?: string | null) {
  const banks = await ctx.db.bankAccount.findMany({
    where: { OR: [{ isActive: true }, ...(current ? [{ id: current }] : [])] },
    select: { id: true, bankName: true, accountNumber: true, isActive: true },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    take: 50,
  });
  return banks.map((b) => ({ id: b.id, label: bankLabel(b) }));
}

/** Days a new proforma stays valid unless changed. */
export const PROFORMA_VALID_DAYS = 15;

/** A calendar day `days` after `day` ("2026-10-11" + 15 = "2026-10-26"). */
function addDays(day: string, days: number) {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * One quotation: buyer, items with their sizes, styling rules, totals, terms and
 * custom fields, its proforma once converted, and what this person may do.
 */
export async function getQuotationScreen(ctx: CompanyContext, quotationId: string) {
  const [q, order] = await Promise.all([getQuotation(ctx, quotationId), sizeOrder(ctx)]);
  const tz = ctx.company.timezone;
  const access = salesAccess(ctx);
  const convert = access.quote && canConvertQuotation(q).ok;
  const today = localDay(new Date(), tz);
  return {
    quotation: {
      id: q.id,
      number: q.number,
      status: q.status,
      isExpired: q.isExpired,
      issuedOn: localDay(q.issueDate, tz),
      validUntil: q.validUntil ? localDay(q.validUntil, tz) : null,
      currency: q.currency,
      buyer: {
        id: q.party.id,
        code: q.party.code,
        name: q.party.name,
        contactPerson: q.party.contactPerson,
        phone: q.party.phone,
        email: q.party.email,
        address: q.party.address,
        grade: q.party.grade,
        isVerified: q.party.isVerified,
      },
      items: presentQuotationItems(q.items, order),
      stylingRules: q.stylingRules.map((r) => ({
        id: r.id,
        area: r.area,
        instruction: r.instruction,
      })),
      subtotal: fixed(q.subtotal),
      discount: fixed(q.discount),
      tax: fixed(q.tax),
      total: fixed(q.total),
      terms: q.terms,
      notes: q.notes,
      customFields: q.customFieldValues.map((f) => ({
        key: f.key,
        label: f.label,
        value: fieldText(f.value),
      })),
      proforma: q.proforma,
    },
    /** The advance a new proforma asks for unless changed (company setting). */
    advancePercent: Number(ctx.company.defaultAdvancePercent),
    /** What "Make a proforma invoice" starts with: today, valid 15 days, the first bank. */
    proformaDefaults: convert
      ? {
          issuedOn: today,
          validUntil: addDays(today, PROFORMA_VALID_DAYS),
          banks: await bankChoices(ctx),
        }
      : null,
    can: {
      edit: access.quote && canEditQuotation(q).ok,
      /** Sent, accepted, rejected: the marks it can take from where it is. */
      marks: access.quote ? quotationMarks(q) : [],
      delete: access.quote && canDeleteQuotation(q).ok,
      convert,
      openBuyer: access.openBuyer,
    },
  };
}

export type QuotationScreen = Awaited<ReturnType<typeof getQuotationScreen>>;

export type QuotationFieldDef = {
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  isRequired: boolean;
};

/**
 * What the quotation form needs: categories, the company's sizes for a size
 * breakdown, the quotation's custom fields, and the quotation when editing
 * (only while it is a draft or sent).
 */
export async function getQuotationForm(ctx: CompanyContext, quotationId?: string) {
  const tz = ctx.company.timezone;
  const [categories, sizes, fields, presets] = await Promise.all([
    listCategoryOptions(ctx),
    listSizes(ctx),
    listCustomFields(ctx, "QUOTATION"),
    ctx.db.sizeRatioPreset.findMany({
      select: { name: true, entries: { select: { sizeId: true, ratio: true } } },
      orderBy: { name: "asc" },
      take: 50,
    }),
  ]);
  let quotation = null;
  if (quotationId) {
    const q = await getQuotation(ctx, quotationId);
    assertAllowed(canEditQuotation(q));
    const values = (q.customFields ?? {}) as Record<string, unknown>;
    quotation = {
      id: q.id,
      number: q.number,
      buyer: { id: q.party.id, code: q.party.code, name: q.party.name },
      issuedOn: localDay(q.issueDate, tz),
      validUntil: q.validUntil ? localDay(q.validUntil, tz) : null,
      items: presentQuotationItems(q.items, new Map(sizes.map((s, index) => [s.name, index]))),
      stylingRules: q.stylingRules.map((r) => ({ area: r.area, instruction: r.instruction })),
      discount: fixed(q.discount),
      tax: fixed(q.tax),
      terms: q.terms,
      notes: q.notes,
      customFields: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          typeof value === "boolean" ? value : fieldText(value),
        ]),
      ) as Record<string, string | boolean>,
    };
  }
  return {
    quotation,
    today: localDay(new Date(), tz),
    currency: ctx.company.currency,
    categories: categories.map((c) => ({ id: c.id, name: c.name, depth: c.depth })),
    sizes: sizes.map((s) => ({ id: s.id, name: s.name })),
    /** Saved size ratios (Products) as size ratio suggestions: "S:M:L:XL = 1:2:2:1". */
    sizeRatios: [
      ...new Set(
        presets
          .map((p) => ratioSuggestion(p.entries, sizes))
          .filter((text): text is string => text !== null),
      ),
    ],
    customFields: fields.map((f): QuotationFieldDef => ({
      key: f.key,
      label: f.label,
      fieldType: f.fieldType,
      options: f.options,
      isRequired: f.isRequired,
    })),
  };
}

export type QuotationForm = Awaited<ReturnType<typeof getQuotationForm>>;

/** A saved ratio written out over the company's sizes, skipping sizes it leaves out. */
function ratioSuggestion(
  entries: Array<{ sizeId: string; ratio: number }>,
  sizes: Array<{ id: string; name: string }>,
): string | null {
  const bySize = new Map(entries.map((e) => [e.sizeId, e.ratio]));
  const used = sizes.filter((s) => (bySize.get(s.id) ?? 0) > 0);
  if (used.length === 0) return null;
  return `${used.map((s) => s.name).join(":")} = ${used.map((s) => bySize.get(s.id)).join(":")}`;
}

// =============================================================================
// Proforma invoices
// =============================================================================

type ListedProforma = Awaited<ReturnType<typeof listProformas>>["items"][number];

function presentProformaRow(p: ListedProforma, tz: string, today: string) {
  const validUntil = dateOnly(p.validUntil);
  return {
    id: p.id,
    number: p.number,
    status: p.status,
    issuedOn: localDay(p.issueDate, tz),
    buyerPoNumber: p.buyerPoNumber,
    validUntil,
    isExpired: isProformaExpired({ status: p.status, validUntil }, today),
    buyer: partyOf(p.party)!,
    total: fixed(p.total),
    advancePercent: Number(p.advancePercent),
    advanceAmount: fixed(p.advanceAmount),
    advancePaid: fixed(p.advancePaid),
  };
}

export type ProformaRow = ReturnType<typeof presentProformaRow>;

export async function listProformaRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listProformas(ctx, raw);
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  return {
    items: page.items.map((p) => presentProformaRow(p, tz, today)),
    nextCursor: page.nextCursor,
  };
}

export type ProformaList = Awaited<ReturnType<typeof listProformaRows>>;

type RefundLine = {
  id: string;
  number: string;
  kind: RefundKind;
  amount: Amount;
  method: PaymentMethod | null;
  refundDate: Date;
  reason: string;
  voidedAt: Date | null;
};

export function presentRefunds(
  ctx: CompanyContext,
  refunds: RefundLine[],
  from: Parameters<typeof canVoidRefund>[1],
) {
  const tz = ctx.company.timezone;
  return refunds.map((r) => ({
    id: r.id,
    number: r.number,
    kind: r.kind,
    amount: fixed(r.amount),
    method: r.method,
    refundedOn: localDay(r.refundDate, tz),
    reason: r.reason,
    voided: r.voidedAt !== null,
    can: {
      /**
       * Undo a refund recorded by mistake: the Accounts key for its kind (and for money
       * paid back, the right to take money in), while it stays open.
       */
      void: canVoidRefundAs(ctx, r.kind).ok && canVoidRefund(r, from).ok,
    },
  }));
}

/**
 * One proforma invoice: the quotation's items, the advance asked for and
 * received, its payments and refunds, the production it started, the order it
 * became, and what this person may do.
 */
export async function getProformaScreen(ctx: CompanyContext, proformaId: string) {
  const [p, order] = await Promise.all([getProforma(ctx, proformaId), sizeOrder(ctx)]);
  const tz = ctx.company.timezone;
  const access = salesAccess(ctx);
  const refunded = p.refunds
    .filter((r) => r.voidedAt === null)
    .reduce((sum, r) => sum.plus(r.amount), money(0));
  const received = p.payments.reduce((sum, r) => sum.plus(r.amount), money(0));
  // Before it converts, what a proforma holds is its advances less its refunds.
  const held = p.status === "CONVERTED" ? money(0) : received.minus(refunded);
  const kinds = settleKinds(ctx, { onAccount: true });
  const cancellable = access.quote && canCancelProforma(p).ok;
  const blockedBySettling = cancellable && isPositive(held) && kinds.length === 0;
  const convertible = canConvertProforma(p);
  const editDetails = access.quote && canEditProformaDetails(p).ok;
  const validUntil = dateOnly(p.validUntil);
  return {
    proforma: {
      id: p.id,
      number: p.number,
      status: p.status,
      issuedOn: localDay(p.issueDate, tz),
      buyerPoNumber: p.buyerPoNumber,
      /** The last day of the offer ("2026-10-26"), or null for no end. */
      validUntil,
      /** Past that day with no advance yet: shown only, nothing is blocked. */
      isExpired: isProformaExpired({ status: p.status, validUntil }, localDay(new Date(), tz)),
      /** The account printed as the bank details, or null. */
      bank: p.bankAccount
        ? {
            id: p.bankAccount.id,
            bankName: p.bankAccount.bankName,
            branch: p.bankAccount.branch,
            accountName: p.bankAccount.accountName,
            accountNumber: p.bankAccount.accountNumber,
            routingNumber: p.bankAccount.routingNumber,
            swiftCode: p.bankAccount.swiftCode,
          }
        : null,
      buyer: {
        id: p.party.id,
        code: p.party.code,
        name: p.party.name,
        contactPerson: p.party.contactPerson,
        phone: p.party.phone,
        address: p.party.address,
      },
      quotation: p.quotation ? { id: p.quotation.id, number: p.quotation.number } : null,
      items: p.quotation ? presentQuotationItems(p.quotation.items, order) : [],
      stylingRules: (p.quotation?.stylingRules ?? []).map((r) => ({
        id: r.id,
        area: r.area,
        instruction: r.instruction,
      })),
      total: fixed(p.total),
      advancePercent: Number(p.advancePercent),
      advanceAmount: fixed(p.advanceAmount),
      advancePaid: fixed(p.advancePaid),
      advanceDue: fixed(p.advanceDue),
      balanceDue: fixed(p.balanceDue),
      payments: p.payments.map((pay) => ({
        id: pay.id,
        number: pay.number,
        amount: fixed(pay.amount),
        method: pay.method,
        paidOn: localDay(pay.paymentDate, tz),
        reference: pay.reference,
      })),
      refunds: presentRefunds(ctx, p.refunds, { proforma: p }),
      production: presentProduction(p.productionProjects, tz),
      order: p.salesOrder,
    },
    /** Money held on it now: advances received less refunds. */
    held: fixed(held),
    /** Bank accounts "Edit the details" offers. */
    banks: editDetails ? await bankChoices(ctx, p.bankAccountId) : [],
    can: {
      /** Buyer PO, validity and bank details, while it is open. */
      editDetails,
      receive: access.receive && canReceiveOnProforma(p).ok,
      convert: access.sell && convertible.ok,
      cancel: cancellable && !blockedBySettling,
      /** How the money held may be settled when it is cancelled. */
      settleKinds: isPositive(held) ? kinds : [],
      refundKinds: canRefundProforma(p, held).ok ? kinds : [],
      openBuyer: access.openBuyer,
      startProduction: access.startProduction && canStartFromProforma(p, p.salesOrder).ok,
      openProduction: access.openProduction,
    },
    /** Why an action this person would have is not offered yet. */
    notes: {
      convert:
        access.sell && !convertible.ok && p.status !== "CANCELLED" && p.status !== "CONVERTED"
          ? convertible.message
          : null,
      cancel: blockedBySettling
        ? `${fixed(held)} paid on ${p.number} has to be settled by Accounts before it can be cancelled.`
        : null,
    },
  };
}

export type ProformaScreen = Awaited<ReturnType<typeof getProformaScreen>>;

// =============================================================================
// Orders
// =============================================================================

type ListedOrder = Awaited<ReturnType<typeof listOrders>>["items"][number];

function presentOrderRow(o: ListedOrder, tz: string) {
  return {
    id: o.id,
    number: o.number,
    channel: o.channel,
    status: o.status,
    orderedOn: localDay(o.orderDate, tz),
    shipmentOn: o.shipmentDate,
    buyer: partyOf(o.party),
    customerName: o.customerName,
    lineCount: o._count.items,
    total: fixed(o.total),
    paid: fixed(o.paidAmount),
    due: fixed(o.dueAmount),
    invoice: o.invoice,
    hasForceOverride: o.hasForceOverride,
  };
}

export type OrderRow = ReturnType<typeof presentOrderRow>;

export async function listOrderRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listOrders(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((o) => presentOrderRow(o, tz)), nextCursor: page.nextCursor };
}

/** The Orders tab: the first page, and whether this person may take an order. */
export async function getOrderList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listOrderRows(ctx, raw)), canCreate: salesAccess(ctx).sell };
}

export type OrderList = Awaited<ReturnType<typeof getOrderList>>;

type OrderData = Awaited<ReturnType<typeof getOrder>>;

/** Sort keys and today's average cost for the SKUs on an order. */
async function variantFacts(ctx: CompanyContext, variantIds: string[]) {
  const rows = await ctx.db.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      avgCost: true,
      color: { select: { sortOrder: true } },
      size: { select: { sortOrder: true } },
    },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Lines grouped by style, colours and sizes in catalogue order, with what is
 * delivered and left. Costs and margins are worked out separately (only for
 * people who see the financials).
 */
function orderLines(order: OrderData, facts: Awaited<ReturnType<typeof variantFacts>>) {
  const byStyle = new Map<
    string,
    { style: { id: string; code: string; name: string }; items: OrderData["items"] }
  >();
  for (const item of order.items) {
    const key = item.variant.styleId;
    const group = byStyle.get(key) ?? {
      style: { id: key, code: item.variant.style.code, name: item.variant.style.name },
      items: [],
    };
    group.items.push(item);
    byStyle.set(key, group);
  }
  const sortKeys = (id: string) => {
    const f = facts.get(id);
    return [f?.color.sortOrder ?? 0, f?.size.sortOrder ?? 0] as const;
  };
  return [...byStyle.values()]
    .sort((a, b) => a.style.code.localeCompare(b.style.code))
    .map(({ style, items }) => {
      const sorted = [...items].sort((a, b) => {
        const [ac, as] = sortKeys(a.variantId);
        const [bc, bs] = sortKeys(b.variantId);
        return (
          ac - bc ||
          a.variant.color.name.localeCompare(b.variant.color.name) ||
          as - bs ||
          a.variant.size.name.localeCompare(b.variant.size.name)
        );
      });
      return {
        style,
        pieces: sorted.reduce((s, i) => s + i.quantity, 0),
        amount: fixed(sorted.reduce((s, i) => s.plus(i.lineTotal), money(0))),
        lines: sorted.map((i) => ({
          id: i.id,
          variantId: i.variantId,
          sku: i.variant.sku,
          color: { name: i.variant.color.name, hexCode: i.variant.color.hexCode },
          size: i.variant.size.name,
          quantity: i.quantity,
          unitPrice: fixed(i.unitPrice),
          discount: fixed(i.discount),
          lineTotal: fixed(i.lineTotal),
          delivered: i.delivered,
          remaining: i.remaining,
          forceOverride: i.forceOverride,
          overrideReason: i.overrideReason,
        })),
      };
    });
}

/**
 * What the goods cost and the margin they earn (financials only): delivered
 * pieces at the cost they left at, the rest at today's average cost. Goods
 * that came back on sales returns are taken off the sales (after their
 * discount share); their cost stays in, as they went to Damage & QC Rejects.
 */
function orderCosts(
  order: OrderData,
  facts: Awaited<ReturnType<typeof variantFacts>>,
  returned: Amount,
) {
  let cost = money(0);
  let estimated = false;
  for (const item of order.items) {
    const unit = item.unitCost ?? facts.get(item.variantId)?.avgCost ?? null;
    if (item.unitCost === null) estimated = true;
    if (unit) cost = cost.plus(unit.times(item.quantity));
  }
  cost = money(cost);
  const netSales = order.subtotal.minus(order.discount);
  const kept = netSales.minus(returned);
  const margin = kept.minus(cost);
  return {
    cost: fixed(cost),
    netSales: fixed(netSales),
    /** Goods back on sales returns, after their discount share (null: none). */
    returned: isPositive(returned) ? fixed(returned) : null,
    margin: fixed(margin),
    marginPercent: kept.gt(0) ? Number(margin.dividedBy(kept).times(100).toFixed(1)) : null,
    /** Some pieces are not delivered yet, so their cost is today's average. */
    estimated,
  };
}

/**
 * One order: buyer or walk-in customer, lines by style with what is delivered,
 * totals with paid and due, its invoice, packing list, challans, payments and
 * refunds, the cost and margin for people who see the financials, and what
 * this person may do.
 */
export async function getOrderScreen(ctx: CompanyContext, orderId: string) {
  const order = await getOrder(ctx, orderId);
  const tz = ctx.company.timezone;
  const access = salesAccess(ctx);
  const facts = await variantFacts(
    ctx,
    order.items.map((i) => i.variantId),
  );
  const delivered = order.items.reduce((s, i) => s + i.delivered, 0);
  const remaining = order.items.reduce((s, i) => s + Math.max(i.remaining, 0), 0);
  const invoice = liveInvoice(order.invoice);
  const held = order.paidAmount;
  const onAccount = order.partyId !== null;
  const kinds = settleKinds(ctx, { onAccount });

  const cancellable = access.sell && canCancelOrder(order, delivered).ok;
  const logistics = access.sell && canSetLogistics(order).ok;
  const needsVoid = cancellable && invoice !== null && !access.voidInvoice;
  const needsSettling = cancellable && isPositive(held) && kinds.length === 0;
  // The buyer's money (previous due, unused credit), for people who see balances or take money.
  const [credits, cheques, position, returnRows, production] = await Promise.all([
    ctx.db.creditAllocation.findMany({
      where: { orderId: order.id, releasedAt: null },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        salesReturnId: true,
        payment: { select: { id: true, number: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    // Cleared cheques show as their money receipt; pending and bounced ones are listed apart.
    ctx.db.cheque.findMany({
      where: { orderId: order.id, status: { not: "CLEARED" } },
      select: {
        id: true,
        chequeNo: true,
        bankName: true,
        amount: true,
        status: true,
        chequeDate: true,
        receivedAt: true,
        payment: { select: { id: true, number: true } },
      },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    }),
    order.partyId && (access.receive || access.openBuyer)
      ? creditPosition(prisma, ctx.company.id, order.partyId)
      : null,
    returnsOf(ctx, { orderId: order.id }),
    // Projects started from it, or from the proforma it came from.
    ctx.db.productionProject.findMany({
      where: {
        OR: [
          { salesOrderId: order.id },
          ...(order.proformaId ? [{ proformaId: order.proformaId }] : []),
        ],
      },
      select: { id: true, code: true, name: true, stage: true, status: true, targetDate: true },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    }),
  ]);
  const due = order.total.minus(order.paidAmount);
  // A website order's return credit steps aside for money paid for the same pieces.
  const returnCredit = order.partyId
    ? money(0)
    : credits.filter((c) => c.salesReturnId !== null).reduce((s, c) => s.plus(c.amount), money(0));
  const returns = presentReturns(returnRows, tz);
  const standing = returns.filter((r) => !r.voided).length;

  return {
    order: {
      id: order.id,
      number: order.number,
      channel: order.channel,
      status: order.status,
      orderedOn: localDay(order.orderDate, tz),
      shipmentOn: order.shipmentDate,
      buyer: order.party
        ? {
            id: order.party.id,
            code: order.party.code,
            name: order.party.name,
            phone: order.party.phone,
            grade: order.party.grade,
            isVerified: order.party.isVerified,
          }
        : null,
      customer: {
        name: order.customerName,
        phone: order.customerPhone,
        address: order.shippingAddress,
      },
      warehouse: order.warehouse?.name ?? null,
      totalCartons: order.totalCartons,
      packedBy: order.packedBy,
      notes: order.notes,
      proforma: order.proforma,
      hasForceOverride: order.hasForceOverride,
      styles: orderLines(order, facts),
      pieces: order.totalPieces,
      delivered,
      remaining,
      subtotal: fixed(order.subtotal),
      discount: fixed(order.discount),
      shippingCharge: fixed(order.shippingCharge),
      tax: fixed(order.tax),
      total: fixed(order.total),
      paid: fixed(order.paidAmount),
      due: fixed(order.dueAmount),
      invoice: order.invoice
        ? {
            id: order.invoice.id,
            number: order.invoice.number,
            status: order.invoice.status,
            revision: order.invoice.revision,
            issuedOn: localDay(order.invoice.issueDate, tz),
            dueOn: order.invoice.dueDate ? localDay(order.invoice.dueDate, tz) : null,
            total: fixed(order.invoice.total),
            paid: fixed(order.invoice.paidAmount),
            due: fixed(order.invoice.dueAmount),
          }
        : null,
      packingList: order.packingList
        ? {
            id: order.packingList.id,
            number: order.packingList.number,
            cartons: order.packingList.cartons,
            pieces: order.packingList.items.reduce((s, i) => s + i.quantity, 0),
          }
        : null,
      challans: order.deliveryChallans.map((c) => ({
        id: c.id,
        number: c.number,
        deliveredOn: localDay(c.deliveryDate, tz),
        pieces: c.items.reduce((s, i) => s + i.quantity, 0),
        vehicleNo: c.vehicleNo,
        receivedBy: c.receivedBy,
      })),
      payments: order.payments.map((p) => ({
        id: p.id,
        number: p.number,
        amount: fixed(p.amount),
        method: p.method,
        paidOn: localDay(p.paymentDate, tz),
        isAdvance: p.isAdvance,
      })),
      refunds: presentRefunds(ctx, order.refunds, { order }),
      /** Sales returns (credit notes) on its invoice, void ones too. */
      returns,
      /** Production projects started from it or from its proforma. */
      production: presentProduction(production, tz),
      /** The buyer's credit (advance balance) put against this order's invoice. */
      credits: credits.map((c) => ({
        id: c.id,
        amount: fixed(c.amount),
        usedOn: localDay(c.createdAt, tz),
        payment: c.payment,
      })),
      cheques: cheques.map((c) => ({
        id: c.id,
        chequeNo: c.chequeNo,
        bankName: c.bankName,
        amount: fixed(c.amount),
        status: c.status,
        chequeDate: dateOnly(c.chequeDate),
        receivedOn: localDay(c.receivedAt, tz),
        payment: c.payment,
      })),
    },
    /** The buyer's previous due and unused credit (null: walk-in, or not for this person). */
    buyerMoney: position
      ? { previousDue: fixed(position.previousDue), credit: fixed(position.credit) }
      : null,
    /** Cost of the goods and the margin: only for people who see the financials. */
    costs: access.seeCosts
      ? orderCosts(
          order,
          facts,
          returnRows
            .filter((r) => r.voidedAt === null)
            .reduce((s, r) => s.plus(r.goodsValue).minus(r.discount), money(0)),
        )
      : null,
    can: {
      receive:
        access.receive &&
        canReceiveOnOrder({ ...order, paidAmount: order.paidAmount.minus(returnCredit) }, delivered)
          .ok,
      /**
       * A website order whose return credit pays part of the due: money received may be up
       * to this (the credit then becomes the customer's to pay back); null otherwise.
       */
      receiveUpTo: returnCredit.gt(0)
        ? fixed((due.gt(0) ? due : money(0)).plus(returnCredit))
        : null,
      /** Money above the due may be kept as the buyer's advance balance (invoiced, named buyer). */
      receiveExtra: access.receive && invoice !== null && order.partyId !== null,
      useCredit:
        access.receive &&
        invoice !== null &&
        order.status !== "CANCELLED" &&
        due.gt(0) &&
        position !== null &&
        position.credit.gt(0),
      issueInvoice: access.sell && canIssueInvoice(order).ok,
      voidInvoice: access.voidInvoice && invoice !== null && canVoidInvoice(invoice, standing).ok,
      /** Record goods coming back on its invoice (Accounts). */
      makeReturn:
        access.receive &&
        invoice !== null &&
        canReturnOnInvoice({ ...invoice, partyId: order.partyId }, order, {
          delivered,
          returned: piecesBack(returns),
        }).ok,
      packingList: access.sell && canCreatePackingList(order).ok,
      challan: access.sell && canCreateChallan(order, remaining).ok,
      shipmentDate: access.sell && canSetShipmentDate(order).ok,
      logistics,
      // With a live invoice, editing revises it (people who may edit invoices).
      edit: access.sell && canEditOrder(order, delivered, { revise: access.reviseInvoice }).ok,
      cancel: cancellable && !needsVoid && !needsSettling,
      /** How the money held may be settled when it is cancelled. */
      settleKinds: isPositive(held) ? kinds : [],
      refundKinds: canRefundOrder(order, held).ok ? kinds : [],
      openBuyer: access.openBuyer,
      startProduction:
        access.startProduction &&
        canStartFromOrder(order, order.party ? { walkIn: isWalkIn(order.party) } : null).ok,
      openProduction: access.openProduction,
    },
    /** What voiding the invoice may also do (only for people who may void it). */
    voidChoice:
      access.voidInvoice && invoice !== null ? voidChoiceFor(ctx, order, delivered, held) : null,
    /** Who can be named as the packer (only when this person may set it). */
    packers: logistics ? await listPackers(ctx, order.packedBy?.id) : [],
    /** Why cancelling, which this person could otherwise do, is not offered. */
    notes: {
      cancel: needsVoid
        ? `Cancelling also voids invoice ${invoice!.number}, which your role may not do.`
        : needsSettling
          ? `${fixed(held)} paid on ${order.number} has to be settled by Accounts before it can be cancelled.`
          : null,
    },
  };
}

export type OrderScreen = Awaited<ReturnType<typeof getOrderScreen>>;

type FormStyle = { styleId: string; unitPrice: string | null; quantities: Record<string, number> };

/**
 * What the order form needs: channels, warehouses, today, payment methods and
 * what this person may do at checkout (sell beyond stock, take money), plus the
 * order when editing (lines by style) or the proforma it is made from.
 */
export async function getOrderForm(
  ctx: CompanyContext,
  from: { orderId?: string; proformaId?: string } = {},
) {
  const tz = ctx.company.timezone;
  const access = salesAccess(ctx);
  const warehouses = (await listWarehouses(ctx)).map((w) => ({
    id: w.id,
    name: w.name,
    isDefault: w.isDefault,
  }));
  let order = null;
  let proforma = null;
  if (from.orderId) {
    const o = await getOrder(ctx, from.orderId);
    assertAllowed(
      canEditOrder(
        o,
        o.items.reduce((s, i) => s + i.delivered, 0),
        { revise: access.reviseInvoice },
      ),
    );
    const revising = liveInvoice(o.invoice);
    const styles = new Map<string, FormStyle & { prices: Set<string>; discounted: boolean }>();
    for (const item of o.items) {
      const block = styles.get(item.variant.styleId) ?? {
        styleId: item.variant.styleId,
        unitPrice: null,
        quantities: {},
        prices: new Set<string>(),
        discounted: false,
      };
      block.quantities[item.variantId] = item.quantity;
      block.prices.add(fixed(item.unitPrice));
      if (item.discount.gt(0)) block.discounted = true;
      styles.set(item.variant.styleId, block);
    }
    order = {
      id: o.id,
      number: o.number,
      channel: o.channel,
      buyer: partyOf(o.party),
      warehouseId: o.warehouseId,
      orderedOn: localDay(o.orderDate, tz),
      shipmentOn: o.shipmentDate,
      styles: [...styles.values()].map((s) => ({
        styleId: s.styleId,
        // One price per style when all its SKUs share it; otherwise each keeps the list price.
        unitPrice: s.prices.size === 1 ? [...s.prices][0]! : null,
        quantities: s.quantities,
        mixedPrices: s.prices.size > 1 || s.discounted,
      })),
      discount: fixed(o.discount),
      shippingCharge: fixed(o.shippingCharge),
      tax: fixed(o.tax),
      notes: o.notes,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      shippingAddress: o.shippingAddress,
      totalCartons: o.totalCartons,
      packedById: o.packedById,
      total: fixed(o.total),
      paid: fixed(o.paidAmount),
      /** The live invoice saving revises (Smart Edit): same number, marked "(Revised)". */
      invoice: revising
        ? { number: revising.number, status: revising.status, revision: revising.revision }
        : null,
    };
  } else if (from.proformaId) {
    const p = await getProforma(ctx, from.proformaId);
    assertAllowed(canConvertProforma(p));
    const items = p.quotation ? presentQuotationItems(p.quotation.items, await sizeOrder(ctx)) : [];
    proforma = {
      id: p.id,
      number: p.number,
      buyer: { id: p.party.id, code: p.party.code, name: p.party.name },
      total: fixed(p.total),
      advancePaid: fixed(p.advancePaid),
      items,
      styleIds: [...new Set(items.map((i) => i.style?.id).filter((id): id is string => !!id))],
    };
  }
  const [packers, ratioPresets] = await Promise.all([
    listPackers(ctx, order?.packedById),
    ctx.db.sizeRatioPreset.findMany({
      select: { id: true, name: true, entries: { select: { sizeId: true, ratio: true } } },
      orderBy: { name: "asc" },
      take: 50,
    }),
  ]);
  return {
    order,
    proforma,
    today: localDay(new Date(), tz),
    currency: ctx.company.currency,
    packers,
    /** Saved size ratios (Products), offered as one-tap Magic Ratio fills. */
    ratioPresets,
    channels: order
      ? [order.channel]
      : proforma
        ? (["B2B_PREORDER"] as SalesChannel[])
        : [...ORDER_CHANNELS],
    warehouses,
    paymentMethods: [...RECEIVE_METHODS],
    can: {
      forceOverride: access.forceOverride,
      /** Money taken at checkout: Accounts' receipts key (not when editing or converting). */
      takePayment: access.receive && !order && !proforma,
      /** Print the buyer's previous due on the new invoice (people who see balances). */
      previousDue: (access.openBuyer || access.receive) && !order && !proforma,
      /** Use the buyer's credit (advance balance) on the new invoice: Accounts. */
      useCredit: access.receive && !order && !proforma,
    },
  };
}

export type OrderForm = Awaited<ReturnType<typeof getOrderForm>>;

// =============================================================================
// Invoices
// =============================================================================

type ListedInvoice = Awaited<ReturnType<typeof listInvoices>>["items"][number];

const OPEN_INVOICE: readonly InvoiceStatus[] = ["UNPAID", "PARTIALLY_PAID"];

function presentInvoiceRow(inv: ListedInvoice, tz: string, now: Date) {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    issuedOn: localDay(inv.issueDate, tz),
    dueOn: inv.dueDate ? localDay(inv.dueDate, tz) : null,
    isOverdue: OPEN_INVOICE.includes(inv.status) && inv.dueDate !== null && inv.dueDate < now,
    buyer: partyOf(inv.party),
    customerName: inv.order.customerName,
    order: { id: inv.order.id, number: inv.order.number, channel: inv.order.channel },
    total: fixed(inv.total),
    paid: fixed(inv.paidAmount),
    due: fixed(inv.dueAmount),
    /** Edited after it was issued (Smart Edit; 0: never). */
    revision: inv.revision,
  };
}

export type InvoiceRow = ReturnType<typeof presentInvoiceRow>;

export async function listInvoiceRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listInvoices(ctx, raw);
  const tz = ctx.company.timezone;
  const now = new Date();
  return {
    items: page.items.map((inv) => presentInvoiceRow(inv, tz, now)),
    nextCursor: page.nextCursor,
  };
}

export type InvoiceList = Awaited<ReturnType<typeof listInvoiceRows>>;

/**
 * One commercial invoice as printed: buyer, items, totals, paid and due, the
 * payments and refunds behind it, and what this person may do.
 */
export async function getInvoiceScreen(ctx: CompanyContext, invoiceId: string) {
  const doc = await getInvoiceDocument(ctx, invoiceId);
  const tz = ctx.company.timezone;
  const access = salesAccess(ctx);
  const { order } = await ctx.db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          paidAmount: true,
          partyId: true,
          warehouseId: true,
          invoice: { select: { number: true, status: true } },
          items: { select: { quantity: true } },
        },
      },
    },
  });
  const [byVariant, returnRows] = await Promise.all([
    deliveredByVariant(prisma, order.id),
    returnsOf(ctx, { invoiceId }),
  ]);
  const delivered = [...byVariant.values()].reduce((a, b) => a + b, 0);
  const returns = presentReturns(returnRows, tz);
  const voidVerdict = canVoidInvoice(doc, returns.filter((r) => !r.voided).length);
  const live = doc.status !== "VOID";
  const mayRevise = access.sell && access.reviseInvoice && live;
  const edit = canEditOrder(order, delivered, { revise: true });
  const buyer = doc.buyer as {
    id?: string;
    code?: string;
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    address?: string | null;
    taxId?: string | null;
  };
  const open = OPEN_INVOICE.includes(doc.status);
  // A website order's return credit steps aside for money paid on it (as on the order page).
  const returnCredit =
    order.partyId || doc.status === "VOID" ? money(0) : await returnCreditOnOrder(prisma, order.id);
  const orderDue = order.total.minus(order.paidAmount);
  return {
    invoice: {
      id: doc.id,
      number: doc.number,
      status: doc.status,
      issuedOn: localDay(doc.issueDate, tz),
      dueOn: doc.dueDate ? localDay(doc.dueDate, tz) : null,
      isOverdue: open && doc.dueDate !== null && doc.dueDate < new Date(),
      /** Times it was edited after it was issued (Smart Edit; 0: never), and the last day. */
      revision: doc.revision,
      revisedOn: doc.revisedAt ? localDay(doc.revisedAt, tz) : null,
      order: { id: order.id, number: order.number, status: order.status },
      /** Its order's packing list, printed as page 2 of the PDF (null: none made). */
      packingList: doc.packingList
        ? {
            number: doc.packingList.number,
            cartons: doc.packingList.cartons,
            packedBy: doc.packingList.packedBy,
            pieces: doc.packingList.totalPieces,
          }
        : null,
      delivered,
      buyer: {
        id: buyer.id ?? null,
        code: buyer.code ?? null,
        name: buyer.name,
        contactPerson: buyer.contactPerson ?? null,
        phone: buyer.phone ?? null,
        address: buyer.address ?? null,
        taxId: buyer.taxId ?? null,
      },
      items: doc.items.map((i, index) => ({
        key: `${i.sku}:${index}`,
        sku: i.sku,
        style: i.style,
        color: i.color,
        size: i.size,
        quantity: i.quantity,
        unitPrice: fixed(i.unitPrice),
        discount: fixed(i.discount),
        lineTotal: fixed(i.lineTotal),
      })),
      pieces: doc.items.reduce((s, i) => s + i.quantity, 0),
      subtotal: fixed(doc.subtotal),
      discount: fixed(doc.discount),
      shippingCharge: fixed(doc.shippingCharge),
      tax: fixed(doc.tax),
      total: fixed(doc.total),
      paid: fixed(doc.paidAmount),
      due: fixed(doc.dueAmount),
      payments: doc.payments.map((p) => ({
        number: p.number,
        paidOn: localDay(p.paymentDate, tz),
        amount: fixed(p.amount),
        method: p.method,
        reference: p.reference,
      })),
      refunds: doc.refunds.map((r) => ({
        number: r.number,
        refundedOn: localDay(r.refundDate, tz),
        amount: fixed(r.amount),
        kind: r.kind,
      })),
      /** Sales returns (credit notes) made on it, void ones too. */
      returns,
      credits: doc.credits.map((c, index) => ({
        key: `${index}`,
        usedOn: localDay(c.date, tz),
        amount: fixed(c.amount),
        paymentNumber: c.paymentNumber,
      })),
      previous: doc.previous
        ? {
            previousDue: fixed(doc.previous.previousDue),
            totalPayable: fixed(doc.previous.totalPayable),
            paid: fixed(doc.previous.paidToward),
            balanceDue: fixed(doc.previous.balanceDue),
          }
        : null,
    },
    can: {
      receive:
        access.receive &&
        (open || returnCredit.gt(0)) &&
        canReceiveOnOrder({ ...order, paidAmount: order.paidAmount.minus(returnCredit) }, delivered)
          .ok,
      /** The most a payment may be when a website return's credit pays part of the due. */
      receiveUpTo: returnCredit.gt(0)
        ? fixed((orderDue.gt(0) ? orderDue : money(0)).plus(returnCredit))
        : null,
      void: access.voidInvoice && voidVerdict.ok,
      /** Record goods coming back on it (Accounts). */
      makeReturn:
        access.receive &&
        canReturnOnInvoice({ ...doc, partyId: order.partyId }, order, {
          delivered: Math.min(
            delivered,
            order.items.reduce((s, i) => s + i.quantity, 0),
          ),
          returned: piecesBack(returns),
        }).ok,
      /** Edit its order, revising the invoice under the same number (Smart Edit). */
      edit: mayRevise && edit.ok,
      /** Share page 1 as a picture (anyone who may print it). */
      share: live,
      openBuyer: access.openBuyer && Boolean(buyer.id),
    },
    /** What voiding may also do (null: this person may not void it). */
    voidChoice:
      access.voidInvoice && live ? voidChoiceFor(ctx, order, delivered, order.paidAmount) : null,
    notes: {
      /** Why editing, which this person could otherwise do, is locked ("fully paid"). */
      edit: mayRevise && !edit.ok ? edit.message : null,
      /** Why voiding, which this person could otherwise do, is not offered (a return stands). */
      void: access.voidInvoice && live && !voidVerdict.ok ? voidVerdict.message : null,
    },
  };
}

export type InvoiceScreen = Awaited<ReturnType<typeof getInvoiceScreen>>;

// =============================================================================
// Payments and refunds
// =============================================================================

type ListedPayment = Awaited<ReturnType<typeof listPayments>>["items"][number];

function presentPaymentRow(p: ListedPayment, tz: string) {
  return {
    id: p.id,
    number: p.number,
    paidOn: localDay(p.paymentDate, tz),
    amount: fixed(p.amount),
    method: p.method,
    reference: p.reference,
    buyer: partyOf(p.party),
    /** What it was paid against: an order, a proforma's advance, or the buyer's account. */
    order: p.order,
    proforma: p.proforma,
    account: p.account.name,
    isAdvance: p.isAdvance,
    hasProof: p.proofFileId !== null,
  };
}

export type PaymentRow = ReturnType<typeof presentPaymentRow>;

export async function listPaymentRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listPayments(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((p) => presentPaymentRow(p, tz)), nextCursor: page.nextCursor };
}

/** The Payments tab's money received, and whether this person may record some. */
export async function getPaymentList(ctx: CompanyContext, raw: unknown = {}) {
  return { ...(await listPaymentRows(ctx, raw)), canReceive: salesAccess(ctx).receive };
}

export type PaymentList = Awaited<ReturnType<typeof getPaymentList>>;

type ListedRefund = Awaited<ReturnType<typeof listRefunds>>["items"][number];

function presentRefundRow(r: ListedRefund, tz: string) {
  return {
    id: r.id,
    number: r.number,
    kind: r.kind,
    amount: fixed(r.amount),
    method: r.method,
    refundedOn: localDay(r.refundDate, tz),
    reason: r.reason,
    voided: r.voidedAt !== null,
    buyer: partyOf(r.party),
    order: r.order,
    proforma: r.proforma,
    /** A website return's credit paid back (CN-005). */
    salesReturn: r.salesReturn,
  };
}

export type RefundRow = ReturnType<typeof presentRefundRow>;

export async function listRefundRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listRefunds(ctx, raw);
  const tz = ctx.company.timezone;
  return { items: page.items.map((r) => presentRefundRow(r, tz)), nextCursor: page.nextCursor };
}

export type RefundList = Awaited<ReturnType<typeof listRefundRows>>;

type ListedCheque = Awaited<ReturnType<typeof listCheques>>["items"][number];

function presentChequeRow(c: ListedCheque, tz: string) {
  return {
    id: c.id,
    chequeNo: c.chequeNo,
    bankName: c.bankName,
    amount: fixed(c.amount),
    chequeDate: dateOnly(c.chequeDate),
    receivedOn: localDay(c.receivedAt, tz),
    status: c.status,
    clearedOn: c.payment ? localDay(c.payment.paymentDate, tz) : null,
    bouncedOn: c.bouncedAt ? localDay(c.bouncedAt, tz) : null,
    bounceReason: c.bounceReason,
    hasProof: c.proofFileId !== null,
    proofFileId: c.proofFileId,
    buyer: partyOf(c.party),
    customerName: c.order?.customerName ?? null,
    order: c.order ? { id: c.order.id, number: c.order.number } : null,
    proforma: c.proforma,
    payment: c.payment ? { id: c.payment.id, number: c.payment.number } : null,
  };
}

export type ChequeRow = ReturnType<typeof presentChequeRow>;

export async function listChequeRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listCheques(ctx, raw);
  const tz = ctx.company.timezone;
  const canManage = salesAccess(ctx).receive;
  return {
    items: page.items.map((c) => presentChequeRow(c, tz)),
    nextCursor: page.nextCursor,
    canManage,
    /** Where a cleared cheque can be deposited (the main bank account first by code). */
    banks: canManage
      ? await ctx.db.ledgerAccount.findMany({
          where: { subType: "BANK", isActive: true },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        })
      : [],
  };
}

export type ChequeList = Awaited<ReturnType<typeof listChequeRows>>;

/**
 * The Payments dashboard: money collected today (less refunds), what buyers
 * still owe on invoices, cheques waiting to clear, and cheques bounced this
 * month. Every figure is one database count or sum.
 */
export async function getPaymentDashboard(ctx: CompanyContext) {
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const monthStart = dayRange(`${today.slice(0, 7)}-01`, undefined, tz).start!;
  const day = dayRange(today, today, tz);
  const range = { gte: day.start!, lt: day.end! };
  const [collected, paidBack, dues, cheques] = await Promise.all([
    ctx.db.payment.aggregate({
      where: { direction: "RECEIVED", paymentDate: range },
      _sum: { amount: true },
    }),
    // Only refunds paid back move money (as on the Sales overview).
    ctx.db.refund.aggregate({
      where: { kind: "CASH", voidedAt: null, refundDate: range },
      _sum: { amount: true },
    }),
    ctx.db.invoice.aggregate({
      where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      _sum: { dueAmount: true },
      _count: { _all: true },
    }),
    chequeFigures(ctx, monthStart),
  ]);
  const received = money(collected._sum.amount ?? 0);
  const refunded = money(paidBack._sum.amount ?? 0);
  return {
    today,
    collectedToday: { value: fixed(received.minus(refunded)), refunded: fixed(refunded) },
    pendingDues: { count: dues._count._all, value: fixed(money(dues._sum.dueAmount ?? 0)) },
    pendingCheques: cheques.pending,
    bouncedCheques: cheques.bounced,
  };
}

export type PaymentDashboard = Awaited<ReturnType<typeof getPaymentDashboard>>;

/** One money receipt: who paid, how, against what, and where it left that order or proforma. */
export async function getPaymentScreen(ctx: CompanyContext, paymentId: string) {
  const p = await getPaymentReceipt(ctx, paymentId);
  const tz = ctx.company.timezone;
  return {
    payment: {
      id: p.id,
      number: p.number,
      paidOn: localDay(p.paymentDate, tz),
      amount: fixed(p.amount),
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      account: p.account.name,
      isAdvance: p.isAdvance,
      buyer: p.party
        ? {
            id: p.party.id,
            code: p.party.code,
            name: p.party.name,
            phone: p.party.phone,
          }
        : p.order
          ? {
              id: null,
              code: null,
              name: p.order.customerName ?? "Walk-in customer",
              phone: p.order.customerPhone,
            }
          : null,
      order: p.order
        ? {
            id: p.order.id,
            number: p.order.number,
            total: fixed(p.order.total),
            due: fixed(p.order.dueAmount),
            invoice: p.order.invoice,
          }
        : null,
      proforma: p.proforma
        ? {
            id: p.proforma.id,
            number: p.proforma.number,
            total: fixed(p.proforma.total),
            advanceAmount: fixed(p.proforma.advanceAmount),
          }
        : null,
      receivedToDate: p.receivedToDate ? fixed(p.receivedToDate) : null,
      refundedToDate: p.refundedToDate ? fixed(p.refundedToDate) : null,
      /** The invoices this money paid straight away (money on the buyer's account). */
      allocations: p.allocations.map((a) => ({
        orderId: a.order.id,
        orderNumber: a.order.number,
        invoiceNumber: a.invoice.number,
        amount: fixed(a.amount),
        released: a.releasedAt !== null,
      })),
      /** On the buyer's account: what this receipt left as their advance balance. */
      advanceKept: p.onAccount ? fixed(p.onAccount.kept) : null,
      /** On the buyer's account: what paid what they owed beyond their invoices. */
      towardEarlier: p.onAccount?.towardEarlier.gt(0) ? fixed(p.onAccount.towardEarlier) : null,
      cheque: p.cheque
        ? {
            chequeNo: p.cheque.chequeNo,
            bankName: p.cheque.bankName,
            chequeDate: dateOnly(p.cheque.chequeDate),
          }
        : null,
      proofFileId: p.proofFileId,
    },
    can: {
      openBuyer: salesAccess(ctx).openBuyer && Boolean(p.party),
      addProof: salesAccess(ctx).receive,
    },
  };
}

export type PaymentScreen = Awaited<ReturnType<typeof getPaymentScreen>>;
