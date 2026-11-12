import { Prisma, type StockGrade, type WholesaleReturn } from "@prisma/client";
import { z } from "zod";

import { dayRange, daysBetween, localDay, startOfDayInZone } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow, lockRows } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { requirePin } from "@/modules/ai/settings.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { gradeCost } from "@/modules/inventory/costs";
import { receiveAtCostTx } from "@/modules/inventory/stock.service";
import { assertPartyCanTransact, recordPartyActivity } from "@/modules/parties/party.service";
import { allocateTx, lockBuyerCredit } from "@/modules/sales/credit.service";
import { createDeliveryChallanTx, issueInvoiceTx } from "@/modules/sales/documents.service";
import { createOrderTx } from "@/modules/sales/order.service";
import { ledgerPartyId } from "@/modules/sales/posting";
import { resolveOrderLines } from "@/modules/sales/pricing";
import { returnPosition, type ReturnPosition, variantText } from "@/modules/sales/return.service";
import { canReturnOnInvoice, statusAfterReturns } from "@/modules/sales/rules";
import { money, returnTotals, ZERO } from "@/modules/sales/totals";

/*
 * Wholesale returns (2026-11-12)
 * ------------------------------
 * A wholesale buyer's return runs in three steps, all on one page:
 *
 *   1. "Receive return"  The buyer, the invoice, the SKU lines and pieces. Only
 *      pieces delivered on that invoice and not already back can come back.
 *      Each line is "Refund" or "Exchange". An exchange names the new SKU
 *      ("Size only": the same style and colour; or "Other product") and pieces,
 *      priced as any wholesale sale (the SKU's wholesale price). The new pieces
 *      leave stock at once on their own order, invoice and delivery challan, so
 *      the buyer owes their price; the returned pieces' credit comes with the
 *      approval and is put against that invoice, so in the end the buyer owes
 *      the difference (or keeps it as credit). The returned pieces wait in
 *      "Returns to check": counted, not sellable, not yet graded. Nothing is
 *      posted for them yet (their cost left with the sale).
 *   2. "Approve"  Someone with sales.returns.approve decides how many of each
 *      line's pieces are refunded (all by default; fewer needs a reason). Above
 *      the company's amount (wholesaleReturnPinAbove, 10,000 at first) the
 *      owner's PIN is asked. The credit note (a SalesReturn, CN-) is posted as
 *      any return's money: Dr Sales, Dr VAT Payable, Cr Receivable (buyer).
 *      Paying the buyer back in cash or by bank stays with Accounts (refunds).
 *      Approval does not wait for QC.
 *   3. "QC"  Someone with sales.returns.qc splits each line's pieces into
 *      A-grade (sellable stock), B-grade (B-grade stock) and Reject (Damage &
 *      QC Rejects); the three must add up to the pieces received. The pieces
 *      come back at the cost they left at: Dr Inventory (A and B), Dr Inventory
 *      Loss (Reject), Cr Cost of Goods Sold, as the old returns did.
 *
 * Mistakes are put right by reversal: voiding the credit note (on its page)
 * undoes the approval and the return waits for approval again; nothing is
 * deleted. Old returns (credit notes recorded at once) stay exactly as they are.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

export type WholesaleReturnStatus = "RECEIVED" | "APPROVED" | "CHECKED" | "DONE";

export function wholesaleReturnStatus(
  r: Pick<WholesaleReturn, "approvedAt" | "checkedAt">,
): WholesaleReturnStatus {
  if (r.approvedAt && r.checkedAt) return "DONE";
  if (r.approvedAt) return "APPROVED";
  if (r.checkedAt) return "CHECKED";
  return "RECEIVED";
}

export const STATUS_TEXT: Record<WholesaleReturnStatus, string> = {
  RECEIVED: "Received",
  APPROVED: "Approved",
  CHECKED: "Checked",
  DONE: "Done",
};

// --- Who may do what --------------------------------------------------------------------

/**
 * Receiving goods back (and sending an exchange's new pieces out): sales staff
 * who make orders and challans, or Accounts (who recorded returns before).
 */
const canReceive = (ctx: Pick<CompanyContext, "can">) =>
  ctx.can("sales.order.create") || ctx.can("accounts.receipts.record");

function assertCanReceive(ctx: CompanyContext) {
  if (!canReceive(ctx)) {
    throw new AppError(
      "FORBIDDEN",
      "Only someone who makes orders and challans, or Accounts, can receive a wholesale return.",
    );
  }
}

function assertCanApprove(ctx: CompanyContext) {
  if (!ctx.can("sales.returns.approve")) {
    throw new AppError(
      "FORBIDDEN",
      "Only someone who approves wholesale returns can decide the refund.",
    );
  }
}

function assertCanCheck(ctx: CompanyContext) {
  if (!ctx.can("sales.returns.qc")) {
    throw new AppError("FORBIDDEN", "Only someone who checks returned goods (QC) can do the QC.");
  }
}

export function wholesaleReturnAccess(ctx: Pick<CompanyContext, "can">) {
  return {
    see: ctx.can("sales.view"),
    receive: canReceive(ctx),
    approve: ctx.can("sales.returns.approve"),
    check: ctx.can("sales.returns.qc"),
    /** Changing the PIN amount: the owner's setting. */
    settings: ctx.can("company.settings"),
  };
}

function assertCanSee(ctx: CompanyContext) {
  const a = wholesaleReturnAccess(ctx);
  if (!a.see && !a.receive && !a.approve && !a.check) {
    throw new AppError("FORBIDDEN", "Wholesale returns are not part of your role.");
  }
}

// --- Schemas -----------------------------------------------------------------------------

const id = z.string().trim().min(1).max(64);
const pieces = z.coerce.number().int().min(1, "At least 1").max(1_000_000);
const reasonText = z.string().trim().min(3, "Write the reason").max(500);

const receiveLineSchema = z
  .object({
    orderItemId: id,
    quantity: pieces,
    mode: z.enum(["REFUND", "EXCHANGE"], { message: "Choose Refund or Exchange" }),
    exchange: z
      .object({
        kind: z.enum(["SIZE", "OTHER"]),
        variantId: id,
        quantity: pieces,
      })
      .optional(),
  })
  .superRefine((line, issue) => {
    if (line.mode === "EXCHANGE" && !line.exchange) {
      issue.addIssue({ code: "custom", path: ["exchange"], message: "Choose the new piece" });
    }
  });

export const receiveWholesaleReturnSchema = z.object({
  invoiceId: id,
  reason: reasonText,
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(receiveLineSchema).min(1, "Add a line").max(200),
});

export const approveWholesaleReturnSchema = z.object({
  /** Pieces refunded per line (all of them when left out). */
  lines: z
    .array(z.object({ lineId: id, refunded: z.coerce.number().int().min(0).max(1_000_000) }))
    .max(200)
    .default([]),
  reason: z.string().trim().max(500).optional(),
  pin: z.string().trim().max(12).optional(),
});

