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

import {
  cancelExchangeTx,
  createExchangeTx,
  ExchangeRefusal,
  OPEN_STATES,
  replacedLines,
} from "@/modules/retail/exchanges.service";
import { takeFromReserveTx } from "@/modules/retail/reserve";
import { storePrices } from "@/modules/retail/stores.service";

import { amount, variantActive } from "./catalog.service";
import { EcommerceApiError } from "./errors";
import {
  assertStoreNotOnHold,
  assertStoreOpen,
  goneForStore,
  retailStoreOf,
  type ShopStore,
} from "./retail-mode";
import type { ShopCall } from "./route";
import {
  createOrderSchema,
  externalOrderIdSchema,
  type ShopOrder,
  type ShopPaymentMethod,
  type ShortStock,
  updateOrderSchema,
  lineActionSchema,
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
    include: {
      items: { include: { variant: { select: { sku: true } } }, orderBy: { id: "asc" } },
      retailOrder: {
        include: {
          lines: {
            include: { variant: { select: { sku: true } }, replaces: true },
            orderBy: [{ createdAt: "asc" }, { lineId: "asc" }],
          },
          exchange: true,
        },
      },
    },
  });
  const retail = o.retailOrder;
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
    ...(retail
      ? {
          erpTotal: amount(retail.erpTotal),
          billedAt: retail.billedAt?.toISOString() ?? null,
          lines: retail.lines.map((l) => ({
            lineId: l.lineId,
            sku: l.variant.sku,
            grade: l.grade,
            quantity: l.quantity,
            shopPrice: amount(l.shopPrice),
            customerPrice: amount(l.customerPrice),
            fromReturnStock: l.fromReturnStock > 0,
            cancelled: l.cancelledAt !== null,
            ...(l.replaces
              ? {
                  replacesLineId: l.replaces.lineId,
                  replacedShopPrice: amount(l.replaces.shopPrice),
                }
              : {}),
          })),
          ...(retail.exchange
            ? {
                exchangeId: retail.exchange.number,
                atRisk: amount(
                  retail.lines
                    .filter((l) => l.exchangeState && OPEN_STATES.includes(l.exchangeState))
                    .reduce(
                      (sum, l) => sum.plus(l.shopPrice.times(l.quantity)),
                      new Prisma.Decimal(0),
                    ),
                ),
              }
            : {}),
        }
      : {}),
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
  const store = await retailStoreOf(call);
  if (store) return createStoreOrder(call, input, store, warehouseId);
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

type CreateInput = ReturnType<typeof createOrderSchema.parse>;

const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Main stock first; what a SKU is short of comes from Return stock's unchecked
 * pieces in the same warehouse (plan v6 sec 8.5), checked at packing. Refused
 * (409 INSUFFICIENT_STOCK, counting both) only when both together are short.
 */
