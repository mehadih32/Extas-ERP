import { type PaymentMethod, Prisma, type SalesOrderStatus } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { availableByVariant } from "@/modules/inventory/stock.service";
import {
  createDeliveryChallanTx,
  createPackingListTx,
  deliveredByVariant,
  issueInvoiceTx,
} from "@/modules/sales/documents.service";
import { cancelOrder, createOrderTx, updateOrder } from "@/modules/sales/order.service";
import { heldOnOrder } from "@/modules/sales/posting";
import type { ResolvedLine } from "@/modules/sales/pricing";
import { canEditOrder, liveInvoice } from "@/modules/sales/rules";
import {
  deliveryChallanSchema,
  issueInvoiceSchema,
  packingListSchema,
} from "@/modules/sales/schemas";
import { releaseStock } from "@/modules/sales/stock-ops";
import { collectOrderLines } from "@/modules/sales/totals";

import { amount, variantActive } from "./catalog.service";
import { EcommerceApiError } from "./errors";
import type { ShopCall } from "./route";
import {
  createOrderSchema,
  externalOrderIdSchema,
  type ShopOrder,
  type ShopPaymentMethod,
  type ShortStock,
  updateOrderSchema,
} from "./schemas";

/*
 * Website orders through the e-commerce API (CN-005). The shop's order becomes
 * an ERP sales order through the ERP's own services, in the shop's account
 * (shop-account.ts), so every rule of the Sales screens holds:
 *   POST /orders     a confirmed WEBSITE order for a walk-in buyer, its stock
 *                    reserved in the shop's warehouse. The shop is the price
 *                    source here: its prices and discounts are kept as sent.
 *                    Never sold beyond stock (no Force Override): every short
 *                    SKU comes back in one 409.
 *   PATCH /orders/x  edits before packing, and the status steps: processing,
 *                    packed (the packing list), delivered (the invoice and the
 *                    delivery challan: stock out, sale and cost of goods
 *                    posted), cancelled and returned undelivered (the
 *                    reservation freed). Money already paid is never paid back
 *                    by the API: Accounts settles it in the ERP.
 */

type Call = Pick<ShopCall, "integration" | "ctx" | "meta">;
type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 30_000 };

/** How the shop's buyer pays, as the ERP names it. */
const PAYMENT_METHOD: Record<ShopPaymentMethod, PaymentMethod> = {
  COD: "COURIER_COD",
  BKASH: "BKASH",
  NAGAD: "NAGAD",
  CARD: "CARD",
};

const lower = (status: string) => status.toLowerCase().replace(/_/g, " ");
const piecesOf = (bySku: Map<string, number>) => [...bySku.values()].reduce((a, b) => a + b, 0);

const isAppError = (error: unknown, code: string): error is AppError =>
  error instanceof AppError && error.code === code;

const isUniqueClash = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** The order as the API answers it. */
export async function shopOrderOf(ctx: CompanyContext, orderId: string): Promise<ShopOrder> {
  const o = await ctx.db.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { variant: { select: { sku: true } } }, orderBy: { id: "asc" } } },
  });
  return {
    erpOrderId: o.id,
    erpOrderNumber: o.number,
    externalOrderId: o.externalOrderId ?? "",
    status: o.status,
    total: amount(o.total),
    paid: amount(o.paidAmount),
    due: amount(o.dueAmount),
    codAmount: amount(o.codAmount),
    items: o.items.map((i) => ({
      sku: i.variant.sku,
      quantity: i.quantity,
      unitPrice: amount(i.unitPrice),
      discount: amount(i.discount),
    })),
  };
}

/** This shop's order with the shop's own id (another shop's or company's is never found). */
export async function findShopOrder(call: Pick<Call, "ctx" | "integration">, externalId: string) {
  return call.ctx.db.salesOrder.findFirst({
    where: { integrationId: call.integration.id, externalOrderId: externalId },
  });
}

export async function shopOrderOrNotFound(
  call: Pick<Call, "ctx" | "integration">,
  externalId: string,
) {
  const order = await findShopOrder(call, externalOrderIdSchema.parse(externalId));
  if (!order) {
    throw new EcommerceApiError(
      404,
      "NOT_FOUND",
      `There is no order ${externalId} from this shop in the ERP.`,
    );
  }
  return order;
}

const orderExists = (order: { id: string; number: string }) =>
  new EcommerceApiError(
    409,
    "ORDER_EXISTS",
    `This order is in the ERP already as ${order.number}: change it with PATCH /orders/{externalOrderId}.`,
    { erpOrderId: order.id, erpOrderNumber: order.number },
  );