export const checkWholesaleReturnSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: id,
        a: z.coerce.number().int().min(0).max(1_000_000),
        b: z.coerce.number().int().min(0).max(1_000_000),
        reject: z.coerce.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
  note: z.string().trim().max(500).optional(),
});

export const exchangeQuoteSchema = z.object({
  invoiceId: id,
  orderItemId: id,
  quantity: pieces,
  variantId: id,
  newQuantity: pieces,
});

export const wholesaleReturnSettingsSchema = z.object({
  pinAbove: z.coerce.number().min(0, "0 or more").max(1e11),
  pin: z.string().trim().max(12).optional(),
});

export const listWholesaleReturnsSchema = z.object({
  status: z.enum(["RECEIVED", "APPROVED", "CHECKED", "DONE", "OPEN"]).optional(),
  partyId: z.string().trim().max(64).optional(),
  search: z.string().trim().max(100).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

// --- Helpers -----------------------------------------------------------------------------

/** The invoice and its order, for a return on it (the buyer's own, not void). */
async function loadInvoice(db: Db | Tx, companyId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      id: true,
      number: true,
      status: true,
      partyId: true,
      issueDate: true,
      orderId: true,
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          channel: true,
          warehouseId: true,
          subtotal: true,
          discount: true,
          tax: true,
          party: {
            select: { id: true, name: true, code: true, retailStore: { select: { id: true } } },
          },
        },
      },
    },
  });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.");
  if (invoice.order.party?.retailStore) {
    throw new AppError(
      "CONFLICT",
      "A retail store's returns are checked on Business > Retail > Returns, not here.",
    );
  }
  return invoice;
}

/** What one exchange line costs and credits: the new pieces' price less the old ones' credit. */
function exchangeFigures(
  line: ReturnPosition["lines"][number],
  take: number,
  order: { subtotal: Prisma.Decimal; discount: Prisma.Decimal; tax: Prisma.Decimal },
  earlier: ReturnPosition["earlier"],
  newPrice: Prisma.Decimal,
  newQuantity: number,
) {
  const credit = returnTotals({
    lines: [
      {
        lineTotal: line.lineTotal,
        quantity: line.quantity,
        returnedQuantity: line.returned,
        returnedAmount: line.returnedAmount,
        take,
      },
    ],
    invoice: order,
    earlier,
    last: false,
  }).total;
  const newTotal = money(newPrice.times(newQuantity));
  return { credit, newTotal, difference: newTotal.minus(credit) };
}

/** The new SKU of an exchange, checked against the kind: "Size only" keeps style and colour. */
async function checkExchangeSku(
  db: Db | Tx,
  companyId: string,
  oldVariantId: string,
  newVariantId: string,
  kind: "SIZE" | "OTHER",
) {
  const [oldV, newV] = await Promise.all([
    db.productVariant.findFirst({
      where: { id: oldVariantId, companyId },
      select: { id: true, styleId: true, colorId: true, sizeId: true },
    }),
    db.productVariant.findFirst({
      where: { id: newVariantId, companyId },
      select: { id: true, sku: true, styleId: true, colorId: true, sizeId: true },
    }),
  ]);
  if (!oldV || !newV) throw new AppError("VALIDATION", "Choose the new piece.");
  if (newV.id === oldV.id) {
    throw new AppError("VALIDATION", "Choose a different piece for the exchange.", {
      exchange: ["A different size or product"],
    });
  }
  if (kind === "SIZE" && (newV.styleId !== oldV.styleId || newV.colorId !== oldV.colorId)) {
    throw new AppError(
      "VALIDATION",
      `${newV.sku} is not the same style and colour: choose "Other product" for it.`,
      { exchange: ["Same style and colour, another size"] },
    );
  }
  return newV;
}

type PricedLine = Awaited<ReturnType<typeof resolveOrderLines>>[number];

/** The returnable lines of an invoice (for the form) and the exchange choices of each. */
export async function wholesaleReturnForm(ctx: CompanyContext, invoiceId: string) {
  assertCanReceive(ctx);
  const invoice = await loadInvoice(prisma, ctx.company.id, invoiceId);
  if (!invoice.partyId) {
    throw new AppError(
      "CONFLICT",
      "A sale without a buyer takes no wholesale return: its return is recorded as a credit note.",
    );
  }
  const position = await returnPosition(prisma, invoice.orderId);
  const styleIds = [
    ...new Set(
      (
        await ctx.db.productVariant.findMany({
          where: { id: { in: position.lines.map((l) => l.variantId) } },
          select: { styleId: true },
        })
      ).map((v) => v.styleId),
    ),
  ];
  const siblings = await ctx.db.productVariant.findMany({
    where: { styleId: { in: styleIds }, isActive: true },
    select: {
      id: true,
      sku: true,
      styleId: true,
      colorId: true,
      size: { select: { name: true, sortOrder: true } },
    },
    orderBy: [{ size: { sortOrder: "asc" } }],
  });
  const variantOf = new Map(
    (
      await ctx.db.productVariant.findMany({
        where: { id: { in: position.lines.map((l) => l.variantId) } },
        select: { id: true, styleId: true, colorId: true },
      })
    ).map((v) => [v.id, v]),
  );
  return {
    invoice: {
      id: invoice.id,
      number: invoice.number,
      issuedOn: localDay(invoice.issueDate, ctx.company.timezone),
      buyer: invoice.order.party,
      order: { id: invoice.order.id, number: invoice.order.number },
    },
    currency: ctx.company.currency,
    lines: position.lines.map((l) => {
      const v = variantOf.get(l.variantId);
      return {
        orderItemId: l.id,
        variantId: l.variantId,
        sku: l.variant.sku,
        label: variantText(l.variant),
        delivered: l.delivered,
        returned: l.returned + l.held,
        returnable: l.returnable,
        priceBilled: l.priceBilled.toFixed(2),
        /** "Size only" choices: the same style and colour, another size. */
        sizes: siblings
          .filter((s) => v && s.styleId === v.styleId && s.colorId === v.colorId && s.id !== v.id)
          .map((s) => ({ id: s.id, sku: s.sku, size: s.size.name })),
      };
    }),
  };
}

export type WholesaleReturnForm = Awaited<ReturnType<typeof wholesaleReturnForm>>;

