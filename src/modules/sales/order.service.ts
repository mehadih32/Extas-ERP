import { type PaymentMethod, Prisma, type SalesChannel } from "@prisma/client";

import { dateColumn, dateOnly, dayRange, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow, lockRows } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { reverseJournalEntry } from "@/modules/accounts/journal.service";
import { receiveAtCostTx, resolveWarehouse } from "@/modules/inventory/stock.service";
import { assertPartyCanTransact, recordPartyActivity } from "@/modules/parties/party.service";
import {
  createDeliveryChallanTx,
  createPackingListTx,
  deliveredByVariant,
  issueInvoiceTx,
  reviseInvoiceTx,
  voidInvoice,
  voidInvoiceTx,
} from "@/modules/sales/documents.service";
import { recordChequeTx } from "@/modules/sales/cheque.service";
import { applyCreditTx } from "@/modules/sales/credit.service";
import { assertCanRecordReceipts, receivePaymentTx } from "@/modules/sales/payment.service";
import { heldOnOrder } from "@/modules/sales/posting";
import {
  assertStockOrOverride,
  type ResolvedLine,
  resolveOrderLines,
} from "@/modules/sales/pricing";
import {
  cancelOrderSchema,
  createOrderSchema,
  creditCheckSchema,
  listOrdersSchema,
  orderLogisticsSchema,
  orderShipmentSchema,
  updateOrderSchema,
  voidInvoiceSchema,
} from "@/modules/sales/schemas";
import { assertCanRefund, REFUND_KIND_TEXT, refundBuyerTx } from "@/modules/sales/refund.service";
import {
  canCancelOrder,
  canEditOrder,
  canSetLogistics,
  canSetShipmentDate,
  canVoidInvoice,
  liveInvoice as live,
  SHIPMENT_OPEN,
} from "@/modules/sales/rules";
import { releaseStock, reserveStock } from "@/modules/sales/stock-ops";
import { money, orderTotals } from "@/modules/sales/totals";

/*
 * Sales orders from every channel (wholesale matrix entry, B2B pre-orders,
 * POS / social commerce). Confirming an order reserves its stock, so the
 * matrix shows the true available quantity at once; delivery (the challan)
 * takes the pieces out of stock. Selling beyond stock needs Force Override.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

/** Pieces in a per-SKU count. */
const piecesOf = (bySku: Map<string, number>) => [...bySku.values()].reduce((a, b) => a + b, 0);

/** Reserves stock for each line; a line that loses a race for the last pieces fails. */
async function reserveLines(
  tx: Tx,
  ctx: CompanyContext,
  warehouseId: string,
  lines: Array<Pick<ResolvedLine, "variantId" | "sku" | "quantity" | "short">>,
) {
  for (const line of lines) {
    const ok = await reserveStock(
      tx,
      { companyId: ctx.company.id, warehouseId, variantId: line.variantId },
      line.quantity,
      line.short,
    );
    if (!ok) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `${line.sku} was just sold elsewhere; check the stock and try again.`,
        { [`stock.${line.sku}`]: ["No longer available"] },
      );
    }
  }
}

function itemRows(
  ctx: CompanyContext,
  lines: ResolvedLine[],
  lineTotals: Prisma.Decimal[],
  reason?: string,
) {
  const now = new Date();
  return lines.map((l, idx) => ({
    variantId: l.variantId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: money(l.discount),
    lineTotal: lineTotals[idx]!,
    availableAtSale: Math.max(l.available, 0),
    forceOverride: l.short,
    overrideById: l.short ? ctx.user.id : null,
    overrideReason: l.short ? (reason ?? null) : null,
    overrideAt: l.short ? now : null,
  }));
}

async function auditOverride(
  tx: Tx,
  ctx: CompanyContext,
  meta: RequestMeta | undefined,
  order: { id: string; number: string },
  lines: ResolvedLine[],
  reason?: string,
) {
  const short = lines.filter((l) => l.short);
  if (short.length === 0) return;
  await auditInCompany(
    ctx,
    meta,
    {
      action: "FORCE_OVERRIDE",
      entityType: "SalesOrder",
      entityId: order.id,
      summary: `Force override on ${order.number}: ${short
        .map((l) => `${l.sku} ${l.quantity} (available ${Math.max(l.available, 0)})`)
        .join(", ")} — ${reason ?? ""}`,
      after: {
        lines: short.map((l) => ({ sku: l.sku, quantity: l.quantity, available: l.available })),
      },
    },
    tx,
  );
}

