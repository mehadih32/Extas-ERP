import { Prisma, type SalesChannel } from "@prisma/client";

import { dayRange } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { getDefaultWarehouse } from "@/modules/inventory/stock.service";
import { assertPartyCanTransact, recordPartyActivity } from "@/modules/parties/party.service";
import {
  createDeliveryChallanTx,
  createPackingListTx,
  deliveredByVariant,
  issueInvoiceTx,
  voidInvoiceTx,
} from "@/modules/sales/documents.service";
import { receivePaymentTx } from "@/modules/sales/payment.service";
import { lockRow } from "@/modules/sales/posting";
import {
  assertStockOrOverride,
  type ResolvedLine,
  resolveOrderLines,
} from "@/modules/sales/pricing";
import {
  cancelOrderSchema,
  createOrderSchema,
  listOrdersSchema,
  updateOrderSchema,
} from "@/modules/sales/schemas";
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

async function resolveWarehouse(ctx: CompanyContext, warehouseId?: string) {
  if (!warehouseId) return getDefaultWarehouse(ctx);
  const warehouse = await ctx.db.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found.");
  return warehouse;
}

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

type OrderDraft = {
  channel: SalesChannel;
  partyId: string | null;
  proformaId?: string;
  warehouseId: string;
  orderDate?: Date;
  lines: ResolvedLine[];
  charges: { discount?: number; shippingCharge?: number; tax?: number };
  customerName?: string | null;
  customerPhone?: string | null;
  shippingAddress?: string | null;
  notes?: string | null;
  overrideReason?: string;
};

/** Creates a confirmed order and reserves its stock (inside a transaction). */
export async function createOrderTx(
  tx: Tx,
  ctx: CompanyContext,
  draft: OrderDraft,
  meta?: RequestMeta,
) {
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
      orderDate: draft.orderDate ?? new Date(),
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
      notes: draft.notes ?? null,
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
  const party = input.partyId ? await assertPartyCanTransact(ctx, input.partyId, "SALE") : null;
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);
  const lines = await resolveOrderLines(ctx, input, input.channel, warehouse.id);
  assertStockOrOverride(ctx, lines, input.forceOverride);
  const { total } = orderTotals(lines, input);
  if (party) {
    await assertPartyCanTransact(
      ctx,
      party.id,
      "SALE",
      Number(total.minus(input.payment?.amount ?? 0)),
    );
  }
  if (input.payment && money(input.payment.amount).gt(total)) {
    throw new AppError(
      "VALIDATION",
      `The payment is more than the order total (${total.toFixed(2)}).`,
    );
  }
  const docs = { invoice: true, packingList: false, deliveryChallan: false, ...input.documents };

  const orderId = await prisma.$transaction(async (tx) => {
    const order = await createOrderTx(
      tx,
      ctx,
      {
        channel: input.channel,
        partyId: party?.id ?? null,
        warehouseId: warehouse.id,
        orderDate: input.orderDate,
        lines,
        charges: input,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        shippingAddress: input.shippingAddress,
        notes: input.notes,
        overrideReason: input.forceOverride?.reason,
      },
      meta,
    );
    if (docs.invoice) await issueInvoiceTx(tx, ctx, order.id, {}, meta);
    if (input.payment) {
      await receivePaymentTx(tx, ctx, { ...input.payment, orderId: order.id }, meta);
    }
    if (docs.packingList) await createPackingListTx(tx, ctx, order.id, {}, meta);
    if (docs.deliveryChallan) await createDeliveryChallanTx(tx, ctx, order.id, {}, meta);
    return order.id;
  }, TX_OPTIONS);
  return getOrder(ctx, orderId);
}

/**
 * Edits an order before anything has left the warehouse and while it has no
 * live invoice (void the invoice first). Reservations are redone.
 */