async function stockOrReturnStock(ctx: CompanyContext, warehouseId: string, lines: ShopLine[]) {
  const checked = await shortLines(ctx, warehouseId, lines);
  const fromReturn = new Map<string, string[]>();
  const short: ShortStock["shortSkus"] = [];
  for (const line of checked) {
    const missing = line.quantity - line.available;
    if (missing <= 0) continue;
    const pieces = await ctx.db.retailReturnPiece.findMany({
      where: {
        variantId: line.variantId,
        status: "WAITING",
        reservedForLineId: null,
        parcel: { state: "IN_RETURN_STOCK", order: { order: { warehouseId } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: missing,
      select: { id: true },
    });
    if (pieces.length < missing) {
      short.push({
        sku: line.sku,
        requested: line.quantity,
        available: line.available + pieces.length,
      });
    } else {
      fromReturn.set(
        line.variantId,
        pieces.map((p) => p.id),
      );
    }
  }
  if (short.length > 0) throw insufficientStock(short);
  return { checked, fromReturn };
}

/** The order's note for the packers: "Return stock: check before packing". */
const returnStockNote = (
  lines: Array<{ variantId: string; sku: string }>,
  fromReturn: Map<string, string[]>,
) =>
  fromReturn.size === 0
    ? null
    : `Return stock: check before packing: ${lines
        .filter((l) => fromReturn.has(l.variantId))
        .map((l) => `${l.sku} x ${fromReturn.get(l.variantId)!.length}`)
        .join(", ")}`;

/** Ties the Return stock pieces to the order's lines (the first lines of each SKU). */
async function reserveReturnPiecesTx(
  tx: Tx,
  retailOrderId: string,
  fromReturn: Map<string, string[]>,
) {
  if (fromReturn.size === 0) return;
  const lines = await tx.retailOrderLine.findMany({
    where: { retailOrderId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const [variantId, pieceIds] of fromReturn) {
    const left = [...pieceIds];
    for (const line of lines.filter((l) => l.variantId === variantId)) {
      const take = left.splice(0, line.quantity);
      if (take.length === 0) break;
      const claimed = await tx.retailReturnPiece.updateMany({
        where: { id: { in: take }, status: "WAITING", reservedForLineId: null },
        data: { reservedForLineId: line.id },
      });
      if (claimed.count !== take.length) {
        throw new AppError(
          "INSUFFICIENT_STOCK",
          "A Return stock piece was just taken by another order.",
          {
            [`stock.${variantId}`]: ["No longer available"],
          },
        );
      }
      await tx.retailOrderLine.update({
        where: { id: line.id },
        data: { fromReturnStock: take.length },
      });
    }
  }
}

/** The ERP's own line on an exchange order, e.g. "Exchange of WEB-1043, line WEB-1043-2". */
const exchangeNote = (of: string, lines: Array<{ replacesLineId?: string }>) =>
  `Exchange of ${of}, line ${[...new Set(lines.map((l) => l.replacesLineId))].join(", ")}`;

/** The order an exchange names and the lines it replaces, checked (site-changes 2.10.2). */
async function exchangeOf(
  call: Call,
  exchange: NonNullable<CreateInput["exchange"]>,
  lines: Array<{ lineId: string; replacesLineId?: string; quantity: number }>,
) {
  const of = await findShopOrder(call, exchange.ofExternalOrderId);
  if (!of) {
    throw new EcommerceApiError(
      404,
      "NOT_FOUND",
      `Order ${exchange.ofExternalOrderId} is not this shop's.`,
    );
  }
  try {
    return await replacedLines(call.ctx, of.id, lines);
  } catch (error) {
    if (error instanceof ExchangeRefusal) {
      throw new EcommerceApiError(error.status, error.code, error.message, error.details);
    }
    throw error;
  }
}

/**
 * POST /orders from a retail store's shop (plan v6 sec 9): a sale to the store
 * (its buyer) at the store's own prices, fixed now and billed when the parcel
 * leaves. The customer's prices are kept beside it for the store's reports
 * only. Refused while the store is closed or on hold, and for a SKU with no
 * shop price (never sold at 0).
 */
async function createStoreOrder(
  call: Call,
  input: CreateInput,
  store: ShopStore,
  warehouseId: string,
): Promise<ShopOrder> {
  const { ctx, integration, meta } = call;
  assertStoreOpen(store);
  // An exchange is not a new sale: it goes through while the store is on hold.
  if (!input.exchange) await assertStoreNotOnHold(ctx, store);
  const bGrade = input.items.filter((i) => i.grade === "B").map((i) => i.sku);
  if (bGrade.length > 0) {
    throw new EcommerceApiError(
      422,
      "VALIDATION",
      `B-grade lines are not open in the ERP yet: ${[...new Set(bGrade)].join(", ")}.`,
      { bGradeSkus: [...new Set(bGrade)] },
    );
  }
  const siteLines = input.items.map((item, index) => ({
    ...item,
    lineId: item.lineId ?? `${input.externalOrderId}-${index + 1}`,
  }));
  const ids = siteLines.map((l) => l.lineId);
  const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (twice.length > 0) {
    throw new EcommerceApiError(422, "VALIDATION", `Each lineId once: ${twice.join(", ")}.`, {
      lineId: [...new Set(twice)],
    });
  }
  const exchange = input.exchange ? await exchangeOf(call, input.exchange, siteLines) : null;
  if (!exchange && siteLines.some((l) => l.replacesLineId)) {
    throw new EcommerceApiError(422, "VALIDATION", "replacesLineId is only for an exchange order.");
  }
  const lines = await resolveItems(
    ctx,
    siteLines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPrice: 0, discount: 0 })),
  );
  const prices = await storePrices(
    ctx,
    store.id,
    lines.map((l) => l.variantId),
    "A",
  );
  const noPrice = lines.filter((l) => !prices.get(l.variantId)).map((l) => l.sku);
  if (noPrice.length > 0) {
    throw new EcommerceApiError(
      409,
      "NO_SHOP_PRICE",
      `These SKUs have no shop price yet, so they are not for sale to this store: ${noPrice.join(", ")}.`,
      { skus: noPrice },
    );
  }
  // An exchange's new pieces go out at 0: their money settles when the old pieces are checked.
  const priced = lines.map((l) => ({
    ...l,
    unitPrice: exchange ? 0 : Number(prices.get(l.variantId)),
  }));
  const { checked, fromReturn } = await stockOrReturnStock(ctx, warehouseId, priced);
  const variantOf = new Map(lines.map((l) => [l.sku, l.variantId]));
  const customerPriceOf = (l: (typeof siteLines)[number]) =>
    l.customerPrice !== undefined
      ? new Prisma.Decimal(l.customerPrice)
      : round2(
          new Prisma.Decimal(l.unitPrice).minus(new Prisma.Decimal(l.discount).div(l.quantity)),
        );
  const customerTotal = siteLines.reduce(
    (sum, l) => sum.plus(customerPriceOf(l).times(l.quantity)),
    new Prisma.Decimal(0),
  );
  try {
    const orderId = await runTransaction(async (tx) => {
      const order = await createOrderTx(
        tx,
        ctx,
        {
          channel: "WEBSITE",
          partyId: store.partyId,
          warehouseId,
          orderDate: input.orderDate ? new Date(input.orderDate) : undefined,
          lines: checked.map((l) => ({
            variantId: l.variantId,
            sku: l.sku,
            styleId: l.styleId,
            quantity: l.quantity,
            unitPrice: new Prisma.Decimal(l.unitPrice),
            discount: new Prisma.Decimal(0),
            available: l.available,
            // Pieces from Return stock are not in stock until the packing check passes them.
            short: fromReturn.has(l.variantId),
          })),
          charges: {},
          overrideReason:
            fromReturn.size > 0 ? "Filled from Return stock: check before packing" : undefined,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          shippingAddress: input.shippingAddress,
          notes:
            [
              exchange ? exchangeNote(input.exchange!.ofExternalOrderId, siteLines) : null,
              returnStockNote(checked, fromReturn),
              input.note,
            ]
              .filter(Boolean)
              .join("\n") || null,
          integrationId: integration.id,
          externalOrderId: input.externalOrderId,
        },
        meta,
      );
      const retail = await tx.retailOrder.create({
        data: {
          companyId: ctx.company.id,
          storeId: store.id,
          orderId: order.id,
          erpTotal: order.total,
          customerTotal,
          deliveryCharge: input.deliveryCharge,
          advancePaid: input.advancePaid,
          lines: {
            create: siteLines.map((l) => ({
              companyId: ctx.company.id,
              lineId: l.lineId,
              variantId: variantOf.get(l.sku)!,
              grade: l.grade,
              quantity: l.quantity,
              shopPrice: prices.get(variantOf.get(l.sku)!)!,
              customerPrice: customerPriceOf(l),
              comboId: l.comboId ?? null,
              ...(exchange
                ? {
                    replacesLineId: exchange.replaced.get(l.lineId)!.id,
                    exchangeState: "WAITING_DELIVERY" as const,
                  }
                : {}),
            })),
          },
        },
      });
      await reserveReturnPiecesTx(tx, retail.id, fromReturn);
      if (exchange) {
        await createExchangeTx(tx, ctx, {
          storeId: store.id,
          retailOrderId: retail.id,
          ofRetailOrderId: exchange.of.id,
          note: input.exchange?.note ?? null,
        });
      }
      return order.id;
    }, TX_OPTIONS);
    return await shopOrderOf(ctx, orderId);
  } catch (error) {
    if (isAppError(error, "INSUFFICIENT_STOCK")) {
      throw await lostRace(ctx, warehouseId, priced, error);
    }
    if (isUniqueClash(error)) {
      const saved = await findShopOrder(call, input.externalOrderId);
      if (saved) throw orderExists(saved);
    }
    throw error;
  }
}

/**
 * A store's order leaves only when every Return stock piece on it passed the
 * packing check, and a line whose piece failed has stock again (or was
 * replaced or cancelled by the site).
 */
async function assertLinesReadyTx(tx: Tx, ctx: CompanyContext, retailOrderId: string) {
  const lines = await tx.retailOrderLine.findMany({
    where: { retailOrderId, cancelledAt: null },
    include: {
      reservedPieces: { select: { status: true } },
      variant: { select: { sku: true } },
      order: { include: { order: { select: { warehouseId: true } } } },
    },
  });
  const unchecked = lines.filter((l) => l.reservedPieces.some((p) => p.status === "WAITING"));
  if (unchecked.length > 0) {
    throw new EcommerceApiError(
      409,
      "RETURN_PIECE_NOT_CHECKED",
      `Pieces from Return stock wait for the packing check: ${unchecked.map((l) => l.variant.sku).join(", ")}.`,
      { lineIds: unchecked.map((l) => l.lineId) },
    );
  }
  for (const line of lines.filter((l) => l.waitingStock)) {
    const available = await availableByVariant(
      ctx,
      [line.variantId],
      line.order.order.warehouseId ?? undefined,
    );
    if ((available.get(line.variantId) ?? 0) < 0) {
      throw new EcommerceApiError(
        409,
        "LINE_SHORT",
        `Line ${line.lineId} (${line.variant.sku}) waits for stock: wait, replace it or cancel it.`,
        { lineId: line.lineId },
      );
    }
    // Stock came: the line is filled.
    await tx.retailOrderLine.update({ where: { id: line.id }, data: { waitingStock: false } });
  }
}

/**
 * Bills a retail store's order (plan v6 sec 1): the invoice to the store at the
 * prices fixed on the order and the delivery challan (stock out, cost of goods),
 * once, when the parcel leaves. False when it is not a store's order or was
 * billed already.
 */
export async function billStoreOrderTx(
  tx: Tx,
  ctx: CompanyContext,
  orderId: string,
  meta?: RequestMeta,
) {
  const retail = await tx.retailOrder.findUnique({ where: { orderId } });
  if (!retail || retail.billedAt) return false;
  await assertLinesReadyTx(tx, ctx, retail.id);
  await deliverShopOrderTx(tx, ctx, orderId, meta);
  await takeFromReserveTx(tx, ctx.company.id, retail.id);
  await tx.retailOrder.update({ where: { id: retail.id }, data: { billedAt: new Date() } });
  return true;
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
async function deliverShopOrderTx(
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

/**
 * The DELIVERED step in its own transaction. Pieces the warehouse no longer
 * holds (stock taken down since the order) answer the same 409 as POST /orders.
 */
export async function deliverShopOrder(ctx: CompanyContext, orderId: string, meta?: RequestMeta) {
  try {
    return await runTransaction((tx) => deliverShopOrderTx(tx, ctx, orderId, meta), TX_OPTIONS);
  } catch (error) {
    if (!isAppError(error, "INSUFFICIENT_STOCK")) throw error;
    const order = await ctx.db.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { include: { variant: { select: { sku: true } } } } },
    });
    const delivered = await deliveredByVariant(prisma, order.id);
    const onHand = await ctx.db.stockBalance.findMany({
      where: {
        warehouseId: order.warehouseId ?? "",
        grade: "A_GRADE",
        variantId: { in: order.items.map((i) => i.variantId) },
      },
      select: { variantId: true, quantity: true },
    });
    const inHand = new Map(onHand.map((b) => [b.variantId, b.quantity]));
    const short = order.items
      .map((i) => ({
        sku: i.variant.sku,
        requested: i.quantity - (delivered.get(i.variantId) ?? 0),
        available: Math.max(inHand.get(i.variantId) ?? 0, 0),
      }))
      .filter((l) => l.requested > l.available);
    throw short.length > 0 ? insufficientStock(short) : error;
  }
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

/** The longest reason the ERP's cancel takes (cancelOrderSchema). */
const CANCEL_REASON_MAX = 500;

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
      `Invoice ${invoice.number} is issued for this order: cancel it in the ERP.`,
    );
  }
  // Kept within the cancel's own reason limit (cancelOrderSchema: 500), without cutting a
  // character in half.
  const why = `Cancelled by the shop: ${reason ?? "no reason given"}`
    .slice(0, CANCEL_REASON_MAX)
    .replace(/[\uD800-\uDBFF]$/, "");
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
      `Invoice ${invoice.number} is issued for this order: void it in the ERP first.`,
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
  const retail = await call.ctx.db.retailOrder.findUnique({ where: { orderId: order.id } });
  if (retail) return updateStoreOrder(call, order.id, retail, input, editing);
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
      await deliverShopOrder(call.ctx, order.id, call.meta);
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

