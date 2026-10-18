import { Prisma } from "@prisma/client";

import { dayRange, localDay, startOfDayInZone } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { recordPartyActivity } from "@/modules/parties/party.service";
import { creditPosition, lockBuyerCredit } from "@/modules/sales/credit.service";
import { deliveredByVariant } from "@/modules/sales/documents.service";
import { canReturnOnInvoice, canVoidSalesReturn, statusAfterReturns } from "@/modules/sales/rules";
import {
  listSalesReturnsSchema,
  salesReturnSchema,
  voidSalesReturnSchema,
} from "@/modules/sales/schemas";
import { money, returnTotals, ZERO } from "@/modules/sales/totals";

/*
 * Sales returns (credit notes, CN-): pieces a buyer sends back from one
 * invoice, recorded by Accounts. Each line is credited at the price billed
 * (with its share of the invoice's discount and VAT), the value becomes the
 * buyer's credit (their advance balance, to use on any invoice or pay back),
 * and the pieces go straight to Damage & QC Rejects at the cost they left at:
 *   Dr Sales            goods less their discount share
 *   Dr VAT Payable      their VAT share
 *        Cr Receivable (buyer)   what is credited
 *   Dr Inventory Loss   the pieces' cost
 *        Cr Cost of Goods Sold
 * The pieces come back into the order's warehouse and leave it at once
 * (RETURN_RESTOCK in, BAD_STOCK_OUT out), so sellable stock and the average
 * cost do not change and each piece shows in the rejects list.
 *
 * The order shows "Part returned" (or "Returned" once every piece ordered is
 * back) and its invoice can no longer be voided or its order cancelled while
 * a return stands. Voiding a return undoes all of it while the buyer has not
 * used the credit.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

/** Returns put money on the buyer's account: Accounts' work, like every money record. */
export function assertCanRecordReturns(ctx: CompanyContext) {
  if (!ctx.can("accounts.receipts.record")) {
    throw new AppError(
      "FORBIDDEN",
      "Only Accounts can record a sales return: its value goes onto the buyer's account.",
    );
  }
}

const variantLabel = {
  select: {
    sku: true,
    style: { select: { code: true, name: true } },
    color: { select: { name: true } },
    size: { select: { name: true, sortOrder: true } },
  },
} as const;

/**
 * Where an order's invoice lines stand for returns: per line what was billed,
 * delivered and already returned (by returns not void), with the cost each
 * piece left at (from its deliveries), plus the discount and VAT earlier
 * returns took back.
 */
export async function returnPosition(db: Db | Tx, orderId: string) {
  const [items, delivered, earlier, sales] = await Promise.all([
    db.salesOrderItem.findMany({
      where: { orderId },
      select: {
        id: true,
        variantId: true,
        quantity: true,
        unitPrice: true,
        discount: true,
        lineTotal: true,
        variant: variantLabel,
        returnItems: {
          where: { salesReturn: { voidedAt: null } },
          select: { quantity: true, amount: true },
        },
      },
      orderBy: { id: "asc" },
    }),
    deliveredByVariant(db as Tx, orderId),
    db.salesReturn.aggregate({
      where: { orderId, voidedAt: null },
      _sum: { discount: true, tax: true },
    }),
    db.stockMovement.findMany({
      where: { referenceType: "SalesOrder", referenceId: orderId, type: "SALE_OUT" },
      select: { variantId: true, quantity: true, unitCost: true },
    }),
  ]);
  // What each SKU's pieces cost when they left (weighted over its deliveries).
  const out = new Map<string, { pieces: number; value: Prisma.Decimal }>();
  for (const m of sales) {
    const entry = out.get(m.variantId) ?? { pieces: 0, value: ZERO };
    entry.pieces -= m.quantity;
    entry.value = entry.value.plus((m.unitCost ?? ZERO).times(-m.quantity));
    out.set(m.variantId, entry);
  }
  const lines = items.map((item) => {
    const returned = item.returnItems.reduce((s, r) => s + r.quantity, 0);
    const returnedAmount = item.returnItems.reduce((s, r) => s.plus(r.amount), ZERO);
    const sent = Math.min(delivered.get(item.variantId) ?? 0, item.quantity);
    const cost = out.get(item.variantId);
    return {
      ...item,
      delivered: sent,
      returned,
      returnedAmount,
      /** Delivered pieces that have not come back. */
      returnable: Math.max(sent - returned, 0),
      /** The price billed per piece: the line's total (after its own discount) over its pieces. */
      priceBilled: item.quantity > 0 ? money(item.lineTotal.dividedBy(item.quantity)) : ZERO,
      unitCost:
        cost && cost.pieces > 0
          ? cost.value.dividedBy(cost.pieces).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
          : ZERO,
    };
  });
  return {
    lines,
    ordered: lines.reduce((s, l) => s + l.quantity, 0),
    delivered: lines.reduce((s, l) => s + l.delivered, 0),
    returned: lines.reduce((s, l) => s + l.returned, 0),
    earlier: {
      discount: money(earlier._sum.discount ?? 0),
      tax: money(earlier._sum.tax ?? 0),
    },
  };
}

