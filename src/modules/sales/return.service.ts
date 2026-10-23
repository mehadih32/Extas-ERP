import { Prisma, type ReturnItemQcStatus, type StockGrade } from "@prisma/client";

import { dayRange, localDay, startOfDayInZone } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow, lockRows } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { canSeeFinancials } from "@/modules/dashboard/access";
import {
  gradeCost,
  gradeCostData,
  gradeKey,
  onHandByGrade,
  removeAtCost,
} from "@/modules/inventory/costs";
import { receiveAtCostTx } from "@/modules/inventory/stock.service";
import { recordPartyActivity } from "@/modules/parties/party.service";
import { allocateTx, creditPosition, lockBuyerCredit } from "@/modules/sales/credit.service";
import { deliveredByVariant } from "@/modules/sales/documents.service";
import { ledgerPartyId, refreshOrderPayments } from "@/modules/sales/posting";
import { canReturnOnInvoice, canVoidSalesReturn, statusAfterReturns } from "@/modules/sales/rules";
import {
  listSalesReturnsSchema,
  type ReturnQc,
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
 *
 * A piece checked on its way back (QC, `qc` per item: the e-commerce API's
 * returns, CN-005) can instead go back into stock in the order's warehouse at
 * the cost it left at, re-weighting that grade's average cost: GOOD into
 * sellable A-grade stock, B_GRADE into B-grade stock. Its cost goes back to
 * Inventory rather than Inventory Loss:
 *   Dr Inventory        restocked pieces' cost
 *   Dr Inventory Loss   damaged pieces' cost
 *        Cr Cost of Goods Sold
 * Voiding such a return takes those pieces back out while they are still
 * there (not sold or promised to an order), and refuses with the reason
 * otherwise. Without `qc` every piece is DAMAGED, as above.
 *
 * A website return (`walkInCredit`, a sale without a buyer) has no buyer
 * account to use its credit on later, so the credit at once pays what its
 * own invoice still has due (a CreditAllocation from the return): an unpaid
 * COD order then owes only for the pieces kept. What is left over (the shop
 * had taken the money already) stays on the Walk-in customers account until
 * Accounts pays it back from the credit note's page ("Pay back the credit",
 * refund.service.ts). Voiding the return releases that allocation, and waits
 * until any refund of its credit is voided first.
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

/** Where each QC result sends its pieces (grade null: to Damage & QC Rejects). */
const QC_DESTINATION: Record<ReturnQc, { status: ReturnItemQcStatus; grade: StockGrade | null }> = {
  GOOD: { status: "MOVED_TO_MAIN_STOCK", grade: "A_GRADE" },
  B_GRADE: { status: "MOVED_TO_B_GRADE", grade: "B_GRADE" },
  DAMAGED: { status: "MOVED_TO_BAD_STOCK", grade: null },
};

/** A return item's QC result, from its status (old returns' pieces all went to the rejects). */
export function qcOf(status: ReturnItemQcStatus): ReturnQc {
  if (status === "MOVED_TO_MAIN_STOCK") return "GOOD";
  if (status === "MOVED_TO_B_GRADE") return "B_GRADE";
  return "DAMAGED";
}