/**
 * PATCH on a retail store's order: the status steps only (its lines and prices
 * were fixed when it came). DELIVERED bills it when no shipment did; an order
 * that never left can be cancelled or come back, and is then never billed;
 * goods that left come back through POST /return-lists.
 */
async function updateStoreOrder(
  call: Call,
  orderId: string,
  retail: { id: string; billedAt: Date | null },
  input: UpdateInput,
  editing: boolean,
): Promise<ShopOrder> {
  if (editing) {
    throw new EcommerceApiError(
      409,
      "CONFLICT",
      "A retail store's order keeps the lines and prices it came with: cancel it and send it again.",
    );
  }
  switch (input.status) {
    case undefined:
      break;
    case "PROCESSING":
      await markProcessing(call, orderId);
      break;
    case "PACKED":
      await markPacked(call, orderId);
      break;
    case "DELIVERED":
      await runTransaction((tx) => billStoreOrderTx(tx, call.ctx, orderId, call.meta), TX_OPTIONS);
      break;
    case "CANCELLED":
    case "RETURNED": {
      if (retail.billedAt) {
        throw goneForStore(
          "Cancelling or returning an order that left",
          "report the courier's result with PUT /orders/{externalOrderId}/delivery and the return with POST /return-lists.",
        );
      }
      const current = await call.ctx.db.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
      if (current.status !== "CANCELLED") await cancelShopOrder(call, orderId, input.reason);
      await runTransaction((tx) => cancelExchangeTx(tx, call.ctx, retail.id), TX_OPTIONS);
      break;
    }
  }
  return shopOrderOf(call.ctx, orderId);
}