/**
 * The employee who packed an order: someone on the company's staff list who has
 * not left (a packer who left later stays on the orders they packed).
 */
export async function resolvePacker(ctx: CompanyContext, packedById: string | null | undefined) {
  if (!packedById) return null;
  const packer = await ctx.db.employee.findFirst({
    where: { id: packedById, status: { in: ["ACTIVE", "ON_LEAVE"] } },
    select: { id: true, name: true },
  });
  if (!packer) {
    throw new AppError("VALIDATION", "Choose who packed it from the staff list.", {
      packedById: ["Choose someone from the list"],
    });
  }
  return packer;
}

/** Staff who can be named as the packer, for the order screens' list. */
export async function listPackers(ctx: CompanyContext, keep?: string | null) {
  const working = { status: { in: ["ACTIVE" as const, "ON_LEAVE" as const] } };
  return ctx.db.employee.findMany({
    // The order's own packer stays in the list after leaving, so it still shows.
    where: keep ? { OR: [working, { id: keep }] } : working,
    select: { id: true, code: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
  });
}

/** The logistics fields a change sets: only those it names. */
const logisticsOf = (input: { totalCartons?: number | null; packedById?: string | null }) => ({
  ...(input.totalCartons !== undefined ? { totalCartons: input.totalCartons } : {}),
  ...(input.packedById !== undefined ? { packedById: input.packedById } : {}),
});

type OrderDraft = {
  channel: SalesChannel;
  partyId: string | null;
  proformaId?: string;
  warehouseId: string;
  orderDate?: Date;
  /** The day it is due to ship ("2026-11-20"). */
  shipmentDate?: string | null;
  lines: ResolvedLine[];
  charges: { discount?: number; shippingCharge?: number; tax?: number };
  customerName?: string | null;
  customerPhone?: string | null;
  shippingAddress?: string | null;
  notes?: string | null;
  overrideReason?: string;
  totalCartons?: number | null;
  /** Checked by the caller (resolvePacker). */
  packedById?: string | null;
  /** An online shop's order (CN-005): its integration, its own id there, COD and how its buyer pays. */
  integrationId?: string | null;
  externalOrderId?: string | null;
  codAmount?: number | null;
  paymentMethod?: PaymentMethod | null;
};

/** A shipment cannot be due before the order was taken. */
function checkShipmentDate(ctx: CompanyContext, shipmentDate: string, orderDate: Date) {
  if (shipmentDate < localDay(orderDate, ctx.company.timezone)) {
    throw new AppError("VALIDATION", "The shipment date is before the order date.", {
      shipmentDate: ["Choose a day on or after the order date"],
    });
  }
}

/** Creates a confirmed order and reserves its stock (inside a transaction). */
export async function createOrderTx(
  tx: Tx,
  ctx: CompanyContext,
  draft: OrderDraft,
  meta?: RequestMeta,
) {
  const orderDate = draft.orderDate ?? new Date();
  if (draft.shipmentDate) checkShipmentDate(ctx, draft.shipmentDate, orderDate);
  const totals = orderTotals(
    draft.lines.map((l) => ({ ...l, discount: l.discount })),
    draft.charges,
  );
  const order = await tx.salesOrder.create({
    data: {
      companyId: ctx.company.id,
      number: await nextDocumentNumber(tx, ctx.company.id, "SALES_ORDER"),
      channel: draft.channel,
      partyId: draft.partyId,
      proformaId: draft.proformaId ?? null,
      warehouseId: draft.warehouseId,
      status: "CONFIRMED",
      orderDate,
      shipmentDate: draft.shipmentDate ? dateColumn(draft.shipmentDate) : null,
      customerName: draft.customerName ?? null,
      customerPhone: draft.customerPhone ?? null,
      shippingAddress: draft.shippingAddress ?? null,
      subtotal: totals.subtotal,
      discount: totals.discount,
      shippingCharge: totals.shippingCharge,
      tax: totals.tax,
      total: totals.total,
      paidAmount: 0,
      dueAmount: totals.total,
      hasForceOverride: draft.lines.some((l) => l.short),
      totalCartons: draft.totalCartons ?? null,
      packedById: draft.packedById ?? null,
      notes: draft.notes ?? null,
      integrationId: draft.integrationId ?? null,
      externalOrderId: draft.externalOrderId ?? null,
      codAmount: draft.codAmount ?? null,
      paymentMethod: draft.paymentMethod ?? null,
      items: { create: itemRows(ctx, draft.lines, totals.lineTotals, draft.overrideReason) },
    },
  });
  await reserveLines(tx, ctx, draft.warehouseId, draft.lines);
  if (draft.partyId) await recordPartyActivity(draft.partyId, order.orderDate, tx);
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "SalesOrder",
      entityId: order.id,
      summary: `Order ${order.number} (${draft.channel}) for ${draft.lines.reduce((s, l) => s + l.quantity, 0)} pcs, total ${order.total.toFixed(2)}`,
    },
    tx,
  );
  await auditOverride(tx, ctx, meta, order, draft.lines, draft.overrideReason);
  return order;
}