export async function updateOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateOrderSchema.parse(raw);
  const order = await ctx.db.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { variant: { select: { sku: true } } } },
      invoice: true,
      packingList: true,
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  if (!["CONFIRMED", "PACKED"].includes(order.status)) {
    throw new AppError("CONFLICT", `A ${order.status.toLowerCase()} order cannot be edited.`);
  }
  if (order.invoice && order.invoice.status !== "VOID") {
    throw new AppError(
      "CONFLICT",
      `Void invoice ${order.invoice.number} before editing the order.`,
    );
  }
  if ((await deliveredByVariant(prisma, order.id)).size > 0) {
    throw new AppError("CONFLICT", "Part of this order is already delivered.");
  }
  if (!order.warehouseId) throw new AppError("CONFLICT", "The order has no warehouse.");

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
    if (linesChanged) {
      for (const item of order.items) {
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
      if (order.packingList) {
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
        dueAmount: Prisma.Decimal.max(totals.total.minus(order.paidAmount), 0),
        hasForceOverride: lines.some((l) => l.short),
        ...(linesChanged && order.status === "PACKED" ? { status: "CONFIRMED" } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
        ...(input.customerPhone !== undefined ? { customerPhone: input.customerPhone } : {}),
        ...(input.shippingAddress !== undefined ? { shippingAddress: input.shippingAddress } : {}),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `Edited order ${order.number}: ${Object.keys(input).join(", ")}`,
        before: { total: order.total.toFixed(2) },
        after: { total: totals.total.toFixed(2) },
      },
      tx,
    );
    if (linesChanged) await auditOverride(tx, ctx, meta, order, lines, input.forceOverride?.reason);
  }, TX_OPTIONS);
  return getOrder(ctx, order.id);
}

/**
 * Cancels an order that has not been delivered: frees the reserved stock and
 * voids its invoice. Orders with payments need a refund first (Accounts).
 */
export async function cancelOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = cancelOrderSchema.parse(raw);
  const order = await ctx.db.salesOrder.findUnique({
    where: { id: orderId },
    include: { items: true, invoice: true },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  if (order.status === "CANCELLED")
    throw new AppError("CONFLICT", "This order is already cancelled.");
  if ((await deliveredByVariant(prisma, order.id)).size > 0) {
    throw new AppError("CONFLICT", "Goods on this order were delivered; record a return instead.");
  }
  if (order.paidAmount.gt(0)) {
    throw new AppError(
      "CONFLICT",
      `${order.paidAmount.toFixed(2)} was paid on this order; refund it before cancelling.`,
    );
  }
  const liveInvoice = order.invoice && order.invoice.status !== "VOID" ? order.invoice : null;
  if (liveInvoice && !ctx.can("sales.invoice.edit")) {
    throw new AppError(
      "FORBIDDEN",
      `Cancelling also voids invoice ${liveInvoice.number}; you may not void invoices.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "SalesOrder", order.id);
    const { count } = await tx.salesOrder.updateMany({
      where: { id: order.id, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED", dueAmount: 0 },
    });
    if (count === 0) throw new AppError("CONFLICT", "This order is already cancelled.");
    if (liveInvoice) {
      await voidInvoiceTx(tx, ctx, liveInvoice, `Order cancelled: ${reason}`, meta);
    }
    if (order.warehouseId) {
      for (const item of order.items) {
        await releaseStock(
          tx,
          { companyId: ctx.company.id, warehouseId: order.warehouseId, variantId: item.variantId },
          item.quantity,
        );
      }
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `Cancelled order ${order.number}: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getOrder(ctx, order.id);
}

/** Order with lines (delivered / remaining), documents and payments. */
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
        },
      },
      warehouse: { select: { id: true, name: true } },
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
      proforma: { select: { id: true, number: true } },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  const delivered = await deliveredByVariant(prisma, order.id);
  return {
    ...order,
    items: order.items.map((i) => ({
      ...i,
      delivered: delivered.get(i.variantId) ?? 0,
      remaining: i.quantity - (delivered.get(i.variantId) ?? 0),
    })),
    totalPieces: order.items.reduce((s, i) => s + i.quantity, 0),
    letterhead: letterhead(ctx.company),
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
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}