// ---------------------------------------------------------------------------
// PATCH /orders/{externalOrderId}/lines/{lineId} (plan v6 sec 8.5, site-changes 2.3)
// ---------------------------------------------------------------------------

/**
 * A retail store's line whose Return stock piece failed the packing check:
 * WAIT (it fills when the SKU is in stock again), REPLACE (another SKU at its
 * shop price today, checked for stock) or CANCEL (never billed; the line stays
 * in the order's history as cancelled). Only before the order leaves.
 */
export async function updateStoreLine(
  call: Call,
  externalOrderId: string,
  lineId: string,
  raw: unknown,
): Promise<ShopOrder> {
  const input = lineActionSchema.parse(raw);
  const { ctx, meta } = call;
  const order = await shopOrderOrNotFound(call, externalOrderId);
  const retail = await ctx.db.retailOrder.findUnique({
    where: { orderId: order.id },
    include: {
      lines: { include: { variant: { select: { sku: true } } } },
      exchange: true,
    },
  });
  const line = retail?.lines.find((l) => l.lineId === lineId && !l.cancelledAt);
  if (!retail || !line) {
    throw new EcommerceApiError(404, "NOT_FOUND", `Line ${lineId} is not on this order.`);
  }
  if (retail.billedAt) {
    throw goneForStore(
      "Changing a line of an order that left",
      "report the courier's result instead.",
    );
  }
  if (!line.waitingStock) {
    throw new EcommerceApiError(
      409,
      "CONFLICT",
      `Line ${lineId} is not waiting: only a line whose Return stock piece failed the packing check changes.`,
    );
  }
  if (input.action === "WAIT") return shopOrderOf(ctx, order.id);

  const warehouseId = order.warehouseId!;
  let replacement: { variantId: string; sku: string; price: Prisma.Decimal } | null = null;
  if (input.action === "REPLACE") {
    if (input.grade === "B") {
      throw new EcommerceApiError(422, "VALIDATION", "B-grade lines are not open in the ERP yet.");
    }
    const [resolved] = await resolveItems(ctx, [
      { sku: input.sku, quantity: line.quantity, unitPrice: 0, discount: 0 },
    ]);
    const price = (await storePrices(ctx, retail.storeId, [resolved!.variantId], "A")).get(
      resolved!.variantId,
    );
    if (!price) {
      throw new EcommerceApiError(409, "NO_SHOP_PRICE", `${input.sku} has no shop price yet.`, {
        skus: [input.sku],
      });
    }
    await assertInStock(ctx, warehouseId, [resolved!]);
    replacement = { variantId: resolved!.variantId, sku: resolved!.sku, price };
  }
  const active = retail.lines
    .filter((l) => !l.cancelledAt && !(input.action === "CANCEL" && l.id === line.id))
    .map((l) =>
      l.id === line.id && replacement
        ? { ...l, variantId: replacement.variantId, shopPrice: replacement.price }
        : l,
    );
  if (active.length === 0) {
    await cancelShopOrder(call, order.id, input.action === "CANCEL" ? input.reason : undefined);
  } else {
    const byVariant = new Map<string, { quantity: number; unitPrice: number }>();
    for (const l of active) {
      const unitPrice = retail.exchange ? 0 : Number(l.shopPrice);
      const now = byVariant.get(l.variantId);
      byVariant.set(l.variantId, { quantity: (now?.quantity ?? 0) + l.quantity, unitPrice });
    }
    // Other lines may still hold the ERP's own Return stock reservation (beyond
    // stock until their piece is checked): the ERP keeps that override, not the shop.
    const system = {
      ...ctx,
      can: (key: Parameters<typeof ctx.can>[0]) => key === "sales.force_override" || ctx.can(key),
    };
    await updateOrder(
      system,
      order.id,
      {
        lines: [...byVariant].map(([variantId, l]) => ({
          variantId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: 0,
        })),
        forceOverride: { reason: "Filled from Return stock: check before packing" },
      },
      meta,
      { beforePacking: true },
    );
  }
  await runTransaction(async (tx) => {
    await tx.retailOrderLine.update({
      where: { id: line.id },
      data:
        input.action === "CANCEL"
          ? { cancelledAt: new Date(), cancelReason: input.reason, waitingStock: false }
          : {
              variantId: replacement!.variantId,
              shopPrice: replacement!.price,
              waitingStock: false,
              fromReturnStock: 0,
            },
    });
    const lines = await tx.retailOrderLine.findMany({
      where: { retailOrderId: retail.id, cancelledAt: null },
    });
    if (!retail.exchange) {
      await tx.retailOrder.update({
        where: { id: retail.id },
        data: {
          erpTotal: lines.reduce(
            (sum, l) => sum.plus(l.shopPrice.times(l.quantity)),
            new Prisma.Decimal(0),
          ),
        },
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "RetailOrderLine",
        entityId: line.id,
        summary:
          input.action === "CANCEL"
            ? `${order.number}: line ${lineId} (${line.variant.sku}) cancelled by the site: ${input.reason}`
            : `${order.number}: line ${lineId} replaced: was ${line.variant.sku} at ${line.shopPrice.toFixed(2)}, now ${replacement!.sku} at ${replacement!.price.toFixed(2)}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return shopOrderOf(ctx, order.id);
}