/**
 * Checkout: validates stock (or Force Override), confirms the order, reserves
 * stock, and optionally takes a payment and creates the invoice, packing list
 * and delivery challan in the same step. All or nothing.
 */
export async function createOrder(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createOrderSchema.parse(raw);
  if (input.shipmentDate) checkShipmentDate(ctx, input.shipmentDate, input.orderDate ?? new Date());
  if (input.payment || input.useCredit) assertCanRecordReceipts(ctx);
  const docs = { invoice: true, packingList: false, deliveryChallan: false, ...input.documents };
  if ((input.includePreviousDue || input.useCredit) && !docs.invoice) {
    const field = input.useCredit ? "useCredit" : "includePreviousDue";
    throw new AppError(
      "VALIDATION",
      "Issue the invoice with the order to include the previous due or use credit.",
      { [field]: ["Tick Issue the invoice"] },
    );
  }
  const party = input.partyId ? await assertPartyCanTransact(ctx, input.partyId, "SALE") : null;
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);
  const packer = await resolvePacker(ctx, input.packedById);
  const lines = await resolveOrderLines(ctx, input, input.channel, warehouse.id);
  assertStockOrOverride(ctx, lines, input.forceOverride);
  const { total } = orderTotals(lines, input);
  const credit = money(input.useCredit ?? 0);
  if (credit.gt(total)) {
    throw new AppError("VALIDATION", `Use at most ${total.toFixed(2)} of credit on this order.`, {
      useCredit: [`At most ${total.toFixed(2)}`],
    });
  }
  const paying = money(input.payment?.amount ?? 0);
  if (party) {
    await assertPartyCanTransact(
      ctx,
      party.id,
      "SALE",
      Number(Prisma.Decimal.max(total.minus(paying).minus(credit), 0)),
    );
  }
  const cheque = input.payment?.method === "CHEQUE" ? input.payment.cheque : undefined;
  // Above the order, money goes on the buyer's account: only with the invoice and a buyer.
  const extraAllowed = docs.invoice && party !== null && !cheque;
  if (input.payment && paying.plus(credit).gt(total) && !extraAllowed) {
    throw new AppError(
      "VALIDATION",
      `The payment is more than the order total (${total.toFixed(2)}).`,
    );
  }

  const orderId = await prisma.$transaction(async (tx) => {
    const order = await createOrderTx(
      tx,
      ctx,
      {
        channel: input.channel,
        partyId: party?.id ?? null,
        warehouseId: warehouse.id,
        orderDate: input.orderDate,
        shipmentDate: input.shipmentDate,
        lines,
        charges: input,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        shippingAddress: input.shippingAddress,
        notes: input.notes,
        overrideReason: input.forceOverride?.reason,
        totalCartons: input.totalCartons,
        packedById: packer?.id,
      },
      meta,
    );
    if (docs.invoice) {
      await issueInvoiceTx(
        tx,
        ctx,
        order.id,
        { includePreviousDue: input.includePreviousDue },
        meta,
      );
    }
    if (credit.gt(0)) await applyCreditTx(tx, ctx, { orderId: order.id, amount: credit }, meta);
    if (input.payment && cheque) {
      // A cheque is pending until cleared: nothing is posted and the order stays due.
      await recordChequeTx(
        tx,
        ctx,
        {
          orderId: order.id,
          amount: input.payment.amount,
          ...cheque,
          proofFileId: input.payment.proofFileId,
        },
        meta,
      );
    } else if (input.payment) {
      const { amount, method, accountId, reference, proofFileId } = input.payment;
      await receivePaymentTx(
        tx,
        ctx,
        {
          amount,
          method,
          accountId,
          reference,
          proofFileId,
          orderId: order.id,
          ...(extraAllowed ? { extra: input.includePreviousDue ? "OLDER_DUES" : "ADVANCE" } : {}),
        },
        meta,
      );
    }
    if (docs.packingList) await createPackingListTx(tx, ctx, order.id, {}, meta);
    if (docs.deliveryChallan) await createDeliveryChallanTx(tx, ctx, order.id, {}, meta);
    return order.id;
  }, TX_OPTIONS);
  return getOrder(ctx, orderId);
}