/** The live price difference of one exchange line, for the Exchange window. */
export async function exchangeQuote(ctx: CompanyContext, raw: unknown) {
  assertCanReceive(ctx);
  const input = exchangeQuoteSchema.parse(raw);
  const invoice = await loadInvoice(prisma, ctx.company.id, input.invoiceId);
  if (!invoice.order.warehouseId) throw new AppError("CONFLICT", "The order has no warehouse.");
  const position = await returnPosition(prisma, invoice.orderId);
  const line = position.lines.find((l) => l.id === input.orderItemId);
  if (!line) throw new AppError("VALIDATION", "That line is not on this invoice.");
  if (input.quantity > line.returnable) {
    throw new AppError("VALIDATION", `Only ${line.returnable} pcs can come back.`);
  }
  const [priced] = await resolveOrderLines(
    ctx,
    { lines: [{ variantId: input.variantId, quantity: input.newQuantity }] },
    "WHOLESALE",
    invoice.order.warehouseId,
  );
  const f = exchangeFigures(
    line,
    input.quantity,
    invoice.order,
    position.earlier,
    priced!.unitPrice,
    input.newQuantity,
  );
  return {
    sku: priced!.sku,
    unitPrice: priced!.unitPrice.toFixed(2),
    available: priced!.available,
    short: priced!.short,
    newTotal: f.newTotal.toFixed(2),
    credit: f.credit.toFixed(2),
    difference: f.difference.toFixed(2),
  };
}

// --- Step 1: Receive return ---------------------------------------------------------------

/**
 * "Receive return": the pieces come back into "Returns to check" and an
 * exchange's new pieces leave at once (their own order, invoice and challan).
 */
export async function receiveWholesaleReturn(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = receiveWholesaleReturnSchema.parse(raw);
  assertCanReceive(ctx);
  const companyId = ctx.company.id;
  const peek = await loadInvoice(prisma, companyId, input.invoiceId);
  if (!peek.partyId) {
    throw new AppError(
      "CONFLICT",
      "A sale without a buyer takes no wholesale return: its return is recorded as a credit note.",
    );
  }
  const partyId = peek.partyId;
  const warehouseId = peek.order.warehouseId;
  if (!warehouseId) throw new AppError("CONFLICT", "The order has no warehouse.");
  const ids = input.lines.map((l) => l.orderItemId);
  if (new Set(ids).size !== ids.length) {
    throw new AppError("VALIDATION", "A SKU is listed twice: put its pieces on one line.");
  }
  // Exchange pieces: priced and checked for stock as any wholesale sale.
  const exchanges = input.lines.flatMap((l, i) => (l.exchange ? [{ ...l.exchange, i }] : []));
  const priced = exchanges.length
    ? await resolveOrderLines(
        ctx,
        { lines: exchanges.map((e) => ({ variantId: e.variantId, quantity: e.quantity })) },
        "WHOLESALE",
        warehouseId,
      )
    : [];
  const pricedOf = new Map(exchanges.map((e, k) => [e.i, priced[k]!]));
  const wanted = new Map<string, number>();
  for (const p of priced) wanted.set(p.variantId, (wanted.get(p.variantId) ?? 0) + p.quantity);
  for (const p of priced) {
    if ((wanted.get(p.variantId) ?? 0) > p.available) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `Only ${p.available} pcs of ${p.sku} are in stock for the exchange.`,
      );
    }
  }
  if (priced.length) await assertPartyCanTransact(ctx, partyId, "SALE");

  const returnId = await prisma.$transaction(async (tx) => {
    // The buyer's credit first, then the order (the order every credit step locks in).
    await lockBuyerCredit(tx, partyId);
    await lockRow(tx, "SalesOrder", peek.orderId);
    const invoice = await loadInvoice(tx, companyId, peek.id);
    const position = await returnPosition(tx, invoice.orderId);
    assertAllowed(
      canReturnOnInvoice(invoice, invoice.order, {
        delivered: position.delivered,
        returned: position.returned + position.held,
      }),
    );
    const lineOf = new Map(position.lines.map((l) => [l.id, l]));
    const rows = [];
    for (const [i, l] of input.lines.entries()) {
      const line = lineOf.get(l.orderItemId);
      if (!line) {
        throw new AppError("VALIDATION", `Line ${i + 1} was not sold on ${invoice.number}.`, {
          [`lines.${i}.orderItemId`]: ["Choose a SKU of this invoice"],
        });
      }
      if (l.quantity > line.returnable) {
        throw new AppError(
          "VALIDATION",
          line.returnable === 0
            ? `No delivered pieces of ${line.variant.sku} are left to come back.`
            : `Only ${line.returnable} pcs of ${line.variant.sku} were delivered and not already returned.`,
          { [`lines.${i}.quantity`]: [`At most ${line.returnable}`] },
        );
      }
      let exchange = null;
      if (l.exchange) {
        const newV = await checkExchangeSku(
          tx,
          companyId,
          line.variantId,
          l.exchange.variantId,
          l.exchange.kind,
        );
        const p = pricedOf.get(i)!;
        const f = exchangeFigures(
          line,
          l.quantity,
          invoice.order,
          position.earlier,
          p.unitPrice,
          l.exchange.quantity,
        );
        exchange = { kind: l.exchange.kind, variant: newV, priced: p, figures: f };
      }
      rows.push({ input: l, line, exchange });
    }
    const date = new Date();
    const number = await nextDocumentNumber(tx, companyId, "WHOLESALE_RETURN", date);

    // The exchange's new pieces: their own order, invoice and challan (they leave at once).
    let exchangeOrderId: string | null = null;
    const exchangeRows = rows.filter((r) => r.exchange);
    if (exchangeRows.length > 0) {
      const merged = new Map<string, (typeof exchangeRows)[number]["exchange"] & object>();
      const lines: Array<PricedLine & { discount: Prisma.Decimal }> = [];
      for (const r of exchangeRows) {
        const p = r.exchange!.priced;
        const seen = merged.get(p.variantId);
        if (seen) {
          const at = lines.findIndex((x) => x.variantId === p.variantId);
          lines[at] = { ...lines[at]!, quantity: lines[at]!.quantity + p.quantity };
        } else {
          merged.set(p.variantId, r.exchange!);
          lines.push({ ...p, discount: ZERO });
        }
      }
      const exchangeOrder = await createOrderTx(
        tx,
        ctx,
        {
          channel: invoice.order.channel,
          partyId,
          warehouseId,
          lines,
          charges: {},
          notes: `Exchange for wholesale return ${number} (${invoice.number})`,
        },
        meta,
      );
      await issueInvoiceTx(tx, ctx, exchangeOrder.id, {}, meta);
      await createDeliveryChallanTx(tx, ctx, exchangeOrder.id, {}, meta);
      exchangeOrderId = exchangeOrder.id;
    }

    const created = await tx.wholesaleReturn.create({
      data: {
        companyId,
        number,
        orderId: invoice.orderId,
        invoiceId: invoice.id,
        partyId,
        warehouseId,
        reason: input.reason,
        notes: input.notes || null,
        receivedAt: date,
        receivedById: ctx.user.id,
        exchangeOrderId,
        lines: {
          create: rows.map(({ input: l, line, exchange }) => ({
            companyId,
            orderItemId: line.id,
            variantId: line.variantId,
            quantity: l.quantity,
            unitPrice: line.priceBilled,
            unitCost: line.unitCost,
            mode: l.mode,
            exchangeKind: exchange?.kind ?? null,
            newVariantId: exchange?.variant.id ?? null,
            newQuantity: exchange ? exchange.priced.quantity : null,
            newUnitPrice: exchange ? exchange.priced.unitPrice : null,
            priceDifference: exchange ? exchange.figures.difference : ZERO,
          })),
        },
      },
    });
    const received = rows.reduce((s, r) => s + r.input.quantity, 0);
    await tx.salesOrder.update({
      where: { id: invoice.orderId },
      data: {
        status: statusAfterReturns({
          ordered: position.ordered,
          delivered: position.delivered,
          returned: position.returned + position.held + received,
        }),
      },
    });
    await recordPartyActivity(partyId, date, tx);
    const difference = rows.reduce((s, r) => s.plus(r.exchange?.figures.difference ?? 0), ZERO);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "WholesaleReturn",
        entityId: created.id,
        summary: `Wholesale return ${number} received on ${invoice.number} from ${invoice.order.party?.name ?? "the buyer"}: ${received} pcs to check${
          exchangeRows.length > 0
            ? `, ${exchangeRows.reduce((s, r) => s + r.exchange!.priced.quantity, 0)} pcs sent in exchange (difference ${difference.toFixed(2)})`
            : ""
        } — ${input.reason}`,
        after: {
          lines: rows.map(({ input: l, line, exchange }) => ({
            sku: line.variant.sku,
            quantity: l.quantity,
            mode: l.mode,
            ...(exchange
              ? {
                  exchange: exchange.kind,
                  newSku: exchange.variant.sku,
                  newQuantity: exchange.priced.quantity,
                  newUnitPrice: exchange.priced.unitPrice.toFixed(2),
                  difference: exchange.figures.difference.toFixed(2),
                }
              : {}),
          })),
        },
      },
      tx,
    );
    return created.id;
  }, TX_OPTIONS);
  return getWholesaleReturn(ctx, returnId);
}