type ShopItem = { sku: string; quantity: number; unitPrice: number; discount: number };
type ShopLine = {
  variantId: string;
  sku: string;
  styleId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};

/**
 * The shop's items as ERP SKUs, a SKU sent twice taken as one line (as the
 * order screens do). Unknown and inactive SKUs are refused, all in one answer.
 */
async function resolveItems(ctx: CompanyContext, items: ShopItem[]): Promise<ShopLine[]> {
  const skus = [...new Set(items.map((i) => i.sku))];
  const variants = await ctx.db.productVariant.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      styleId: true,
      isActive: true,
      removedAt: true,
      style: { select: { isActive: true } },
    },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));
  const unknownSkus = skus.filter((sku) => !bySku.has(sku));
  if (unknownSkus.length > 0) {
    throw new EcommerceApiError(
      422,
      "VALIDATION",
      `These SKUs are not in the ERP: ${unknownSkus.join(", ")}.`,
      { unknownSkus },
    );
  }
  const inactiveSkus = skus.filter((sku) => !variantActive(bySku.get(sku)!));
  if (inactiveSkus.length > 0) {
    throw new EcommerceApiError(
      422,
      "VALIDATION",
      `These SKUs are not for sale any more: ${inactiveSkus.join(", ")}.`,
      { inactiveSkus },
    );
  }
  const { lines } = collectOrderLines({
    lines: items.map((i) => ({
      variantId: bySku.get(i.sku)!.id,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
    })),
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  return lines.map((l) => ({
    variantId: l.variantId,
    sku: byId.get(l.variantId)!.sku,
    styleId: byId.get(l.variantId)!.styleId,
    quantity: l.quantity,
    unitPrice: l.unitPrice ?? 0,
    discount: l.discount ?? 0,
  }));
}

/**
 * The lines the warehouse cannot cover now: what each asks for and what is
 * available (`own`: what the order itself holds already, when it is edited).
 */
async function shortLines<L extends Pick<ShopLine, "variantId" | "sku" | "quantity">>(
  ctx: CompanyContext,
  warehouseId: string,
  lines: L[],
  own: Map<string, number> = new Map(),
): Promise<Array<L & { available: number }>> {
  const available = await availableByVariant(
    ctx,
    lines.map((l) => l.variantId),
    warehouseId,
  );
  return lines.map((l) => ({
    ...l,
    available: Math.max((available.get(l.variantId) ?? 0) + (own.get(l.variantId) ?? 0), 0),
  }));
}

function insufficientStock(short: ShortStock["shortSkus"]) {
  const details: ShortStock = { shortSkus: short };
  return new EcommerceApiError(
    409,
    "INSUFFICIENT_STOCK",
    `Not enough stock for ${short.map((s) => s.sku).join(", ")}: nothing was reserved.`,
    details,
  );
}

/** Refuses the lines when any is short, naming every short SKU. */
async function assertInStock(
  ctx: CompanyContext,
  warehouseId: string,
  lines: ShopLine[],
  own?: Map<string, number>,
) {
  const checked = await shortLines(ctx, warehouseId, lines, own);
  const short = checked.filter((l) => l.quantity > l.available);
  if (short.length > 0) {
    throw insufficientStock(
      short.map((l) => ({ sku: l.sku, requested: l.quantity, available: l.available })),
    );
  }
  return checked;
}

/**
 * A race for the last pieces was lost inside the transaction (nothing was
 * saved): the 409 lists every SKU short now, at least the one that lost.
 */
async function lostRace(
  ctx: CompanyContext,
  warehouseId: string,
  lines: ShopLine[],
  error: AppError,
) {
  const checked = await shortLines(ctx, warehouseId, lines);
  const lost = new Set(Object.keys(error.details ?? {}).map((k) => k.replace(/^stock\./, "")));
  const short = checked.filter((l) => l.quantity > l.available);
  return insufficientStock(
    (short.length > 0 ? short : checked.filter((l) => lost.has(l.sku))).map((l) => ({
      sku: l.sku,
      requested: l.quantity,
      available: l.available,
    })),
  );
}

/** The warehouse the shop sells from, or a 409 when none is set (or it was deleted). */
async function shopWarehouse(call: Call) {
  const warehouse = call.integration.warehouseId
    ? await call.ctx.db.warehouse.findFirst({
        where: { id: call.integration.warehouseId, deletedAt: null },
        select: { id: true },
      })
    : null;
  if (!warehouse) {
    throw new EcommerceApiError(
      409,
      "NO_WAREHOUSE",
      "This shop has no warehouse to sell from: choose one in the ERP (Settings > Integrations > E-commerce).",
    );
  }
  return warehouse.id;
}

/** POST /orders: the shop's order as a confirmed WEBSITE order, its stock reserved. */
export async function createShopOrder(call: Call, raw: unknown): Promise<ShopOrder> {
  const input = createOrderSchema.parse(raw);
  const { ctx, integration, meta } = call;
  const warehouseId = await shopWarehouse(call);
  const existing = await findShopOrder(call, input.externalOrderId);
  if (existing) throw orderExists(existing);
  const lines = await resolveItems(ctx, input.items);
  const checked = await assertInStock(ctx, warehouseId, lines);
  const resolved: ResolvedLine[] = checked.map((l) => ({
    variantId: l.variantId,
    sku: l.sku,
    styleId: l.styleId,
    quantity: l.quantity,
    unitPrice: new Prisma.Decimal(l.unitPrice),
    discount: new Prisma.Decimal(l.discount),
    available: l.available,
    short: false,
  }));
  try {
    const order = await runTransaction(
      (tx) =>
        createOrderTx(
          tx,
          ctx,
          {
            channel: "WEBSITE",
            partyId: null,
            warehouseId,
            orderDate: input.orderDate ? new Date(input.orderDate) : undefined,
            lines: resolved,
            charges: { shippingCharge: input.shippingFee },
            customerName: input.customer.name,
            customerPhone: input.customer.phone,
            shippingAddress: input.shippingAddress,
            notes: input.note ?? null,
            integrationId: integration.id,
            externalOrderId: input.externalOrderId,
            codAmount: input.codAmount,
            paymentMethod: PAYMENT_METHOD[input.paymentMethod],
          },
          meta,
        ),
      TX_OPTIONS,
    );
    return await shopOrderOf(ctx, order.id);
  } catch (error) {
    if (isAppError(error, "INSUFFICIENT_STOCK")) {
      throw await lostRace(ctx, warehouseId, lines, error);
    }
    if (isUniqueClash(error)) {
      // The same order came in twice at once: the other one was saved.
      const saved = await findShopOrder(call, input.externalOrderId);
      if (saved) throw orderExists(saved);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PATCH /orders/{externalOrderId}
// ---------------------------------------------------------------------------

type UpdateInput = ReturnType<typeof updateOrderSchema.parse>;

const orderLocked = (message: string) =>
  new EcommerceApiError(
    409,
    "ORDER_LOCKED",
    `${message} The shop changes an order only before it is packed.`,
  );

/** Items, charges and the buyer's details, while the order is not packed yet. */
async function editShopOrder(call: Call, orderId: string, input: UpdateInput) {
  const { ctx, meta } = call;
  const order = await ctx.db.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, invoice: true, packingList: { select: { number: true } } },
  });
  const verdict = canEditOrder(order, piecesOf(await deliveredByVariant(prisma, order.id)), {
    beforePacking: true,
  });
  if (!verdict.ok) throw orderLocked(verdict.message);
  const warehouseId = order.warehouseId!;

  let lines: ShopLine[] | undefined;
  if (input.items) {
    lines = await resolveItems(ctx, input.items);
    await assertInStock(
      ctx,
      warehouseId,
      lines,
      new Map(order.items.map((i) => [i.variantId, i.quantity])),
    );
  }
  try {
    await updateOrder(
      ctx,
      order.id,
      {
        ...(lines
          ? {
              lines: lines.map((l) => ({
                variantId: l.variantId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discount: l.discount,
              })),
            }
          : {}),
        ...(input.shippingFee !== undefined ? { shippingCharge: input.shippingFee } : {}),
        ...(input.customer
          ? { customerName: input.customer.name, customerPhone: input.customer.phone }
          : {}),
        ...(input.shippingAddress !== undefined ? { shippingAddress: input.shippingAddress } : {}),
        ...(input.note !== undefined ? { notes: input.note } : {}),
      },
      meta,
      { codAmount: input.codAmount, beforePacking: true },
    );
  } catch (error) {
    if (lines && isAppError(error, "INSUFFICIENT_STOCK")) {
      // The order still holds its old lines: what it holds counts as available to it.
      const checked = await shortLines(
        ctx,
        warehouseId,
        lines,
        new Map(order.items.map((i) => [i.variantId, i.quantity])),
      );
      const short = checked.filter((l) => l.quantity > l.available);
      throw short.length > 0
        ? insufficientStock(
            short.map((l) => ({ sku: l.sku, requested: l.quantity, available: l.available })),
          )
        : await lostRace(ctx, warehouseId, lines, error);
    }
    throw error;
  }
}

const statusChanged = async (
  tx: Tx,
  ctx: CompanyContext,
  meta: RequestMeta | undefined,
  order: { id: string; number: string },
  summary: string,
) =>
  auditInCompany(
    ctx,
    meta,
    { action: "STATUS_CHANGE", entityType: "SalesOrder", entityId: order.id, summary },
    tx,
  );

/** Reads the order under its lock: another change may have come first. */
async function lockedOrder(tx: Tx, ctx: CompanyContext, orderId: string) {
  await lockRow(tx, "SalesOrder", orderId);
  return tx.salesOrder.findFirstOrThrow({
    where: { id: orderId, companyId: ctx.company.id },
    include: { items: true, invoice: true, packingList: { select: { number: true } } },
  });
}

/** PROCESSING: a confirmed order the shop started working on (the status only). */
async function markProcessing(call: Call, orderId: string) {
  await runTransaction(async (tx) => {
    const order = await lockedOrder(tx, call.ctx, orderId);
    if (order.status === "PROCESSING") return;
    if (order.status !== "CONFIRMED") {
      throw new AppError(
        "CONFLICT",
        `This order is ${lower(order.status)}: only a confirmed order moves to processing.`,
      );
    }
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: "PROCESSING" } });
    await statusChanged(tx, call.ctx, call.meta, order, `Order ${order.number}: processing`);
  }, TX_OPTIONS);
}