type EditedOrder = {
  warehouseId: string | null;
  discount: Prisma.Decimal;
  shippingCharge: Prisma.Decimal;
  tax: Prisma.Decimal;
  items: Array<{
    variantId: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    discount: Prisma.Decimal;
  }>;
  invoice: { id: string; status: string; total: Prisma.Decimal } | null;
  packingList: { id: string } | null;
};

/** What an edit is worked out from: lines, charges, invoice and packing list. */
function editBasis(o: EditedOrder) {
  return JSON.stringify({
    warehouseId: o.warehouseId,
    charges: [o.discount, o.shippingCharge, o.tax].map((v) => v.toFixed(2)),
    items: o.items
      .map((i) =>
        [i.variantId, i.quantity, i.unitPrice.toFixed(2), i.discount.toFixed(2)].join(":"),
      )
      .sort(),
    invoice: o.invoice ? [o.invoice.id, o.invoice.status, o.invoice.total.toFixed(2)] : null,
    packingList: o.packingList?.id ?? null,
  });
}

/**
 * Edits an order before anything has left the warehouse. Reservations are
 * redone. An order with a live invoice is edited only with `reviseInvoice`
 * (Smart Edit): the invoice keeps its number and takes the new total, its sale
 * is posted again and its packing list follows the new lines. A fully paid
 * invoice is locked; without the flag the invoice has to be voided first.
 * The online shops' API (CN-005) also sets the COD amount and edits only
 * before packing (`beforePacking`).
 */