// --- Step 2: Approve ------------------------------------------------------------------------

/**
 * "Approve": how many pieces of each line are refunded. Posts the credit note
 * (the buyer's due goes down) and puts it against the exchange's invoice first.
 */
export async function approveWholesaleReturn(
  ctx: CompanyContext,
  returnId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = approveWholesaleReturnSchema.parse(raw);
  assertCanApprove(ctx);
  const companyId = ctx.company.id;
  const found = await ctx.db.wholesaleReturn.findUnique({
    where: { id: returnId },
    select: { id: true, partyId: true, orderId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "Wholesale return not found.");
  // Worked out first so the PIN can be asked before anything is posted.
  const plan = await prisma.$transaction(async (tx) => {
    await lockBuyerCredit(tx, found.partyId);
    await lockRow(tx, "SalesOrder", found.orderId);
    await lockRow(tx, "WholesaleReturn", found.id);
    const ret = await tx.wholesaleReturn.findFirstOrThrow({
      where: { id: found.id, companyId },
      include: {
        lines: { orderBy: { id: "asc" } },
        party: { select: { name: true } },
        order: { select: { subtotal: true, discount: true, tax: true } },
      },
    });
    if (ret.approvedAt) throw new AppError("CONFLICT", `${ret.number} is already approved.`);
    const wanted = new Map(input.lines.map((l) => [l.lineId, l.refunded]));
    for (const lineId of wanted.keys()) {
      if (!ret.lines.some((l) => l.id === lineId)) {
        throw new AppError("VALIDATION", "A line is not on this return.");
      }
    }
    const refunds = ret.lines.map((l) => {
      const refunded = wanted.get(l.id) ?? l.quantity;
      if (refunded > l.quantity) {
        throw new AppError("VALIDATION", `At most ${l.quantity} pcs of a line can be refunded.`, {
          [`lines.${l.id}`]: [`At most ${l.quantity}`],
        });
      }
      return { line: l, refunded };
    });
    const fewer = refunds.some((r) => r.refunded < r.line.quantity);
    if (fewer && !input.reason) {
      throw new AppError("VALIDATION", "Write why fewer pieces are refunded than came back.", {
        reason: ["Write the reason"],
      });
    }
    const position = await returnPosition(tx, ret.orderId);
    const lineOf = new Map(position.lines.map((l) => [l.id, l]));
    const taking = refunds.filter((r) => r.refunded > 0);
    const pieces = taking.reduce((s, r) => s + r.refunded, 0);
    const totals =
      taking.length > 0
        ? returnTotals({
            lines: taking.map(({ line, refunded }) => {
              const pos = lineOf.get(line.orderItemId)!;
              return {
                lineTotal: pos.lineTotal,
                quantity: pos.quantity,
                returnedQuantity: pos.returned,
                returnedAmount: pos.returnedAmount,
                take: refunded,
              };
            }),
            invoice: ret.order,
            earlier: position.earlier,
            last: position.returned + pieces >= position.ordered,
          })
        : { amounts: [], goods: ZERO, discount: ZERO, tax: ZERO, total: ZERO };
    return { ret, refunds, taking, totals, fewer, position };
  }, TX_OPTIONS);
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { wholesaleReturnPinAbove: true },
  });
  if (plan.totals.total.gt(company.wholesaleReturnPinAbove)) {
    await requirePin(
      ctx,
      input.pin || undefined,
      `approve a refund of ${plan.totals.total.toFixed(2)} (over ${company.wholesaleReturnPinAbove.toFixed(2)})`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await lockBuyerCredit(tx, found.partyId);
    await lockRow(tx, "SalesOrder", found.orderId);
    await lockRow(tx, "WholesaleReturn", found.id);
    const ret = await tx.wholesaleReturn.findFirstOrThrow({
      where: { id: found.id, companyId },
      include: {
        lines: { orderBy: { id: "asc" } },
        party: { select: { name: true } },
        order: { select: { id: true, subtotal: true, discount: true, tax: true } },
      },
    });
    if (ret.approvedAt) throw new AppError("CONFLICT", `${ret.number} is already approved.`);
    // Nothing may have changed since the figures were worked out (and the PIN asked).
    const position = await returnPosition(tx, ret.orderId);
    if (
      position.returned !== plan.position.returned ||
      position.held !== plan.position.held ||
      !position.earlier.discount.equals(plan.position.earlier.discount)
    ) {
      throw new AppError("CONFLICT", "The invoice's returns changed meanwhile. Try again.");
    }
    const { totals, taking, refunds } = plan;
    const now = new Date();
    let salesReturnId: string | null = null;
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: ret.invoiceId },
      select: { id: true, number: true },
    });
    if (taking.length > 0) {
      const number = await nextDocumentNumber(tx, companyId, "SALES_RETURN", now);
      const credit = await tx.salesReturn.create({
        data: {
          companyId,
          number,
          orderId: ret.orderId,
          invoiceId: ret.invoiceId,
          partyId: ret.partyId,
          warehouseId: ret.warehouseId,
          reason: `Wholesale return ${ret.number}: ${ret.reason}`,
          notes: input.reason ?? null,
          status: ret.checkedAt ? "COMPLETED" : "PENDING_QC",
          receivedAt: ret.receivedAt,
          completedAt: ret.checkedAt ? now : null,
          goodsValue: totals.goods,
          discount: totals.discount,
          tax: totals.tax,
          amount: totals.total,
          costValue: 0,
          createdById: ctx.user.id,
          items: {
            create: taking.map(({ line, refunded }, i) => ({
              variantId: line.variantId,
              orderItemId: line.orderItemId,
              quantity: refunded,
              unitPrice: line.unitPrice,
              amount: totals.amounts[i]!,
              unitCost: line.unitCost,
              // Where the pieces went is on the wholesale return's QC.
              qcStatus: "PENDING",
            })),
          },
        },
      });
      salesReturnId = credit.id;
      const acc = await ensureControlAccounts(companyId, tx);
      const journal = totals.total.gt(0)
        ? await postJournalEntry(tx, {
            companyId,
            date: now,
            description: `Credit note ${number} for wholesale return ${ret.number} from ${ret.party.name} on ${invoice.number}`,
            sourceType: "RETURN",
            sourceId: credit.id,
            postedById: ctx.user.id,
            lines: [
              {
                accountId: acc.SALES,
                debit: totals.goods.minus(totals.discount),
                memo: "Goods returned at the prices billed",
              },
              { accountId: acc.VAT_PAYABLE, debit: totals.tax, memo: "VAT on the goods returned" },
              {
                accountId: acc.RECEIVABLE,
                partyId: await ledgerPartyId(tx, companyId, ret.partyId),
                credit: totals.total,
                memo: `Credit note ${number} / ${ret.number}`,
              },
            ],
          })
        : null;
      if (journal) {
        await tx.salesReturn.update({
          where: { id: credit.id },
          data: { journalEntryId: journal.id },
        });
      }
      // The exchange's new pieces are paid from the credit first.
      if (ret.exchangeOrderId && totals.total.gt(0)) {
        const ex = await tx.salesOrder.findUniqueOrThrow({
          where: { id: ret.exchangeOrderId },
          select: { total: true, paidAmount: true, status: true },
        });
        const due = Prisma.Decimal.max(ex.total.minus(ex.paidAmount), ZERO);
        const use = Prisma.Decimal.min(totals.total, due);
        if (use.gt(0) && ex.status !== "CANCELLED") {
          await allocateTx(tx, ctx, {
            partyId: ret.partyId,
            salesReturnId: credit.id,
            items: [{ orderId: ret.exchangeOrderId, amount: use }],
            limit: totals.total,
          });
        }
      }
    }
    for (const { line, refunded } of refunds) {
      await tx.wholesaleReturnLine.update({ where: { id: line.id }, data: { refunded } });
    }
    await tx.wholesaleReturn.update({
      where: { id: ret.id },
      data: {
        approvedAt: now,
        approvedById: ctx.user.id,
        approveNote: plan.fewer ? (input.reason ?? null) : null,
        salesReturnId,
      },
    });
    const refunded = refunds.reduce((s, r) => s + r.refunded, 0);
    const received = refunds.reduce((s, r) => s + r.line.quantity, 0);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "WholesaleReturn",
        entityId: ret.id,
        summary: `Approved wholesale return ${ret.number}: ${refunded} of ${received} pcs refunded, ${totals.total.toFixed(2)} credited to ${ret.party.name}${
          plan.fewer ? ` — ${input.reason}` : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getWholesaleReturn(ctx, returnId);
}

// --- Step 3: QC -------------------------------------------------------------------------------

/**
 * "QC": each line's pieces split into A-grade, B-grade and Reject; the three
 * add up to the pieces received. The pieces come back at the cost they left at.
 */
export async function checkWholesaleReturn(
  ctx: CompanyContext,
  returnId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = checkWholesaleReturnSchema.parse(raw);
  assertCanCheck(ctx);
  const companyId = ctx.company.id;
  const found = await ctx.db.wholesaleReturn.findUnique({
    where: { id: returnId },
    select: { id: true, orderId: true, lines: { select: { variantId: true } } },
  });
  if (!found) throw new AppError("NOT_FOUND", "Wholesale return not found.");

  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "SalesOrder", found.orderId);
    await lockRow(tx, "WholesaleReturn", found.id);
    const ret = await tx.wholesaleReturn.findFirstOrThrow({
      where: { id: found.id, companyId },
      include: {
        lines: {
          orderBy: { id: "asc" },
          include: { variant: { select: { sku: true } } },
        },
      },
    });
    if (ret.checkedAt) throw new AppError("CONFLICT", `${ret.number} is already checked.`);
    const splitOf = new Map(input.lines.map((l) => [l.lineId, l]));
    const grades = await tx.salesOrderItem.findMany({
      where: { id: { in: ret.lines.map((l) => l.orderItemId) } },
      select: { id: true, grade: true },
    });
    const gradeOf = new Map(grades.map((g) => [g.id, g.grade]));
    const rows = ret.lines.map((line) => {
      const split = splitOf.get(line.id);
      if (!split) {
        throw new AppError("VALIDATION", `Split the pieces of ${line.variant.sku}.`, {
          [`lines.${line.id}`]: ["Split every line"],
        });
      }
      if (split.a + split.b + split.reject !== line.quantity) {
        throw new AppError(
          "VALIDATION",
          `${line.variant.sku}: A-grade, B-grade and Reject must add up to the ${line.quantity} pcs received (now ${split.a + split.b + split.reject}).`,
          { [`lines.${line.id}`]: [`Must add up to ${line.quantity}`] },
        );
      }
      if (split.a > 0 && gradeOf.get(line.orderItemId) === "B_GRADE") {
        throw new AppError(
          "VALIDATION",
          `${line.variant.sku} was sold as B-grade: it comes back as B-grade or Reject.`,
        );
      }
      return { line, split, soldAs: (gradeOf.get(line.orderItemId) ?? "A_GRADE") as StockGrade };
    });
    if (input.lines.length !== ret.lines.length) {
      throw new AppError("VALIDATION", "A line is not on this return.");
    }
    await lockRows(
      tx,
      "ProductVariant",
      ret.lines.map((l) => l.variantId),
    );
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: ret.invoiceId },
      select: { number: true },
    });
    let restocked = ZERO;
    let writtenOff = ZERO;
    for (const { line, split, soldAs } of rows) {
      // A-grade and B-grade: back into that grade's stock at the cost they left at.
      for (const [grade, take] of [
        ["A_GRADE", split.a],
        ["B_GRADE", split.b],
      ] as const) {
        if (take === 0) continue;
        const variant = await tx.productVariant.findUniqueOrThrow({
          where: { id: line.variantId },
          select: { id: true, sku: true, avgCost: true, bGradeAvgCost: true },
        });
        const onHand = await tx.stockBalance.aggregate({
          where: { variantId: variant.id, grade },
          _sum: { quantity: true },
        });
        const key = { variantId: variant.id, warehouseId: ret.warehouseId, grade };
        await tx.stockBalance.upsert({
          where: { variantId_warehouseId_grade: key },
          create: { ...key, companyId, quantity: take },
          update: { quantity: { increment: take } },
        });
        const movement = await tx.stockMovement.create({
          data: {
            ...key,
            companyId,
            type: "RETURN_RESTOCK",
            quantity: take,
            unitCost: line.unitCost,
            referenceType: "WholesaleReturnLine",
            referenceId: line.id,
            note: `${ret.number} from ${invoice.number} (QC ${grade === "B_GRADE" ? "B-grade" : "A-grade"})`,
            createdById: ctx.user.id,
          },
        });
        await receiveAtCostTx(tx, ctx, {
          variant,
          grade,
          onHand: onHand._sum.quantity ?? 0,
          average: gradeCost(variant, grade),
          quantity: take,
          unitCost: line.unitCost,
          movementId: movement.id,
        });
        restocked = restocked.plus(money(line.unitCost.times(take)));
      }
      // Reject: in from the buyer, out to Damage & QC Rejects (in the grade it was sold as).
      if (split.reject > 0) {
        const cost = money(line.unitCost.times(split.reject));
        const key = {
          companyId,
          variantId: line.variantId,
          warehouseId: ret.warehouseId,
          grade: soldAs,
          unitCost: line.unitCost,
          createdById: ctx.user.id,
        };
        await tx.stockMovement.create({
          data: {
            ...key,
            type: "RETURN_RESTOCK",
            quantity: split.reject,
            referenceType: "WholesaleReturnLine",
            referenceId: line.id,
            note: `${ret.number} from ${invoice.number} (QC Reject)`,
          },
        });
        const entry = await tx.badStockEntry.create({
          data: {
            companyId,
            variantId: line.variantId,
            quantity: split.reject,
            unitCost: line.unitCost,
            lossValue: cost,
            source: "RETURN_QC",
            reason: `Wholesale return ${ret.number} (${invoice.number}): ${ret.reason}`,
          },
        });
        await tx.stockMovement.create({
          data: {
            ...key,
            type: "BAD_STOCK_OUT",
            quantity: -split.reject,
            referenceType: "BadStockEntry",
            referenceId: entry.id,
            note: `${ret.number}: QC Reject`,
          },
        });
        writtenOff = writtenOff.plus(cost);
      }
      await tx.wholesaleReturnLine.update({
        where: { id: line.id },
        data: { qcA: split.a, qcB: split.b, qcReject: split.reject },
      });
    }
    const total = restocked.plus(writtenOff);
    const acc = await ensureControlAccounts(companyId, tx);
    const journal = total.gt(0)
      ? await postJournalEntry(tx, {
          companyId,
          description: `QC of wholesale return ${ret.number} (${invoice.number})`,
          sourceType: "RETURN",
          sourceId: ret.id,
          postedById: ctx.user.id,
          lines: [
            ...(restocked.gt(0)
              ? [
                  {
                    accountId: acc.INVENTORY,
                    debit: restocked,
                    memo: "Returned pieces back in stock",
                  },
                ]
              : []),
            ...(writtenOff.gt(0)
              ? [
                  {
                    accountId: acc.INVENTORY_LOSS,
                    debit: writtenOff,
                    memo: "Returned pieces to Damage & QC Rejects",
                  },
                ]
              : []),
            { accountId: acc.COGS, credit: total, memo: ret.number },
          ],
        })
      : null;
    const now = new Date();
    await tx.wholesaleReturn.update({
      where: { id: ret.id },
      data: { checkedAt: now, checkedById: ctx.user.id, qcJournalId: journal?.id ?? null },
    });
    if (ret.salesReturnId) {
      await tx.salesReturn.update({
        where: { id: ret.salesReturnId },
        data: { status: "COMPLETED", completedAt: now, costValue: total },
      });
    }
    const sum = (k: "a" | "b" | "reject") => rows.reduce((s, r) => s + r.split[k], 0);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "WholesaleReturn",
        entityId: ret.id,
        summary: `QC of wholesale return ${ret.number}: ${sum("a")} A-grade, ${sum("b")} B-grade, ${sum("reject")} Reject${
          input.note ? ` — ${input.note}` : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getWholesaleReturn(ctx, returnId);
}