export type ReturnPosition = Awaited<ReturnType<typeof returnPosition>>;

/** "Classic Polo · Navy · M" */
export const variantText = (v: {
  style: { name: string };
  color: { name: string };
  size: { name: string };
}) => `${v.style.name} · ${v.color.name} · ${v.size.name}`;

/** The day a return is dated: today keeps the time; an earlier day is its start in company time. */
function returnInstant(ctx: CompanyContext, day: string | undefined, today: string) {
  return !day || day === today ? new Date() : startOfDayInZone(day, ctx.company.timezone);
}

/** Records a sales return against an invoice (Accounts). Returns the credit note. */
export async function createSalesReturn(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = salesReturnSchema.parse(raw);
  assertCanRecordReturns(ctx);
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const found = await ctx.db.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, orderId: true, partyId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "Invoice not found.");
  const today = localDay(new Date(), tz);
  if (input.returnDate && input.returnDate > today) {
    throw new AppError("VALIDATION", "The goods cannot come back on a later day than today.", {
      returnDate: ["Choose today or an earlier day"],
    });
  }

  const returnId = await prisma.$transaction(async (tx) => {
    // The buyer's credit first, then the order (the order every credit step locks in).
    if (found.partyId) await lockBuyerCredit(tx, found.partyId);
    await lockRow(tx, "SalesOrder", found.orderId);
    const invoice = await tx.invoice.findFirstOrThrow({
      where: { id: found.id, companyId },
      select: { id: true, number: true, status: true, partyId: true, issueDate: true },
    });
    const order = await tx.salesOrder.findUniqueOrThrow({
      where: { id: found.orderId },
      select: {
        id: true,
        number: true,
        status: true,
        warehouseId: true,
        subtotal: true,
        discount: true,
        tax: true,
        party: { select: { name: true, code: true } },
      },
    });
    const position = await returnPosition(tx, order.id);
    assertAllowed(canReturnOnInvoice(invoice, order, position));
    if (!order.warehouseId) throw new AppError("CONFLICT", "The order has no warehouse.");
    if (input.returnDate && input.returnDate < localDay(invoice.issueDate, tz)) {
      throw new AppError(
        "VALIDATION",
        `The goods cannot come back before invoice ${invoice.number} was issued.`,
        { returnDate: [`Choose ${localDay(invoice.issueDate, tz)} or later`] },
      );
    }

    // One entry per invoice line, in the order asked for.
    const lineOf = new Map(position.lines.map((l) => [l.id, l]));
    const wanted = new Map<string, number>();
    input.items.forEach((item, i) => {
      if (!lineOf.has(item.orderItemId)) {
        throw new AppError("VALIDATION", `Line ${i + 1} is not on ${invoice.number}.`, {
          [`items.${i}.orderItemId`]: ["Choose a line of this invoice"],
        });
      }
      wanted.set(item.orderItemId, (wanted.get(item.orderItemId) ?? 0) + item.quantity);
    });
    const picked = [...wanted].map(([id, take]) => {
      const line = lineOf.get(id)!;
      if (take > line.returnable) {
        const i = input.items.findIndex((item) => item.orderItemId === id);
        throw new AppError(
          "VALIDATION",
          line.returnable === 0
            ? `No delivered pieces of ${line.variant.sku} are left to come back.`
            : `Only ${line.returnable} delivered pcs of ${line.variant.sku} can come back.`,
          { [`items.${i}.quantity`]: [`At most ${line.returnable}`] },
        );
      }
      return { line, take };
    });
    const pieces = picked.reduce((s, p) => s + p.take, 0);
    const totals = returnTotals({
      lines: picked.map(({ line, take }) => ({
        lineTotal: line.lineTotal,
        quantity: line.quantity,
        returnedQuantity: line.returned,
        returnedAmount: line.returnedAmount,
        take,
      })),
      invoice: order,
      earlier: position.earlier,
      last: position.returned + pieces >= position.ordered,
    });
    const costs = picked.map(({ line, take }) => money(line.unitCost.times(take)));
    const costValue = costs.reduce((a, b) => a.plus(b), ZERO);
    const date = returnInstant(ctx, input.returnDate, today);
    const number = await nextDocumentNumber(tx, companyId, "SALES_RETURN", date);
    const now = new Date();

    const created = await tx.salesReturn.create({
      data: {
        companyId,
        number,
        orderId: order.id,
        invoiceId: invoice.id,
        partyId: invoice.partyId,
        warehouseId: order.warehouseId,
        reason: input.reason,
        notes: input.notes ?? null,
        status: "COMPLETED",
        receivedAt: date,
        completedAt: now,
        goodsValue: totals.goods,
        discount: totals.discount,
        tax: totals.tax,
        amount: totals.total,
        costValue,
        createdById: ctx.user.id,
        items: {
          create: picked.map(({ line, take }, i) => ({
            variantId: line.variantId,
            orderItemId: line.id,
            quantity: take,
            unitPrice: line.priceBilled,
            amount: totals.amounts[i]!,
            unitCost: line.unitCost,
            qcStatus: "MOVED_TO_BAD_STOCK" as const,
            qtyBadStock: take,
            inspectedById: ctx.user.id,
            inspectedAt: now,
          })),
        },
      },
      include: { items: { select: { id: true, orderItemId: true } } },
    });

    // In from the buyer, out to Damage & QC Rejects at the cost the pieces left at.
    const itemOf = new Map(created.items.map((i) => [i.orderItemId, i.id]));
    for (const [i, { line, take }] of picked.entries()) {
      const key = {
        companyId,
        variantId: line.variantId,
        warehouseId: order.warehouseId,
        grade: "A_GRADE" as const,
        unitCost: line.unitCost,
        createdById: ctx.user.id,
      };
      await tx.stockMovement.create({
        data: {
          ...key,
          type: "RETURN_RESTOCK",
          quantity: take,
          referenceType: "SalesReturn",
          referenceId: created.id,
          note: `${number} from ${invoice.number}`,
        },
      });
      const entry = await tx.badStockEntry.create({
        data: {
          companyId,
          variantId: line.variantId,
          quantity: take,
          unitCost: line.unitCost,
          lossValue: costs[i]!,
          source: "RETURN_QC",
          reason: `Sales return ${number} (${invoice.number}): ${input.reason}`,
          salesReturnItemId: itemOf.get(line.id) ?? null,
        },
      });
      await tx.stockMovement.create({
        data: {
          ...key,
          type: "BAD_STOCK_OUT",
          quantity: -take,
          referenceType: "BadStockEntry",
          referenceId: entry.id,
          note: `${number}: ${input.reason}`,
        },
      });
    }

    const acc = await ensureControlAccounts(companyId, tx);
    const memo = `${number} / ${invoice.number}`;
    const journal =
      totals.total.gt(0) || costValue.gt(0)
        ? await postJournalEntry(tx, {
            companyId,
            date,
            description: `Sales return ${number} from ${order.party?.name ?? "a buyer"} on ${invoice.number}: ${pieces} pcs — ${input.reason}`,
            sourceType: "RETURN",
            sourceId: created.id,
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
                partyId: invoice.partyId,
                credit: totals.total,
                memo: `Credit note ${memo}`,
              },
              {
                accountId: acc.INVENTORY_LOSS,
                debit: costValue,
                memo: "Returned pieces to Damage & QC Rejects",
              },
              { accountId: acc.COGS, credit: costValue, memo },
            ],
          })
        : null;
    if (journal) {
      await tx.salesReturn.update({
        where: { id: created.id },
        data: { journalEntryId: journal.id },
      });
    }
    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        status: statusAfterReturns({
          ordered: position.ordered,
          delivered: position.delivered,
          returned: position.returned + pieces,
        }),
      },
    });
    if (invoice.partyId) await recordPartyActivity(invoice.partyId, date, tx);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "SalesReturn",
        entityId: created.id,
        summary: `Sales return ${number} on ${invoice.number}: ${pieces} pcs to Damage & QC Rejects, ${totals.total.toFixed(2)} credited to ${order.party?.name ?? "the buyer"} — ${input.reason}`,
        after: {
          lines: picked.map(({ line, take }, i) => ({
            sku: line.variant.sku,
            quantity: take,
            amount: totals.amounts[i]!.toFixed(2),
          })),
          discount: totals.discount.toFixed(2),
          tax: totals.tax.toFixed(2),
          credited: totals.total.toFixed(2),
        },
      },
      tx,
    );
    return created.id;
  }, TX_OPTIONS);
  return getSalesReturn(ctx, returnId);
}