export async function updateOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
  options: { codAmount?: number; beforePacking?: boolean } = {},
) {
  const { reviseInvoice, ...input } = updateOrderSchema.parse(raw);
  const order = await ctx.db.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { variant: { select: { sku: true } } } },
      invoice: true,
      packingList: true,
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  assertAllowed(
    canEditOrder(order, piecesOf(await deliveredByVariant(prisma, order.id)), {
      revise: reviseInvoice,
      beforePacking: options.beforePacking,
    }),
  );
  const revising = live(order.invoice);
  if (revising && !ctx.can("sales.invoice.edit")) {
    throw new AppError(
      "FORBIDDEN",
      `Editing this order revises invoice ${revising.number}; you may not edit invoices.`,
    );
  }
  if (!order.warehouseId) throw new AppError("CONFLICT", "The order has no warehouse.");
  if (input.packedById && input.packedById !== order.packedById) {
    await resolvePacker(ctx, input.packedById);
  }

  const linesChanged = Boolean(input.lines || input.matrix);
  const ownReserved = new Map(order.items.map((i) => [i.variantId, i.quantity]));
  const lines: ResolvedLine[] = linesChanged
    ? await resolveOrderLines(ctx, input, order.channel, order.warehouseId, ownReserved)
    : order.items.map((i) => ({
        variantId: i.variantId,
        sku: i.variant.sku,
        styleId: "",
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
        available: i.availableAtSale ?? 0,
        short: i.forceOverride,
      }));
  if (linesChanged) assertStockOrOverride(ctx, lines, input.forceOverride);
  const charges = {
    discount: input.discount ?? Number(order.discount),
    shippingCharge: input.shippingCharge ?? Number(order.shippingCharge),
    tax: input.tax ?? Number(order.tax),
  };
  const totals = orderTotals(lines, charges);
  if (totals.total.lt(order.paidAmount)) {
    throw new AppError(
      "VALIDATION",
      `The new total is less than the ${order.paidAmount.toFixed(2)} already paid.`,
    );
  }
  if (order.partyId && totals.total.gt(order.total)) {
    await assertPartyCanTransact(
      ctx,
      order.partyId,
      "SALE",
      Number(totals.total.minus(order.total)),
    );
  }

  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "SalesOrder", order.id);
    // Read again under the lock: another edit, a payment or a delivery may have come first.
    const current = await tx.salesOrder.findFirstOrThrow({
      where: { id: order.id, companyId: ctx.company.id },
      include: { items: true, invoice: true, packingList: true },
    });
    if (editBasis(current) !== editBasis(order)) {
      throw new AppError(
        "CONFLICT",
        `Order ${order.number} was changed by someone else just now. Open it again and make your change once more.`,
      );
    }
    assertAllowed(
      canEditOrder(current, piecesOf(await deliveredByVariant(tx, order.id)), {
        revise: reviseInvoice,
        beforePacking: options.beforePacking,
      }),
    );
    if (totals.total.lt(current.paidAmount)) {
      throw new AppError(
        "VALIDATION",
        `The new total is less than the ${current.paidAmount.toFixed(2)} already paid.`,
      );
    }
    if (linesChanged) {
      for (const item of current.items) {
        await releaseStock(
          tx,
          { companyId: ctx.company.id, warehouseId: order.warehouseId!, variantId: item.variantId },
          item.quantity,
        );
      }
      await tx.salesOrderItem.deleteMany({ where: { orderId: order.id } });
      await tx.salesOrderItem.createMany({
        data: itemRows(ctx, lines, totals.lineTotals, input.forceOverride?.reason).map((i) => ({
          ...i,
          orderId: order.id,
        })),
      });
      await reserveLines(tx, ctx, order.warehouseId!, lines);
      if (order.packingList && revising) {
        // A revised invoice keeps its packing list (its page 2) under the same
        // number, now with the new lines, loose and not picked yet.
        await tx.packingListItem.deleteMany({ where: { packingListId: order.packingList.id } });
        await tx.packingListItem.createMany({
          data: lines.map((l) => ({
            packingListId: order.packingList!.id,
            variantId: l.variantId,
            quantity: l.quantity,
          })),
        });
      } else if (order.packingList) {
        // The pick-list no longer matches; it is made again from the new lines.
        await tx.packingList.delete({ where: { id: order.packingList.id } });
      }
    }
    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        subtotal: totals.subtotal,
        discount: totals.discount,
        shippingCharge: totals.shippingCharge,
        tax: totals.tax,
        total: totals.total,
        dueAmount: Prisma.Decimal.max(totals.total.minus(current.paidAmount), 0),
        hasForceOverride: lines.some((l) => l.short),
        ...(linesChanged && current.status === "PACKED" && !(revising && order.packingList)
          ? { status: "CONFIRMED" }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
        ...(input.customerPhone !== undefined ? { customerPhone: input.customerPhone } : {}),
        ...(input.shippingAddress !== undefined ? { shippingAddress: input.shippingAddress } : {}),
        ...(options.codAmount !== undefined ? { codAmount: options.codAmount } : {}),
        ...logisticsOf(input),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `Edited order ${order.number}: ${[
          ...Object.keys(input),
          ...(options.codAmount !== undefined ? ["codAmount"] : []),
        ].join(", ")}`,
        before: { total: order.total.toFixed(2) },
        after: { total: totals.total.toFixed(2) },
      },
      tx,
    );
    if (linesChanged) await auditOverride(tx, ctx, meta, order, lines, input.forceOverride?.reason);
    if (revising) await reviseInvoiceTx(tx, ctx, order.id, revising.total, meta);
  }, TX_OPTIONS);
  return getOrder(ctx, order.id);
}

/** The message when money still held on an order or proforma stops it being cancelled. */
export function settleFirstMessage(held: Prisma.Decimal, number: string) {
  return `${held.toFixed(2)} paid on ${number} has to be settled first: Accounts can pay it back, keep it as credit on the buyer's account or keep it as a cancellation charge.`;
}

/**
 * Cancels an order: frees the reserved stock and voids its invoice. Pieces
 * already delivered come back into stock only with `returnDelivered` (Safe
 * Void, for people who may void invoices). Money still held on it is settled
 * with `settle` (paid back, kept as the buyer's credit or kept as a
 * cancellation charge, which needs Accounts' money keys); without it the order
 * is not cancelled until Accounts has refunded the money.
 */