// --- Settings -------------------------------------------------------------------------------

/** The refund above which approving needs the owner's PIN (the owner, with the PIN). */
export async function setWholesaleReturnSettings(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = wholesaleReturnSettingsSchema.parse(raw);
  if (!ctx.can("company.settings")) {
    throw new AppError("FORBIDDEN", "Only the owner can change when the PIN is asked.");
  }
  await requirePin(ctx, input.pin || undefined, "change when a wholesale refund needs the PIN");
  const before = await prisma.company.findUniqueOrThrow({
    where: { id: ctx.company.id },
    select: { wholesaleReturnPinAbove: true },
  });
  const pinAbove = new Prisma.Decimal(input.pinAbove).toDecimalPlaces(2);
  await prisma.company.update({
    where: { id: ctx.company.id },
    data: { wholesaleReturnPinAbove: pinAbove },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Company",
    entityId: ctx.company.id,
    summary: `Wholesale returns: the PIN is asked for refunds over ${pinAbove.toFixed(2)} (was ${before.wholesaleReturnPinAbove.toFixed(2)})`,
  });
}

// --- Reading ---------------------------------------------------------------------------------

const lineSelect = {
  id: true,
  orderItemId: true,
  quantity: true,
  unitPrice: true,
  mode: true,
  exchangeKind: true,
  newQuantity: true,
  newUnitPrice: true,
  priceDifference: true,
  refunded: true,
  qcA: true,
  qcB: true,
  qcReject: true,
  variant: {
    select: {
      sku: true,
      style: { select: { name: true } },
      color: { select: { name: true } },
      size: { select: { name: true } },
    },
  },
  newVariant: {
    select: {
      sku: true,
      style: { select: { name: true } },
      color: { select: { name: true } },
      size: { select: { name: true } },
    },
  },
} satisfies Prisma.WholesaleReturnLineSelect;