/** PACKED: the packing list for every line (the order becomes packed). */
async function markPacked(call: Call, orderId: string) {
  await runTransaction(async (tx) => {
    const order = await lockedOrder(tx, call.ctx, orderId);
    if (order.status === "PACKED") return;
    if (order.status !== "CONFIRMED" && order.status !== "PROCESSING") {
      throw new AppError(
        "CONFLICT",
        `This order is ${lower(order.status)}: only a confirmed or processing order is packed.`,
      );
    }
    await createPackingListTx(tx, call.ctx, order.id, packingListSchema.parse({}), call.meta);
  }, TX_OPTIONS);
}

/**
 * DELIVERED: the invoice when the order has none (the sale posted to Walk-in
 * customers) and the delivery challan for what is left (stock out, cost of
 * goods posted). Inside the caller's transaction; false when it was delivered
 * already.
 */
export async function deliverShopOrderTx(
  tx: Tx,
  ctx: CompanyContext,
  orderId: string,
  meta?: RequestMeta,
) {
  const order = await lockedOrder(tx, ctx, orderId);
  if (order.status === "DELIVERED") return false;
  const closed: readonly SalesOrderStatus[] = [
    "DRAFT",
    "CANCELLED",
    "RETURNED",
    "PARTIALLY_RETURNED",
  ];
  if (closed.includes(order.status)) {
    throw new AppError("CONFLICT", `This order is ${lower(order.status)}: it cannot be delivered.`);
  }
  if (!liveInvoice(order.invoice)) {
    await issueInvoiceTx(tx, ctx, order.id, issueInvoiceSchema.parse({}), meta);
  }
  const delivered = await deliveredByVariant(tx, order.id);
  const left = order.items.reduce(
    (sum, i) => sum + Math.max(i.quantity - (delivered.get(i.variantId) ?? 0), 0),
    0,
  );
  if (left > 0) {
    await createDeliveryChallanTx(tx, ctx, order.id, deliveryChallanSchema.parse({}), meta);
  } else {
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  }
  return true;
}