export async function cancelOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason, settle, returnDelivered } = cancelOrderSchema.parse(raw);
  const order = await ctx.db.salesOrder.findUnique({
    where: { id: orderId },
    include: { items: true, invoice: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  const deliveredBefore = piecesOf(await deliveredByVariant(prisma, order.id));
  assertAllowed(canCancelOrder(order, deliveredBefore, { returnDelivered }));
  if (deliveredBefore > 0 && !ctx.can("sales.invoice.edit")) {
    throw new AppError(
      "FORBIDDEN",
      "Taking delivered goods back into stock needs the right to void invoices.",
    );
  }
  if (order.paidAmount.gt(0) && !settle) {
    throw new AppError("CONFLICT", settleFirstMessage(order.paidAmount, order.number), {
      settle: ["Say how to settle the money paid on this order"],
    });
  }
  if (settle) assertCanRefund(ctx, settle.kind);
  const liveInvoice = live(order.invoice);
  if (liveInvoice && !ctx.can("sales.invoice.edit")) {
    throw new AppError(
      "FORBIDDEN",
      `Cancelling also voids invoice ${liveInvoice.number}; you may not void invoices.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "SalesOrder", order.id);
    // Read again under the lock: an edit may have changed its lines since.
    const current = await tx.salesOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, invoice: true },
    });
    const delivered = await deliveredByVariant(tx, order.id);
    assertAllowed(canCancelOrder(current, piecesOf(delivered), { returnDelivered }));
    if (piecesOf(delivered) > 0 && !ctx.can("sales.invoice.edit")) {
      throw new AppError(
        "FORBIDDEN",
        "Taking delivered goods back into stock needs the right to void invoices.",
      );
    }
    const invoice = live(current.invoice);
    if (invoice) {
      if (!ctx.can("sales.invoice.edit")) {
        throw new AppError(
          "FORBIDDEN",
          `Cancelling also voids invoice ${invoice.number}; you may not void invoices.`,
        );
      }
      // Its payments become an advance again, so they can be settled below.
      await voidInvoiceTx(tx, ctx, invoice, `Order cancelled: ${reason}`, meta);
    }
    const held = await heldOnOrder(tx, order.id);
    let settled = "";
    if (held.gt(0)) {
      if (!settle) {
        throw new AppError("CONFLICT", settleFirstMessage(held, order.number), {
          settle: ["Say how to settle the money paid on this order"],
        });
      }
      const refund = await refundBuyerTx(
        tx,
        ctx,
        { ...settle, orderId: order.id, amount: held, reason: `Order cancelled: ${reason}` },
        meta,
      );
      settled = ` (${held.toFixed(2)} paid ${REFUND_KIND_TEXT[settle.kind]}, ${refund.number})`;
    }
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { status: "CANCELLED", dueAmount: 0 },
    });
    if (current.warehouseId) {
      // Delivery already took its pieces off the reservation; only the rest is freed.
      const left = new Map(delivered);
      for (const item of current.items) {
        const out = Math.min(left.get(item.variantId) ?? 0, item.quantity);
        left.set(item.variantId, (left.get(item.variantId) ?? 0) - out);
        await releaseStock(
          tx,
          {
            companyId: ctx.company.id,
            warehouseId: current.warehouseId,
            variantId: item.variantId,
          },
          item.quantity - out,
        );
      }
    }
    const restocked = piecesOf(delivered) > 0 ? await restockDeliveredTx(tx, ctx, order) : 0;
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `Cancelled order ${order.number}: ${reason}${settled}${
          restocked > 0 ? `; ${restocked} delivered pcs back in stock` : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getOrder(ctx, order.id);
}

/**
 * Safe Void after delivery: the order's delivered pieces come back into good
 * stock where they left from, at the cost they left at (re-weighting the SKU's
 * average cost), and the cost of goods its challans posted is reversed. Returns
 * the pieces taken back.
 */
async function restockDeliveredTx(
  tx: Tx,
  ctx: CompanyContext,
  order: { id: string; number: string },
) {
  const moves = await tx.stockMovement.findMany({
    where: { referenceType: "SalesOrder", referenceId: order.id, type: "SALE_OUT" },
    select: { variantId: true, warehouseId: true, quantity: true, unitCost: true },
  });
  const back = new Map<
    string,
    { variantId: string; warehouseId: string; pieces: number; value: Prisma.Decimal }
  >();
  for (const m of moves) {
    const key = `${m.variantId}:${m.warehouseId}`;
    const entry = back.get(key) ?? {
      variantId: m.variantId,
      warehouseId: m.warehouseId,
      pieces: 0,
      value: new Prisma.Decimal(0),
    };
    entry.pieces -= m.quantity; // out is negative
    entry.value = entry.value.plus((m.unitCost ?? new Prisma.Decimal(0)).times(-m.quantity));
    back.set(key, entry);
  }
  let pieces = 0;
  const coming = [...back.values()]
    .filter((e) => e.pieces > 0)
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  // Every SKU first, in a fixed order, so two of these never wait on each other.
  await lockRows(
    tx,
    "ProductVariant",
    coming.map((e) => e.variantId),
  );
  for (const entry of coming) {
    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: entry.variantId },
      select: { sku: true, avgCost: true },
    });
    const onHand = await tx.stockBalance.aggregate({
      where: { variantId: entry.variantId, grade: "A_GRADE" },
      _sum: { quantity: true },
    });
    const unitCost = entry.value.dividedBy(entry.pieces);
    const key = {
      variantId: entry.variantId,
      warehouseId: entry.warehouseId,
      grade: "A_GRADE" as const,
    };
    await tx.stockBalance.upsert({
      where: { variantId_warehouseId_grade: key },
      create: { ...key, companyId: ctx.company.id, quantity: entry.pieces },
      update: { quantity: { increment: entry.pieces } },
    });
    const movement = await tx.stockMovement.create({
      data: {
        ...key,
        companyId: ctx.company.id,
        type: "RETURN_RESTOCK",
        quantity: entry.pieces,
        unitCost: unitCost.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
        referenceType: "SalesOrder",
        referenceId: order.id,
        note: `${order.number} cancelled`,
        createdById: ctx.user.id,
      },
    });
    // They re-weight the average cost and put right the cost of pieces sold short meanwhile.
    await receiveAtCostTx(tx, ctx, {
      variant: { id: entry.variantId, sku: variant.sku },
      grade: "A_GRADE",
      onHand: onHand._sum.quantity ?? 0,
      average: variant.avgCost,
      quantity: entry.pieces,
      unitCost,
      movementId: movement.id,
    });
    pieces += entry.pieces;
  }
  // The cost of goods each challan posted goes back to Inventory.
  const challans = await tx.deliveryChallan.findMany({
    where: { orderId: order.id },
    select: { id: true, number: true },
  });
  const entries = await tx.journalEntry.findMany({
    where: {
      companyId: ctx.company.id,
      sourceType: "SALE",
      sourceId: { in: challans.map((c) => c.id) },
      isReversed: false,
      reversalOfId: null,
    },
    select: { id: true, sourceId: true },
  });
  for (const entry of entries) {
    const challan = challans.find((c) => c.id === entry.sourceId);
    await reverseJournalEntry(tx, entry.id, {
      description: `Goods back in stock — ${order.number}${challan ? ` / ${challan.number}` : ""} cancelled`,
      postedById: ctx.user.id,
    });
  }
  return pieces;
}

/**
 * Voids an invoice. With `cancelOrder` (Safe Void) its order is cancelled too:
 * reserved stock is freed, delivered pieces come back into stock, the sale is
 * reversed and money held is settled (`settle`). Without it the order stays
 * open to be corrected and invoiced again.
 */
export async function voidOrCancelInvoice(
  ctx: CompanyContext,
  invoiceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = voidInvoiceSchema.parse(raw);
  if (!input.cancelOrder) return voidInvoice(ctx, invoiceId, input, meta);
  const invoice = await ctx.db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, orderId: true, status: true },
  });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.");
  assertAllowed(canVoidInvoice(invoice));
  await cancelOrder(
    ctx,
    invoice.orderId,
    { reason: input.reason, settle: input.settle, returnDelivered: true },
    meta,
  );
  return prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
}