type LineRow = Prisma.WholesaleReturnLineGetPayload<{ select: typeof lineSelect }>;

function figuresOf(lines: LineRow[], checked: boolean) {
  const sum = (f: (l: LineRow) => number) => lines.reduce((s, l) => s + f(l), 0);
  return {
    received: sum((l) => l.quantity),
    refunded: sum((l) => l.refunded),
    exchanged: sum((l) => (l.mode === "EXCHANGE" ? l.quantity : 0)),
    a: checked ? sum((l) => l.qcA) : null,
    b: checked ? sum((l) => l.qcB) : null,
    reject: checked ? sum((l) => l.qcReject) : null,
  };
}

/** One wholesale return with its lines, figures, documents and what this person may do. */
export async function getWholesaleReturn(ctx: CompanyContext, returnId: string) {
  assertCanSee(ctx);
  const r = await ctx.db.wholesaleReturn.findUnique({
    where: { id: returnId },
    include: {
      party: { select: { id: true, code: true, name: true } },
      order: { select: { id: true, number: true } },
      exchangeOrder: {
        select: {
          id: true,
          number: true,
          total: true,
          invoice: { select: { id: true, number: true } },
          deliveryChallans: { select: { id: true, number: true } },
        },
      },
      salesReturn: { select: { id: true, number: true, amount: true, voidedAt: true } },
      lines: { select: lineSelect, orderBy: { id: "asc" } },
    },
  });
  if (!r) throw new AppError("NOT_FOUND", "Wholesale return not found.");
  const tz = ctx.company.timezone;
  const [invoice, people, company] = await Promise.all([
    ctx.db.invoice.findUnique({
      where: { id: r.invoiceId },
      select: { id: true, number: true, issueDate: true },
    }),
    prisma.user.findMany({
      where: {
        id: { in: [r.receivedById, r.approvedById, r.checkedById].filter(Boolean) as string[] },
      },
      select: { id: true, name: true },
    }),
    prisma.company.findUniqueOrThrow({
      where: { id: ctx.company.id },
      select: { wholesaleReturnPinAbove: true },
    }),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const status = wholesaleReturnStatus(r);
  const access = wholesaleReturnAccess(ctx);
  const seeMoney = canSeeFinancials(ctx) || ctx.can("sales.view");
  const soldOn = invoice ? localDay(invoice.issueDate, tz) : null;
  const receivedOn = localDay(r.receivedAt, tz);
  const label = (v: LineRow["variant"] | null) =>
    v ? `${v.style.name} · ${v.color.name} · ${v.size.name}` : null;
  return {
    id: r.id,
    number: r.number,
    status,
    reason: r.reason,
    notes: r.notes,
    buyer: r.party,
    invoice: invoice ? { id: invoice.id, number: invoice.number } : null,
    order: r.order,
    receivedOn,
    soldOn,
    daysSinceSale: soldOn ? daysBetween(soldOn, receivedOn) : null,
    receivedBy: r.receivedById ? (nameOf.get(r.receivedById) ?? null) : null,
    approvedOn: r.approvedAt ? localDay(r.approvedAt, tz) : null,
    approvedBy: r.approvedById ? (nameOf.get(r.approvedById) ?? null) : null,
    approveNote: r.approveNote,
    checkedOn: r.checkedAt ? localDay(r.checkedAt, tz) : null,
    checkedBy: r.checkedById ? (nameOf.get(r.checkedById) ?? null) : null,
    creditNote:
      r.salesReturn && seeMoney
        ? {
            id: r.salesReturn.id,
            number: r.salesReturn.number,
            amount: r.salesReturn.amount.toFixed(2),
          }
        : null,
    exchange: r.exchangeOrder
      ? {
          orderId: r.exchangeOrder.id,
          orderNumber: r.exchangeOrder.number,
          invoice: r.exchangeOrder.invoice,
          challans: r.exchangeOrder.deliveryChallans,
          total: seeMoney ? r.exchangeOrder.total.toFixed(2) : null,
        }
      : null,
    figures: figuresOf(r.lines, r.checkedAt !== null),
    lines: r.lines.map((l) => ({
      id: l.id,
      sku: l.variant.sku,
      label: label(l.variant)!,
      quantity: l.quantity,
      unitPrice: seeMoney ? l.unitPrice.toFixed(2) : null,
      mode: l.mode,
      exchangeKind: l.exchangeKind,
      newSku: l.newVariant?.sku ?? null,
      newLabel: label(l.newVariant),
      newQuantity: l.newQuantity,
      newUnitPrice: seeMoney ? (l.newUnitPrice?.toFixed(2) ?? null) : null,
      priceDifference: seeMoney && l.mode === "EXCHANGE" ? l.priceDifference.toFixed(2) : null,
      refunded: l.refunded,
      a: l.qcA,
      b: l.qcB,
      reject: l.qcReject,
    })),
    pinAbove: company.wholesaleReturnPinAbove.toFixed(2),
    currency: ctx.company.currency,
    can: {
      approve: access.approve && !r.approvedAt,
      check: access.check && !r.checkedAt,
    },
  };
}

export type WholesaleReturnScreen = Awaited<ReturnType<typeof getWholesaleReturn>>;

function statusWhere(status: string | undefined): Prisma.WholesaleReturnWhereInput {
  switch (status) {
    case "RECEIVED":
      return { approvedAt: null, checkedAt: null };
    case "APPROVED":
      return { approvedAt: { not: null }, checkedAt: null };
    case "CHECKED":
      return { approvedAt: null, checkedAt: { not: null } };
    case "DONE":
      return { approvedAt: { not: null }, checkedAt: { not: null } };
    case "OPEN":
      return { OR: [{ approvedAt: null }, { checkedAt: null }] };
    default:
      return {};
  }
}

/**
 * The "Wholesale returns" page: the returns (filters: status, buyer, dates,
 * search), the chosen month's totals and the return rate by buyer (pieces
 * back in the month over pieces delivered to them in the month).
 */
export async function listWholesaleReturns(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSee(ctx);
  const q = listWholesaleReturnsSchema.parse(raw);
  const tz = ctx.company.timezone;
  const { start, end } = dayRange(q.from, q.to, tz);
  const rows = await ctx.db.wholesaleReturn.findMany({
    where: {
      ...statusWhere(q.status),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: "insensitive" as const } },
              { party: { name: { contains: q.search, mode: "insensitive" as const } } },
              { order: { number: { contains: q.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...(start || end
        ? { receivedAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    include: {
      party: { select: { id: true, name: true, code: true } },
      order: { select: { number: true } },
      lines: { select: lineSelect },
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  const invoices = await ctx.db.invoice.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.invoiceId))] } },
    select: { id: true, number: true, issueDate: true },
  });
  const invoiceOf = new Map(invoices.map((i) => [i.id, i]));
  const month = q.month ?? localDay(new Date(), tz).slice(0, 7);
  return {
    items: rows.map((r) => {
      const inv = invoiceOf.get(r.invoiceId);
      const receivedOn = localDay(r.receivedAt, tz);
      const soldOn = inv ? localDay(inv.issueDate, tz) : null;
      return {
        id: r.id,
        number: r.number,
        status: wholesaleReturnStatus(r),
        buyer: r.party,
        invoice: inv ? { id: inv.id, number: inv.number } : null,
        receivedOn,
        daysSinceSale: soldOn ? daysBetween(soldOn, receivedOn) : null,
        figures: figuresOf(r.lines, r.checkedAt !== null),
      };
    }),
    month: await monthReport(ctx, month),
    /** Pieces in "Returns to check" now. */
    toCheck: await piecesToCheck(ctx),
    access: wholesaleReturnAccess(ctx),
    pinAbove: (
      await prisma.company.findUniqueOrThrow({
        where: { id: ctx.company.id },
        select: { wholesaleReturnPinAbove: true },
      })
    ).wholesaleReturnPinAbove.toFixed(2),
    currency: ctx.company.currency,
    filters: q,
  };
}

export type WholesaleReturnList = Awaited<ReturnType<typeof listWholesaleReturns>>;

/** A month's totals and each buyer's return rate (pieces back / pieces delivered in the month). */
async function monthReport(ctx: CompanyContext, month: string) {
  const tz = ctx.company.timezone;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const start = startOfDayInZone(`${month}-01`, tz);
  const end = startOfDayInZone(`${next}-01`, tz);
  const returns = await ctx.db.wholesaleReturn.findMany({
    where: { receivedAt: { gte: start, lt: end } },
    include: { party: { select: { id: true, name: true } }, lines: { select: lineSelect } },
  });
  const delivered = await ctx.db.stockMovement.groupBy({
    by: ["referenceId"],
    where: {
      type: "SALE_OUT",
      referenceType: "SalesOrder",
      createdAt: { gte: start, lt: end },
    },
    _sum: { quantity: true },
  });
  const orders = await ctx.db.salesOrder.findMany({
    where: {
      id: { in: delivered.map((d) => d.referenceId!).filter(Boolean) },
      partyId: { not: null },
    },
    select: { id: true, partyId: true },
  });
  const partyOfOrder = new Map(orders.map((o) => [o.id, o.partyId!]));
  const deliveredTo = new Map<string, number>();
  for (const d of delivered) {
    const party = d.referenceId ? partyOfOrder.get(d.referenceId) : undefined;
    if (!party) continue;
    deliveredTo.set(party, (deliveredTo.get(party) ?? 0) - (d._sum.quantity ?? 0));
  }
  const byBuyer = new Map<string, { id: string; name: string; returns: number; pieces: number }>();
  let received = 0;
  let refunded = 0;
  let exchanged = 0;
  let a = 0;
  let b = 0;
  let reject = 0;
  for (const r of returns) {
    const f = figuresOf(r.lines, r.checkedAt !== null);
    received += f.received;
    refunded += f.refunded;
    exchanged += f.exchanged;
    a += f.a ?? 0;
    b += f.b ?? 0;
    reject += f.reject ?? 0;
    const entry = byBuyer.get(r.party.id) ?? {
      id: r.party.id,
      name: r.party.name,
      returns: 0,
      pieces: 0,
    };
    entry.returns += 1;
    entry.pieces += f.received;
    byBuyer.set(r.party.id, entry);
  }
  return {
    month,
    returns: returns.length,
    received,
    refunded,
    exchanged,
    a,
    b,
    reject,
    toCheck: returns
      .filter((r) => !r.checkedAt)
      .reduce((s, r) => s + figuresOf(r.lines, false).received, 0),
    buyers: [...byBuyer.values()]
      .map((e) => {
        const sent = deliveredTo.get(e.id) ?? 0;
        return {
          ...e,
          delivered: sent,
          /** Pieces back over pieces delivered in the month, %; null when nothing was delivered. */
          rate: sent > 0 ? Math.round((e.pieces / sent) * 1000) / 10 : null,
        };
      })
      .sort((x, y) => y.pieces - x.pieces),
  };
}

/** Home's Action Zone: wholesale returns waiting for approval or QC (for who does each). */
export async function wholesaleReturnsWaiting(ctx: CompanyContext) {
  const access = wholesaleReturnAccess(ctx);
  const [toApprove, toCheck] = await Promise.all([
    access.approve ? ctx.db.wholesaleReturn.count({ where: { approvedAt: null } }) : null,
    access.check ? ctx.db.wholesaleReturn.count({ where: { checkedAt: null } }) : null,
  ]);
  return { toApprove, toCheck };
}

/** Pieces in "Returns to check" now: received, counted, not sellable until QC. */
export async function piecesToCheck(ctx: CompanyContext) {
  const agg = await ctx.db.wholesaleReturnLine.aggregate({
    where: { wholesaleReturn: { checkedAt: null } },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

/** Invoices of wholesale buyers with goods delivered, for "Receive return" (the newest first). */
export async function findInvoicesForReturn(ctx: CompanyContext, search: string) {
  assertCanReceive(ctx);
  const q = search.trim().slice(0, 100);
  const tz = ctx.company.timezone;
  const rows = await ctx.db.invoice.findMany({
    where: {
      status: { not: "VOID" },
      partyId: { not: null },
      party: { retailStore: null },
      order: { status: { in: ["PROCESSING", "DELIVERED", "PARTIALLY_RETURNED"] } },
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" as const } },
              { order: { number: { contains: q, mode: "insensitive" as const } } },
              { party: { name: { contains: q, mode: "insensitive" as const } } },
              { party: { code: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      number: true,
      issueDate: true,
      total: true,
      party: { select: { name: true, code: true } },
      order: { select: { number: true } },
    },
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take: 20,
  });
  return rows.map((i) => ({
    id: i.id,
    number: i.number,
    issuedOn: localDay(i.issueDate, tz),
    total: i.total.toFixed(2),
    buyer: i.party!,
    order: i.order,
  }));
}

/** "Other product" in the Exchange window: active SKUs by SKU, style or colour (at most 20). */
export async function searchExchangeSkus(ctx: CompanyContext, search: string) {
  assertCanReceive(ctx);
  const q = search.trim().slice(0, 60);
  if (q.length < 2) return [];
  const rows = await ctx.db.productVariant.findMany({
    where: {
      isActive: true,
      style: { isActive: true },
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { style: { name: { contains: q, mode: "insensitive" } } },
        { style: { code: { contains: q, mode: "insensitive" } } },
        { color: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      sku: true,
      style: { select: { name: true } },
      color: { select: { name: true } },
      size: { select: { name: true } },
    },
    orderBy: { sku: "asc" },
    take: 20,
  });
  return rows.map((v) => ({ id: v.id, sku: v.sku, label: variantText(v) }));
}