/**
 * The buyer's credit position, and whether a return's credit has been spent:
 * their account holds less credit than the return gave and credit was used on
 * invoices or paid back since it was recorded. Credit that went against an
 * earlier balance (an opening balance, say) was not spent: voiding the return
 * only puts that balance back.
 */
export async function returnCredit(
  db: Db,
  companyId: string,
  ret: { partyId: string; amount: Prisma.Decimal; createdAt: Date },
) {
  const since = { gte: ret.createdAt };
  const [position, used, paidBack] = await Promise.all([
    creditPosition(db, companyId, ret.partyId),
    db.creditAllocation.aggregate({
      where: {
        companyId,
        partyId: ret.partyId,
        paymentId: null,
        releasedAt: null,
        createdAt: since,
      },
      _sum: { amount: true },
    }),
    db.refund.aggregate({
      where: {
        companyId,
        partyId: ret.partyId,
        orderId: null,
        proformaId: null,
        voidedAt: null,
        createdAt: since,
      },
      _sum: { amount: true },
    }),
  ]);
  const spentSince = money(used._sum.amount ?? 0).plus(money(paidBack._sum.amount ?? 0));
  return { position, spent: position.credit.lt(ret.amount) && spentSince.gt(0) };
}

/**
 * Voids a return recorded by mistake, while the buyer has not spent its
 * credit: its entry is reversed, its pieces leave Damage & QC Rejects (they
 * are back with the buyer: opposite stock movements, its rejects lines kept
 * and marked void, nothing deleted) and the order's status follows.
 */