/**
 * Sets or clears how an order's goods go out (cartons, who packed them) at any
 * time before it is cancelled or returned. A packing list made already shows the
 * new carton count too.
 */
export async function setOrderLogistics(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = orderLogisticsSchema.parse(raw);
  const order = await ctx.db.salesOrder.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, status: true, totalCartons: true, packedById: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  assertAllowed(canSetLogistics(order));
  if (input.packedById && input.packedById !== order.packedById) {
    await resolvePacker(ctx, input.packedById);
  }
  const data = logisticsOf(input);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.salesOrder.updateMany({
      where: {
        id: order.id,
        companyId: ctx.company.id,
        status: { notIn: ["CANCELLED", "RETURNED"] },
      },
      data,
    });
    if (count === 0)
      throw new AppError("CONFLICT", "This order just changed. Refresh and try again.");
    if (data.totalCartons !== undefined) {
      await tx.packingList.updateMany({
        where: { orderId: order.id },
        data: { cartons: data.totalCartons },
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `Logistics of ${order.number}: cartons ${order.totalCartons ?? "none"} -> ${input.totalCartons === undefined ? (order.totalCartons ?? "none") : (input.totalCartons ?? "none")}${data.packedById !== undefined && data.packedById !== order.packedById ? ", packer changed" : ""}`,
        before: { totalCartons: order.totalCartons, packedById: order.packedById },
        after: data,
      },
      tx,
    );
  });
  return getOrder(ctx, order.id);
}