const sendReturnsInstead = () =>
  new EcommerceApiError(
    409,
    "USE_RETURNS",
    "Goods on this order were delivered: send POST /returns with the QC result per item.",
  );

const paymentHeld = (held: Prisma.Decimal, number: string) =>
  new EcommerceApiError(
    409,
    "PAYMENT_HELD",
    `${held.toFixed(2)} paid on ${number} is held: Accounts settles it in the ERP first. The API never pays money back.`,
    { held: amount(held) },
  );

/** Why the order closed, added to its notes (kept on the order). */
const withReason = (notes: string | null, line: string) =>
  [notes, line].filter(Boolean).join("\n").slice(0, 4000);

/** CANCELLED: the ERP's own cancel, which frees the reservation. */
async function cancelShopOrder(call: Call, orderId: string, reason: string | undefined) {
  const { ctx, meta } = call;
  const order = await ctx.db.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { invoice: true },
  });
  if (piecesOf(await deliveredByVariant(prisma, order.id)) > 0) throw sendReturnsInstead();
  if (order.status === "RETURNED") {
    throw new AppError("CONFLICT", "This order came back already: its stock is free again.");
  }
  const held = await heldOnOrder(prisma, order.id);
  if (held.gt(0)) throw paymentHeld(held, order.number);
  const invoice = liveInvoice(order.invoice);
  if (invoice) {
    throw new AppError(
      "CONFLICT",
      `Invoice ${invoice.number} is issued for this order: it is cancelled in the ERP.`,
    );
  }
  const why = `Cancelled by the shop: ${reason ?? "no reason given"}`;
  try {
    await cancelOrder(ctx, order.id, { reason: why }, meta);
  } catch (error) {
    // Money came in meanwhile: the cancel waits for Accounts.
    if (error instanceof AppError && error.details?.settle) {
      throw paymentHeld(await heldOnOrder(prisma, order.id), order.number);
    }
    if (isAppError(error, "CONFLICT") && /delivered/.test(error.message))
      throw sendReturnsInstead();
    throw error;
  }
  await prisma.salesOrder.update({
    where: { id: order.id },
    data: { notes: withReason(order.notes, why) },
  });
}