/** "2 pcs back in stock, 1 pcs to Damage & QC Rejects" */
export function destinationText(pieces: Record<ReturnQc, number>) {
  return [
    pieces.GOOD > 0 ? `${pieces.GOOD} pcs back in stock` : null,
    pieces.B_GRADE > 0 ? `${pieces.B_GRADE} pcs to B-grade stock` : null,
    pieces.DAMAGED > 0 ? `${pieces.DAMAGED} pcs to Damage & QC Rejects` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

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

/**
 * A website return's credit (a sale without a buyer): what of it paid its own
 * invoice, what Accounts paid back, and what is left to pay back.
 */
export async function walkInReturnCredit(db: Db | Tx, ret: { id: string; amount: Prisma.Decimal }) {
  const [allocated, refunded] = await Promise.all([
    db.creditAllocation.aggregate({
      where: { salesReturnId: ret.id, releasedAt: null },
      _sum: { amount: true },
    }),
    db.refund.aggregate({
      where: { salesReturnId: ret.id, voidedAt: null },
      _sum: { amount: true },
    }),
  ]);
  const usedOnInvoice = money(allocated._sum.amount ?? 0);
  const paidBack = money(refunded._sum.amount ?? 0);
  return {
    usedOnInvoice,
    paidBack,
    left: Prisma.Decimal.max(money(ret.amount).minus(usedOnInvoice).minus(paidBack), ZERO),
  };
}

/**
 * Records a sales return against an invoice (Accounts). Returns the credit note.
 * `walkInCredit` (the e-commerce API only) takes a return on a sale without a
 * buyer: its credit pays its own invoice's due first, the rest stays on the
 * Walk-in customers account. `integrationId` and `externalReturnId` keep the
 * shop's own id for it (one return per id and shop).
 */
export async function createSalesReturn(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  options: { walkInCredit?: boolean; integrationId?: string; externalReturnId?: string } = {},
) {
  const input = salesReturnSchema.parse(raw);
  assertCanRecordReturns(ctx);
  if (input.items.some((item) => (item.qc ?? "DAMAGED") !== "DAMAGED")) {
    if (!ctx.can("sales.returns.qc")) {
      throw new AppError(
        "FORBIDDEN",
        "Only someone who checks returned goods (QC) can put returned pieces back into stock.",
      );
    }
  }
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
        customerName: true,
        party: { select: { name: true, code: true } },
      },
    });
    const position = await returnPosition(tx, order.id);
    assertAllowed(canReturnOnInvoice(invoice, order, position, options));
    if (!order.warehouseId) throw new AppError("CONFLICT", "The order has no warehouse.");
    if (input.returnDate && input.returnDate < localDay(invoice.issueDate, tz)) {
      throw new AppError(
        "VALIDATION",
        `The goods cannot come back before invoice ${invoice.number} was issued.`,
        { returnDate: [`Choose ${localDay(invoice.issueDate, tz)} or later`] },
      );
    }

    // One entry per invoice line, in the order asked for, with its pieces by QC result.
    const lineOf = new Map(position.lines.map((l) => [l.id, l]));
    const wanted = new Map<string, Array<{ qc: ReturnQc; take: number; note: string | null }>>();
    input.items.forEach((item, i) => {
      if (!lineOf.has(item.orderItemId)) {
        throw new AppError("VALIDATION", `Line ${i + 1} is not on ${invoice.number}.`, {
          [`items.${i}.orderItemId`]: ["Choose a line of this invoice"],
        });
      }
      const qc = item.qc ?? "DAMAGED";
      const parts = wanted.get(item.orderItemId) ?? [];
      const same = parts.find((p) => p.qc === qc);
      if (same) {
        same.take += item.quantity;
        same.note ??= item.qcNote ?? null;
      } else {
        parts.push({ qc, take: item.quantity, note: item.qcNote ?? null });
      }
      wanted.set(item.orderItemId, parts);
    });
    const picked = [...wanted].map(([id, parts]) => {
      const line = lineOf.get(id)!;
      const take = parts.reduce((s, p) => s + p.take, 0);
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
      return { line, take, parts };
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
    // Each line's credit shared over its QC results by pieces (the last takes what is left).
    const rows = picked.flatMap(({ line, take, parts }, i) => {
      const lineAmount = totals.amounts[i]!;
      let left = lineAmount;
      return parts.map((part, j) => {
        const amount =
          j === parts.length - 1 ? left : money(lineAmount.times(part.take).dividedBy(take));
        left = left.minus(amount);
        return { line, ...part, amount, cost: money(line.unitCost.times(part.take)) };
      });
    });
    const costValue = rows.reduce((a, r) => a.plus(r.cost), ZERO);
    const writtenOff = rows
      .filter((r) => r.qc === "DAMAGED")
      .reduce((a, r) => a.plus(r.cost), ZERO);
    const restockedValue = costValue.minus(writtenOff);
    const piecesBy: Record<ReturnQc, number> = { GOOD: 0, B_GRADE: 0, DAMAGED: 0 };
    for (const r of rows) piecesBy[r.qc] += r.take;
    const buyerName = order.party?.name ?? order.customerName ?? "a walk-in customer";
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
        integrationId: options.integrationId ?? null,
        externalReturnId: options.externalReturnId ?? null,
        items: {
          create: rows.map(({ line, take, qc, note, amount }) => ({
            variantId: line.variantId,
            orderItemId: line.id,
            quantity: take,
            unitPrice: line.priceBilled,
            amount,
            unitCost: line.unitCost,
            qcStatus: QC_DESTINATION[qc].status,
            qtyBadStock: qc === "DAMAGED" ? take : 0,
            qtyRestocked: qc === "DAMAGED" ? 0 : take,
            qcNote: note,
            inspectedById: ctx.user.id,
            inspectedAt: now,
          })),
        },
      },
      include: { items: { select: { id: true, orderItemId: true, qcStatus: true } } },
    });
    const itemOf = new Map(created.items.map((i) => [`${i.orderItemId}:${i.qcStatus}`, i.id]));
    const itemIdOf = (r: (typeof rows)[number]) =>
      itemOf.get(`${r.line.id}:${QC_DESTINATION[r.qc].status}`)!;

    // Checked good or B-grade: back into that grade's stock at the cost they left at,
    // re-weighting its average (every SKU locked first, in a fixed order).
    const restock = rows.filter((r) => r.qc !== "DAMAGED");
    await lockRows(
      tx,
      "ProductVariant",
      restock.map((r) => r.line.variantId),
    );
    for (const r of restock) {
      const grade = QC_DESTINATION[r.qc].grade!;
      const variant = await tx.productVariant.findUniqueOrThrow({
        where: { id: r.line.variantId },
        select: { id: true, sku: true, avgCost: true, bGradeAvgCost: true },
      });
      const onHand = await tx.stockBalance.aggregate({
        where: { variantId: variant.id, grade },
        _sum: { quantity: true },
      });
      const key = { variantId: variant.id, warehouseId: order.warehouseId, grade };
      await tx.stockBalance.upsert({
        where: { variantId_warehouseId_grade: key },
        create: { ...key, companyId, quantity: r.take },
        update: { quantity: { increment: r.take } },
      });
      const movement = await tx.stockMovement.create({
        data: {
          ...key,
          companyId,
          type: "RETURN_RESTOCK",
          quantity: r.take,
          unitCost: r.line.unitCost,
          referenceType: "SalesReturnItem",
          referenceId: itemIdOf(r),
          note: `${number} from ${invoice.number}${grade === "B_GRADE" ? " (B-grade)" : ""}`,
          createdById: ctx.user.id,
        },
      });
      await receiveAtCostTx(tx, ctx, {
        variant,
        grade,
        onHand: onHand._sum.quantity ?? 0,
        average: gradeCost(variant, grade),
        quantity: r.take,
        unitCost: r.line.unitCost,
        movementId: movement.id,
      });
    }

    // Damaged: in from the buyer, out to Damage & QC Rejects at the cost the pieces left at.
    for (const r of rows.filter((row) => row.qc === "DAMAGED")) {
      const { line, take } = r;
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
          lossValue: r.cost,
          source: "RETURN_QC",
          reason: `Sales return ${number} (${invoice.number}): ${input.reason}`,
          salesReturnItemId: itemIdOf(r),
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
            description: `Sales return ${number} from ${buyerName} on ${invoice.number}: ${pieces} pcs — ${input.reason}`,
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
                partyId: await ledgerPartyId(tx, companyId, invoice.partyId),
                credit: totals.total,
                memo: `Credit note ${memo}`,
              },
              ...(restockedValue.gt(0)
                ? [
                    {
                      accountId: acc.INVENTORY,
                      debit: restockedValue,
                      memo: "Returned pieces back in stock",
                    },
                  ]
                : []),
              {
                accountId: acc.INVENTORY_LOSS,
                debit: writtenOff,
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
    // A website sale's credit pays what its own invoice still has due (the order is
    // locked above; no buyer's credit is involved, so no buyer lock is needed).
    let usedOnInvoice = ZERO;
    if (options.walkInCredit && !invoice.partyId && totals.total.gt(0)) {
      const paid = await tx.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { total: true, paidAmount: true },
      });
      const due = Prisma.Decimal.max(paid.total.minus(paid.paidAmount), ZERO);
      usedOnInvoice = Prisma.Decimal.min(totals.total, due);
      if (usedOnInvoice.gt(0)) {
        await allocateTx(tx, ctx, {
          partyId: await ledgerPartyId(tx, companyId, null),
          salesReturnId: created.id,
          items: [{ orderId: order.id, amount: usedOnInvoice }],
          limit: usedOnInvoice,
        });
      }
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
        summary: `Sales return ${number} on ${invoice.number}: ${destinationText(piecesBy)}, ${totals.total.toFixed(2)} credited to ${order.party?.name ?? (invoice.partyId ? "the buyer" : "Walk-in customers")} — ${input.reason}`,
        after: {
          lines: rows.map(({ line, take, qc, amount }) => ({
            sku: line.variant.sku,
            quantity: take,
            amount: amount.toFixed(2),
            ...(qc === "DAMAGED" ? {} : { qc }),
          })),
          discount: totals.discount.toFixed(2),
          tax: totals.tax.toFixed(2),
          credited: totals.total.toFixed(2),
          ...(usedOnInvoice.gt(0) ? { usedOnInvoice: usedOnInvoice.toFixed(2) } : {}),
          ...(options.externalReturnId ? { externalReturnId: options.externalReturnId } : {}),
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

/** The stock movements that put a return's checked pieces back into stock (none for old returns). */
async function restockMovesOf(db: Db | Tx, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  return db.stockMovement.findMany({
    where: { referenceType: "SalesReturnItem", referenceId: { in: itemIds }, quantity: { gt: 0 } },
    select: {
      id: true,
      variantId: true,
      warehouseId: true,
      grade: true,
      quantity: true,
      unitCost: true,
      referenceId: true,
      lotId: true,
      variant: { select: { sku: true } },
    },
    orderBy: [{ variantId: "asc" }, { grade: "asc" }, { id: "asc" }],
  });
}

/**
 * Pieces a return put back into stock that are no longer there to take out
 * again (sold, or promised to an order), per SKU and grade. Empty when voiding
 * can take them all back.
 */
export async function restockShortfall(db: Db | Tx, itemIds: string[]) {
  const moves = await restockMovesOf(db, itemIds);
  const need = new Map<
    string,
    { sku: string; grade: StockGrade; warehouseId: string; came: number }
  >();
  for (const m of moves) {
    const key = `${m.variantId}:${m.warehouseId}:${m.grade}`;
    const entry = need.get(key) ?? {
      sku: m.variant.sku,
      grade: m.grade,
      warehouseId: m.warehouseId,
      came: 0,
    };
    entry.came += m.quantity;
    need.set(key, entry);
  }
  if (need.size === 0) return [];
  const balances = await db.stockBalance.findMany({
    where: {
      OR: [...need.keys()].map((key) => {
        const [variantId, warehouseId, grade] = key.split(":") as [string, string, StockGrade];
        return { variantId, warehouseId, grade };
      }),
    },
    select: { variantId: true, warehouseId: true, grade: true, quantity: true, reserved: true },
  });
  const freeOf = new Map(
    balances.map((b) => [
      `${b.variantId}:${b.warehouseId}:${b.grade}`,
      Math.max(b.quantity - b.reserved, 0),
    ]),
  );
  return [...need]
    .map(([key, n]) => ({ ...n, free: freeOf.get(key) ?? 0 }))
    .filter((n) => n.free < n.came);
}

/** Why a return whose restocked pieces are gone cannot be voided, in plain words. */
export function restockShortfallMessage(
  number: string,
  short: Awaited<ReturnType<typeof restockShortfall>>,
) {
  const what = short
    .map(
      (s) =>
        `${s.sku}: ${s.came} pcs came back into ${s.grade === "B_GRADE" ? "B-grade" : "sellable"} stock, only ${s.free} are still there and not promised to an order`,
    )
    .join("; ");
  return `${number} cannot be voided: some pieces it put back into stock have been sold or promised since (${what}). Bring the stock back first, or leave the return as it is.`;
}

/**
 * Voids a return recorded by mistake, while the buyer has not spent its
 * credit: its entry is reversed, its pieces leave Damage & QC Rejects (they
 * are back with the buyer: opposite stock movements, its rejects lines kept
 * and marked void, nothing deleted) and the order's status follows. Pieces it
 * put back into stock are taken out again at the cost they came in at (the
 * grade's average put back), only while they are all still there.
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
    // A website return's credit paid back by Accounts comes back to it only by voiding that refund.
    const paidBack = await tx.refund.findMany({
      where: { salesReturnId: ret.id, voidedAt: null },
      select: { number: true },
      orderBy: { number: "asc" },
    });
    if (paidBack.length > 0) {
      throw new AppError(
        "CONFLICT",
        `Credit from ${ret.number} was paid back on ${paidBack.map((r) => r.number).join(", ")}. Void that refund first, then the return.`,
      );
    }
    const itemIds = ret.items.map((i) => i.id);
    const restocked = await restockMovesOf(tx, itemIds);
    if (restocked.length > 0) {
      await lockRows(
        tx,
        "ProductVariant",
        restocked.map((m) => m.variantId),
      );
      const short = await restockShortfall(tx, itemIds);
      if (short.length > 0) {
        throw new AppError("CONFLICT", restockShortfallMessage(ret.number, short));
      }
    }
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
    // Restocked pieces leave their grade's stock again at the cost they came in at.
    const variantIds = [...new Set(restocked.map((m) => m.variantId))];
    const onHand = await onHandByGrade(tx, variantIds);
    let cameIn = ZERO;
    let takenOut = ZERO;
    for (const m of restocked) {
      const costsNow = await tx.productVariant.findUniqueOrThrow({
        where: { id: m.variantId },
        select: { avgCost: true, bGradeAvgCost: true },
      });
      const key = gradeKey(m.variantId, m.grade);
      const unitCost = m.unitCost ?? ZERO;
      const out = removeAtCost(
        onHand.get(key) ?? 0,
        gradeCost(costsNow, m.grade),
        m.quantity,
        unitCost,
      );
      onHand.set(key, (onHand.get(key) ?? 0) - m.quantity);
      cameIn = cameIn.plus(money(unitCost.times(m.quantity)));
      takenOut = takenOut.plus(out.removed);
      await tx.productVariant.update({
        where: { id: m.variantId },
        data: gradeCostData(m.grade, out.average),
      });
      const taken = await tx.$executeRaw`
        UPDATE "StockBalance"
        SET quantity = quantity - ${m.quantity}, "updatedAt" = NOW()
        WHERE "variantId" = ${m.variantId} AND "warehouseId" = ${m.warehouseId}
          AND grade = ${m.grade}::"StockGrade" AND quantity - reserved >= ${m.quantity}`;
      if (taken === 0) {
        throw new AppError(
          "CONFLICT",
          `${m.variant.sku}'s stock changed while voiding ${ret.number}. Try again.`,
        );
      }
      await tx.stockMovement.create({
        data: {
          companyId,
          variantId: m.variantId,
          warehouseId: m.warehouseId,
          grade: m.grade,
          type: "RETURN_RESTOCK",
          quantity: -m.quantity,
          unitCost: m.unitCost,
          referenceType: "SalesReturnItem",
          referenceId: m.referenceId,
          lotId: m.lotId,
          note: `Void of ${ret.number}: ${reason}`,
          createdById: ctx.user.id,
        },
      });
    }
    // Stock that came and went at other costs since can leave the pieces worth more or
    // less than they came back at; the books follow the stock value.
    const difference = cameIn.minus(money(takenOut));
    if (!difference.isZero()) {
      const acc = await ensureControlAccounts(companyId, tx);
      const amount = difference.abs();
      const memo = ret.number;
      await postJournalEntry(tx, {
        companyId,
        description: `Stock value difference on voiding sales return ${ret.number}`,
        sourceType: "RETURN",
        sourceId: ret.id,
        postedById: ctx.user.id,
        lines: difference.gt(0)
          ? [
              { accountId: acc.INVENTORY, debit: amount, memo },
              { accountId: acc.INVENTORY_LOSS, credit: amount, memo },
            ]
          : [
              { accountId: acc.INVENTORY_LOSS, debit: amount, memo },
              { accountId: acc.INVENTORY, credit: amount, memo },
            ],
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
    // The credit it put against its own invoice comes off again: that much is due once more.
    const released = await tx.creditAllocation.updateMany({
      where: { salesReturnId: ret.id, releasedAt: null },
      data: {
        releasedAt: now,
        releaseReason: `Sales return ${ret.number} voided: ${reason}`.slice(0, 500),
      },
    });
    if (released.count > 0) await refreshOrderPayments(tx, ret.orderId);
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
        summary: `Voided sales return ${ret.number} (${ret.amount.toFixed(2)} credit, ${entries.length} rejects line(s) marked void${
          restocked.length > 0
            ? `, ${restocked.reduce((s, m) => s + m.quantity, 0)} restocked pcs taken back out`
            : ""
        }): ${reason}`,
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
      order: { select: { id: true, number: true, customerName: true } },
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
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          customerName: true,
          customerPhone: true,
          shippingAddress: true,
        },
      },
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          amount: true,
          unitCost: true,
          qcStatus: true,
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