/**
 * Whether a buyer may take `amount` more on credit: the same check an order
 * runs when it is saved (account open, credit limit), asked before placing it.
 */
export async function checkBuyerCredit(ctx: CompanyContext, raw: unknown) {
  const { partyId, amount } = creditCheckSchema.parse(raw);
  await assertPartyCanTransact(ctx, partyId, "SALE", amount);
  return { ok: true as const };
}

/**
 * Sets, moves or clears the day an open order is due to ship. Shipment
 * reminders follow it (a moved date starts its reminders afresh).
 */
export async function setOrderShipmentDate(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { shipmentDate } = orderShipmentSchema.parse(raw);
  const order = await ctx.db.salesOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  assertAllowed(canSetShipmentDate(order));
  if (shipmentDate) checkShipmentDate(ctx, shipmentDate, order.orderDate);
  const before = dateOnly(order.shipmentDate);
  if (before !== shipmentDate) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.salesOrder.updateMany({
        where: { id: order.id, companyId: ctx.company.id, status: { in: [...SHIPMENT_OPEN] } },
        data: { shipmentDate: shipmentDate ? dateColumn(shipmentDate) : null },
      });
      if (count === 0)
        throw new AppError("CONFLICT", "This order just changed. Refresh and try again.");
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "SalesOrder",
          entityId: order.id,
          summary: `Shipment date of ${order.number}: ${before ?? "none"} -> ${shipmentDate ?? "none"}`,
          before: { shipmentDate: before },
          after: { shipmentDate },
        },
        tx,
      );
    });
  }
  return getOrder(ctx, order.id);
}

/** Refunds as listed on an order or proforma (void ones too, marked by voidedAt). */
export const refundSummary = {
  id: true,
  number: true,
  kind: true,
  amount: true,
  method: true,
  refundDate: true,
  reason: true,
  voidedAt: true,
} as const;

/**
 * Order with lines (delivered / remaining), documents, payments and refunds. What
 * delivered pieces cost (unitCost) shows only to people who see the financials.
 */
export async function getOrder(ctx: CompanyContext, orderId: string) {
  const order = await ctx.db.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      party: {
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
          grade: true,
          isVerified: true,
          status: true,
          systemRole: true,
        },
      },
      warehouse: { select: { id: true, name: true } },
      packedBy: { select: { id: true, code: true, name: true } },
      items: {
        include: {
          variant: {
            select: {
              sku: true,
              styleId: true,
              style: { select: { code: true, name: true } },
              color: { select: { name: true, hexCode: true } },
              size: { select: { name: true } },
            },
          },
        },
      },
      invoice: true,
      packingList: { include: { items: true } },
      deliveryChallans: { orderBy: { deliveryDate: "asc" }, include: { items: true } },
      payments: {
        orderBy: { paymentDate: "asc" },
        select: {
          id: true,
          number: true,
          amount: true,
          method: true,
          paymentDate: true,
          isAdvance: true,
        },
      },
      refunds: { orderBy: [{ refundDate: "asc" }, { id: "asc" }], select: refundSummary },
      proforma: {
        select: { id: true, number: true, quotation: { select: { id: true, number: true } } },
      },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  const delivered = await deliveredByVariant(prisma, order.id);
  const showCosts = canSeeFinancials(ctx);
  return {
    ...order,
    shipmentDate: dateOnly(order.shipmentDate),
    items: order.items.map((i) => ({
      ...i,
      unitCost: showCosts ? i.unitCost : null,
      delivered: delivered.get(i.variantId) ?? 0,
      remaining: i.quantity - (delivered.get(i.variantId) ?? 0),
    })),
    totalPieces: order.items.reduce((s, i) => s + i.quantity, 0),
    letterhead: await letterhead(ctx),
  };
}

export async function listOrders(ctx: CompanyContext, raw: unknown = {}) {
  const q = listOrdersSchema.parse(raw);
  const take = q.take ?? 50;
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const rows = await ctx.db.salesOrder.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(start || end
        ? { orderDate: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
        : {}),
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: "insensitive" } },
              { customerName: { contains: q.search, mode: "insensitive" } },
              { customerPhone: { contains: q.search } },
              { party: { name: { contains: q.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      party: { select: { id: true, code: true, name: true } },
      invoice: { select: { id: true, number: true, status: true } },
      _count: { select: { items: true } },
    },
    orderBy: [{ orderDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return {
    items: items.map((o) => ({ ...o, shipmentDate: dateOnly(o.shipmentDate) })),
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  };
}