export async function voidSalesReturn(
  ctx: CompanyContext,
  returnId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidSalesReturnSchema.parse(raw);
  assertCanRecordReturns(ctx);
  const companyId = ctx.company.id;
  const found = await ctx.db.salesReturn.findUnique({
    where: { id: returnId },
    select: { id: true, orderId: true, partyId: true },
  });
  if (!found) throw new AppError("NOT_FOUND", "Sales return not found.");

  await prisma.$transaction(async (tx) => {
    // Same order as making one: the buyer's credit, the order, then the return.
    if (found.partyId) await lockBuyerCredit(tx, found.partyId);
    await lockRow(tx, "SalesOrder", found.orderId);
    await lockRow(tx, "SalesReturn", found.id);
    const ret = await tx.salesReturn.findFirstOrThrow({
      where: { id: found.id, companyId },
      include: { items: { select: { id: true } } },
    });
    assertAllowed(canVoidSalesReturn(ret));
    if (ret.partyId && ret.amount.gt(0)) {
      const { position, spent } = await returnCredit(tx, companyId, {
        ...ret,
        partyId: ret.partyId,
      });
      if (spent) {
        throw new AppError(
          "CONFLICT",
          `The buyer has used the credit from ${ret.number}: only ${position.credit.toFixed(2)} of its ${ret.amount.toFixed(2)} is still unused on their account, so it can no longer be voided.`,
        );
      }
    }
    if (ret.journalEntryId) {
      await reverseJournalEntry(tx, ret.journalEntryId, {
        description: `Void of sales return ${ret.number}: ${reason}`,
        postedById: ctx.user.id,
      });
    }
    // The pieces never came back: each of their movements in and out of the rejects gets
    // its opposite (they net to nothing either way), and their rejects lines are marked void.
    const now = new Date();
    const entries = await tx.badStockEntry.findMany({
      where: { salesReturnItemId: { in: ret.items.map((i) => i.id) }, voidedAt: null },
      select: { id: true },
    });
    const moves = await tx.stockMovement.findMany({
      where: {
        OR: [
          { referenceType: "SalesReturn", referenceId: ret.id },
          { referenceType: "BadStockEntry", referenceId: { in: entries.map((e) => e.id) } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    for (const m of moves) {
      await tx.stockMovement.create({
        data: {
          companyId,
          variantId: m.variantId,
          warehouseId: m.warehouseId,
          grade: m.grade,
          type: m.type,
          quantity: -m.quantity,
          unitCost: m.unitCost,
          referenceType: m.referenceType,
          referenceId: m.referenceId,
          lotId: m.lotId,
          note: `Void of ${ret.number}: ${reason}`,
          createdById: ctx.user.id,
        },
      });
    }
    await tx.badStockEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { voidedAt: now, voidReason: `Sales return ${ret.number} voided: ${reason}` },
    });
    await tx.salesReturn.update({
      where: { id: ret.id },
      data: { voidedAt: now, voidReason: reason },
    });
    const position = await returnPosition(tx, ret.orderId);
    const order = await tx.salesOrder.findUniqueOrThrow({
      where: { id: ret.orderId },
      select: { status: true },
    });
    if (order.status !== "CANCELLED") {
      await tx.salesOrder.update({
        where: { id: ret.orderId },
        data: { status: statusAfterReturns(position) },
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "SalesReturn",
        entityId: ret.id,
        summary: `Voided sales return ${ret.number} (${ret.amount.toFixed(2)} credit, ${entries.length} rejects line(s) marked void): ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getSalesReturn(ctx, returnId);
}

export async function listSalesReturns(ctx: CompanyContext, raw: unknown = {}) {
  const q = listSalesReturnsSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.salesReturn.findMany({
    where: {
      invoiceId: q.invoiceId ?? { not: null },
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: "insensitive" as const } },
              { invoice: { number: { contains: q.search, mode: "insensitive" as const } } },
              { party: { name: { contains: q.search, mode: "insensitive" as const } } },
              { party: { code: { contains: q.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(start || end
        ? { receivedAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
    },
    select: {
      id: true,
      number: true,
      receivedAt: true,
      amount: true,
      reason: true,
      voidedAt: true,
      party: { select: { id: true, code: true, name: true } },
      invoice: { select: { id: true, number: true } },
      order: { select: { id: true, number: true } },
      items: { select: { quantity: true } },
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

/**
 * One credit note: the buyer, the invoice, its lines and amounts, and the
 * letterhead. What the pieces cost (costValue, each line's unitCost and its
 * rejects line's lossValue) comes back as null for people who do not see the
 * financials, as on the screen: the API gives it to anyone with sales.view.
 */
export async function getSalesReturn(ctx: CompanyContext, returnId: string) {
  const ret = await ctx.db.salesReturn.findUnique({
    where: { id: returnId },
    include: {
      party: {
        select: {
          id: true,
          code: true,
          name: true,
          contactPerson: true,
          phone: true,
          address: true,
          taxId: true,
        },
      },
      invoice: {
        select: {
          id: true,
          number: true,
          status: true,
          issueDate: true,
          total: true,
          dueAmount: true,
        },
      },
      order: { select: { id: true, number: true, status: true } },
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          amount: true,
          unitCost: true,
          variant: variantLabel,
          badStockEntry: { select: { id: true, lossValue: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!ret || !ret.invoiceId) throw new AppError("NOT_FOUND", "Sales return not found.");
  const seeCosts = canSeeFinancials(ctx);
  return {
    ...ret,
    costValue: seeCosts ? ret.costValue : null,
    items: ret.items.map((item) => ({
      ...item,
      unitCost: seeCosts ? item.unitCost : null,
      badStockEntry: item.badStockEntry && {
        ...item.badStockEntry,
        lossValue: seeCosts ? item.badStockEntry.lossValue : null,
      },
    })),
    letterhead: await letterhead(ctx),
  };
}

/** The returns made on an invoice or an order (void ones too), oldest first, for their screens. */
export async function returnsOf(
  ctx: CompanyContext,
  where: { invoiceId: string } | { orderId: string },
) {
  return ctx.db.salesReturn.findMany({
    where: { ...where, invoiceId: "invoiceId" in where ? where.invoiceId : { not: null } },
    select: {
      id: true,
      number: true,
      receivedAt: true,
      amount: true,
      goodsValue: true,
      discount: true,
      voidedAt: true,
      items: { select: { quantity: true } },
    },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
  });
}