/**
 * RETURNED before delivery: the parcel came back undelivered. The reservation
 * is freed as in a cancel and the order is marked returned with its reason.
 * Inside the caller's transaction; false when it was returned already.
 */
export async function returnUndeliveredTx(
  tx: Tx,
  ctx: CompanyContext,
  orderId: string,
  reason: string,
  meta?: RequestMeta,
) {
  const order = await lockedOrder(tx, ctx, orderId);
  if (order.status === "RETURNED") return false;
  if (order.status === "CANCELLED") {
    throw new AppError("CONFLICT", "This order is cancelled: it cannot come back.");
  }
  const delivered = await deliveredByVariant(tx, order.id);
  if (piecesOf(delivered) > 0) throw sendReturnsInstead();
  const held = await heldOnOrder(tx, order.id);
  if (held.gt(0)) throw paymentHeld(held, order.number);
  const invoice = liveInvoice(order.invoice);
  if (invoice) {
    throw new AppError(
      "CONFLICT",
      `Invoice ${invoice.number} is issued for this order: it is voided in the ERP first.`,
    );
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
  const why = `Came back undelivered: ${reason}`;
  await tx.salesOrder.update({
    where: { id: order.id },
    data: { status: "RETURNED", dueAmount: 0, notes: withReason(order.notes, why) },
  });
  await statusChanged(
    tx,
    ctx,
    meta,
    order,
    `Order ${order.number} came back undelivered, ${order.items.reduce((s, i) => s + i.quantity, 0)} pcs free again: ${reason}`,
  );
  return true;
}

/** PATCH /orders/{externalOrderId}: edits before packing, then the status step. */
export async function updateShopOrder(
  call: Call,
  externalId: string,
  raw: unknown,
): Promise<ShopOrder> {
  const input = updateOrderSchema.parse(raw);
  const order = await shopOrderOrNotFound(call, externalId);
  const editing = [
    input.items,
    input.shippingFee,
    input.codAmount,
    input.customer,
    input.shippingAddress,
    input.note,
  ].some((v) => v !== undefined);
  if (input.reason !== undefined && !input.status && !editing) {
    throw new EcommerceApiError(422, "VALIDATION", "Send the reason with a status.", {
      reason: ["Send it with status CANCELLED or RETURNED"],
    });
  }
  if (editing) await editShopOrder(call, order.id, input);
  switch (input.status) {
    case undefined:
      break;
    case "PROCESSING":
      await markProcessing(call, order.id);
      break;
    case "PACKED":
      await markPacked(call, order.id);
      break;
    case "DELIVERED":
      await runTransaction(
        (tx) => deliverShopOrderTx(tx, call.ctx, order.id, call.meta),
        TX_OPTIONS,
      );
      break;
    case "CANCELLED":
      if (order.status !== "CANCELLED") await cancelShopOrder(call, order.id, input.reason);
      break;
    case "RETURNED":
      await runTransaction(
        (tx) =>
          returnUndeliveredTx(
            tx,
            call.ctx,
            order.id,
            input.reason ?? "returned by the shop",
            call.meta,
          ),
        TX_OPTIONS,
      );
      break;
  }
  return shopOrderOf(call.ctx, order.id);
}
