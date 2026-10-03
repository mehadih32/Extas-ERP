import type { Prisma, SalesOrderStatus } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import { recordPartyActivity } from "@/modules/parties/party.service";
import { postCostOfSales, postInvoice, refreshOrderPayments } from "@/modules/sales/posting";
import {
  deliveryChallanSchema,
  issueInvoiceSchema,
  packingListSchema,
  pickItemsSchema,
  voidInvoiceSchema,
} from "@/modules/sales/schemas";
import { deliverStock } from "@/modules/sales/stock-ops";
import { ZERO } from "@/modules/sales/totals";

/*
 * The 3-document flow after checkout:
 *   1. Commercial Invoice  - prices, totals, paid / due; posts the sale to the buyer's ledger
 *   2. Packing List        - pick-list for the warehouse
 *   3. Delivery Challan    - price-free transport document; goods leave stock here
 */

type Tx = Prisma.TransactionClient;

const CLOSED: SalesOrderStatus[] = ["CANCELLED", "RETURNED"];

async function loadOrder(tx: Tx, companyId: string, orderId: string) {
  const order = await tx.salesOrder.findFirst({
    where: { id: orderId, companyId },
    include: {
      items: { include: { variant: { select: { sku: true, avgCost: true } } } },
      invoice: true,
      packingList: true,
      party: { select: { id: true, name: true, paymentTermsDays: true } },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  return order;
}

/** Pieces already delivered per SKU on an order. */
export async function deliveredByVariant(tx: Tx | typeof prisma, orderId: string) {
  const rows = await tx.deliveryChallanItem.groupBy({
    by: ["variantId"],
    where: { challan: { orderId } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.variantId, r._sum.quantity ?? 0]));
}

const partyLabel = (order: { party: { name: string } | null; customerName: string | null }) =>
  order.party?.name ?? order.customerName ?? "Walk-in customer";

// =============================================================================
// 1. Commercial invoice
// =============================================================================

export async function issueInvoiceTx(
  tx: Tx,
  ctx: CompanyContext,
  orderId: string,
  input: ReturnType<typeof issueInvoiceSchema.parse>,
  meta?: RequestMeta,
) {
  await lockRow(tx, "SalesOrder", orderId);
  const order = await loadOrder(tx, ctx.company.id, orderId);
  if (CLOSED.includes(order.status)) {
    throw new AppError("CONFLICT", `This order is ${order.status.toLowerCase()}.`);
  }
  if (order.invoice && order.invoice.status !== "VOID") {
    throw new AppError(
      "CONFLICT",
      `Invoice ${order.invoice.number} already exists for this order.`,
    );
  }
  const issueDate = input.issueDate ?? new Date();
  const terms = order.party?.paymentTermsDays;
  const dueDate =
    input.dueDate !== undefined
      ? input.dueDate
      : terms
        ? new Date(issueDate.getTime() + terms * 86_400_000)
        : null;
  const number = await nextDocumentNumber(tx, ctx.company.id, "COMMERCIAL_INVOICE");
  const data = {
    number,
    partyId: order.partyId,
    issueDate,
    dueDate,
    total: order.total,
    paidAmount: ZERO,
    dueAmount: order.total,
    status: "UNPAID" as const,
    isLocked: true,
  };
  // One invoice row per order: a voided invoice is re-issued under a new number.
  const invoice = order.invoice
    ? await tx.invoice.update({ where: { id: order.invoice.id }, data })
    : await tx.invoice.create({ data: { ...data, companyId: ctx.company.id, orderId: order.id } });

  await postInvoice(tx, {
    companyId: ctx.company.id,
    userId: ctx.user.id,
    invoice,
    order,
    partyName: partyLabel(order),
  });
  await refreshOrderPayments(tx, order.id);
  await auditInCompany(
    ctx,
    meta,
    {
      action: order.invoice ? "INVOICE_EDIT" : "CREATE",
      entityType: "Invoice",
      entityId: invoice.id,
      summary: order.invoice
        ? `Re-issued voided invoice ${order.invoice.number} as ${number} (${order.total.toFixed(2)})`
        : `Issued invoice ${number} for ${order.number} (${order.total.toFixed(2)})`,
    },
    tx,
  );
  return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
}

export async function issueInvoice(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  const input = issueInvoiceSchema.parse(raw);
  return prisma.$transaction((tx) => issueInvoiceTx(tx, ctx, orderId, input, meta), {
    timeout: 30_000,
  });
}

/**
 * Voids an issued invoice: the sale is reversed in the books (payments stay as
 * the buyer's credit) and the order can be corrected and re-invoiced. Audited.
 */
export async function voidInvoice(
  ctx: CompanyContext,
  invoiceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = voidInvoiceSchema.parse(raw);
  const invoice = await ctx.db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.");
  if (invoice.status === "VOID") throw new AppError("CONFLICT", "This invoice is already void.");
  return prisma.$transaction(
    async (tx) => {
      await voidInvoiceTx(tx, ctx, invoice, reason, meta);
      return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    },
    { timeout: 30_000 },
  );
}

export async function voidInvoiceTx(
  tx: Tx,
  ctx: CompanyContext,
  invoice: { id: string; number: string; orderId: string; total: Prisma.Decimal },
  reason: string,
  meta?: RequestMeta,
) {
  await lockRow(tx, "SalesOrder", invoice.orderId);
  const { count } = await tx.invoice.updateMany({
    where: { id: invoice.id, status: { not: "VOID" } },
    data: { status: "VOID", dueAmount: ZERO },
  });
  if (count === 0) throw new AppError("CONFLICT", "This invoice is already void.");
  const entry = await tx.journalEntry.findFirst({
    where: {
      companyId: ctx.company.id,
      sourceType: "SALE",
      sourceId: invoice.id,
      isReversed: false,
      reversalOfId: null,
    },
  });
  if (entry) {
    await reverseJournalEntry(tx, entry.id, {
      description: `Void of invoice ${invoice.number}: ${reason}`,
      postedById: ctx.user.id,
    });
  }
  // Money already received is an advance again until the order is re-invoiced.
  await reclassifyPaymentsAsAdvance(tx, ctx, invoice.orderId);
  await refreshOrderPayments(tx, invoice.orderId);
  await auditInCompany(
    ctx,
    meta,
    {
      action: "INVOICE_EDIT",
      entityType: "Invoice",
      entityId: invoice.id,
      summary: `Voided invoice ${invoice.number} (${invoice.total.toFixed(2)}): ${reason}`,
    },
    tx,
  );
}

/**
 * After a void, payments taken after the invoice (which reduced the receivable)
 * move back to the buyer's advance, so the next invoice applies them again.
 * Payments taken before the invoice are already back in advances via the reversal.
 */
async function reclassifyPaymentsAsAdvance(tx: Tx, ctx: CompanyContext, orderId: string) {
  const order = await tx.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { number: true, partyId: true },
  });
  const agg = await tx.payment.aggregate({
    where: { orderId, isAdvance: false },
    _sum: { amount: true },
  });
  const paidAfterInvoice = agg._sum.amount ?? ZERO;
  if (paidAfterInvoice.gt(0)) {
    const acc = await ensureControlAccounts(ctx.company.id, tx);
    await postJournalEntry(tx, {
      companyId: ctx.company.id,
      description: `Payments on ${order.number} held as advance after invoice void`,
      sourceType: "PAYMENT",
      sourceId: orderId,
      postedById: ctx.user.id,
      lines: [
        { accountId: acc.RECEIVABLE, partyId: order.partyId, debit: paidAfterInvoice },
        { accountId: acc.CUSTOMER_ADVANCE, partyId: order.partyId, credit: paidAfterInvoice },
      ],
    });
    await tx.payment.updateMany({
      where: { orderId, isAdvance: false },
      data: { isAdvance: true },
    });
  }
}

// =============================================================================
// 2. Packing list / pick-list
// =============================================================================

export async function createPackingListTx(
  tx: Tx,
  ctx: CompanyContext,
  orderId: string,
  input: ReturnType<typeof packingListSchema.parse>,
  meta?: RequestMeta,
) {
  await lockRow(tx, "SalesOrder", orderId);
  const order = await loadOrder(tx, ctx.company.id, orderId);
  if (CLOSED.includes(order.status)) {
    throw new AppError("CONFLICT", `This order is ${order.status.toLowerCase()}.`);
  }
  if (order.packingList) {
    throw new AppError("CONFLICT", `Packing list ${order.packingList.number} already exists.`);
  }
  const ordered = new Map(order.items.map((i) => [i.variantId, i.quantity]));
  const items =
    input.items ??
    order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, cartonNo: null }));
  const packed = new Map<string, number>();
  for (const item of items) {
    const total = (packed.get(item.variantId) ?? 0) + item.quantity;
    if (!ordered.has(item.variantId))
      throw new AppError("VALIDATION", "An item is not on this order.");
    if (total > ordered.get(item.variantId)!) {
      throw new AppError("VALIDATION", "Packed quantity is more than ordered.");
    }
    packed.set(item.variantId, total);
  }
  const list = await tx.packingList.create({
    data: {
      companyId: ctx.company.id,
      number: await nextDocumentNumber(tx, ctx.company.id, "PACKING_LIST"),
      orderId: order.id,
      cartons: input.cartons ?? null,
      grossWeightKg: input.grossWeightKg ?? null,
      notes: input.notes ?? null,
      items: {
        create: items.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          cartonNo: i.cartonNo ?? null,
        })),
      },
    },
  });
  if (order.status === "CONFIRMED" || order.status === "PROCESSING") {
    await tx.salesOrder.update({ where: { id: order.id }, data: { status: "PACKED" } });
  }
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "PackingList",
      entityId: list.id,
      summary: `Packing list ${list.number} for ${order.number}`,
    },
    tx,
  );
  return list;
}

export async function createPackingList(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  const input = packingListSchema.parse(raw);
  return prisma.$transaction((tx) => createPackingListTx(tx, ctx, orderId, input, meta), {
    timeout: 30_000,
  });
}

/** Warehouse ticks items off the pick-list. */
export async function setPickedItems(ctx: CompanyContext, packingListId: string, raw: unknown) {
  const input = pickItemsSchema.parse(raw);
  const list = await ctx.db.packingList.findUnique({ where: { id: packingListId } });
  if (!list) throw new AppError("NOT_FOUND", "Packing list not found.");
  const { count } = await prisma.packingListItem.updateMany({
    where: { id: { in: input.itemIds }, packingListId: list.id },
    data: { isPicked: input.isPicked },
  });
  if (count !== new Set(input.itemIds).size) {
    throw new AppError("VALIDATION", "Some items are not on this packing list.");
  }
  return getPackingListDocument(ctx, list.id);
}

// =============================================================================
// 3. Delivery challan (stock leaves the warehouse)
// =============================================================================

export async function createDeliveryChallanTx(
  tx: Tx,
  ctx: CompanyContext,
  orderId: string,
  input: ReturnType<typeof deliveryChallanSchema.parse>,
  meta?: RequestMeta,
) {
  await lockRow(tx, "SalesOrder", orderId);
  const order = await loadOrder(tx, ctx.company.id, orderId);
  if (CLOSED.includes(order.status) || order.status === "DRAFT") {
    throw new AppError("CONFLICT", `This order is ${order.status.toLowerCase()}.`);
  }
  if (!order.warehouseId) throw new AppError("CONFLICT", "The order has no warehouse.");
  const delivered = await deliveredByVariant(tx, order.id);
  const byVariant = new Map(order.items.map((i) => [i.variantId, i]));
  const remaining = (variantId: string) =>
    (byVariant.get(variantId)?.quantity ?? 0) - (delivered.get(variantId) ?? 0);

  const requested =
    input.items ??
    order.items
      .map((i) => ({ variantId: i.variantId, quantity: remaining(i.variantId) }))
      .filter((i) => i.quantity > 0);
  if (requested.length === 0)
    throw new AppError("CONFLICT", "Everything on this order is delivered.");
  const merged = new Map<string, number>();
  for (const r of requested) merged.set(r.variantId, (merged.get(r.variantId) ?? 0) + r.quantity);
  for (const [variantId, quantity] of merged) {
    if (!byVariant.has(variantId))
      throw new AppError("VALIDATION", "An item is not on this order.");
    if (quantity > remaining(variantId)) {
      throw new AppError(
        "VALIDATION",
        `Only ${remaining(variantId)} pcs of ${byVariant.get(variantId)!.variant.sku} are left to deliver.`,
      );
    }
  }

  const deliveryDate = input.deliveryDate ?? new Date();
  const challan = await tx.deliveryChallan.create({
    data: {
      companyId: ctx.company.id,
      number: await nextDocumentNumber(tx, ctx.company.id, "DELIVERY_CHALLAN"),
      orderId: order.id,
      deliveryDate,
      vehicleNo: input.vehicleNo ?? null,
      driverName: input.driverName ?? null,
      driverPhone: input.driverPhone ?? null,
      receivedBy: input.receivedBy ?? null,
      notes: input.notes ?? null,
      items: { create: [...merged].map(([variantId, quantity]) => ({ variantId, quantity })) },
    },
  });

  let cost = ZERO;
  for (const [variantId, quantity] of merged) {
    const item = byVariant.get(variantId)!;
    await deliverStock(
      tx,
      {
        companyId: ctx.company.id,
        warehouseId: order.warehouseId,
        variantId,
        sku: item.variant.sku,
      },
      quantity,
      item.forceOverride,
    );
    const unitCost = item.variant.avgCost;
    cost = cost.plus(unitCost.times(quantity));
    await tx.salesOrderItem.update({ where: { id: item.id }, data: { unitCost } });
    await tx.stockMovement.create({
      data: {
        companyId: ctx.company.id,
        variantId,
        warehouseId: order.warehouseId,
        grade: "A_GRADE",
        type: "SALE_OUT",
        quantity: -quantity,
        unitCost,
        referenceType: "SalesOrder",
        referenceId: order.id,
        note: `${order.number} / ${challan.number}`,
        createdById: ctx.user.id,
      },
    });
  }
  await postCostOfSales(tx, {
    companyId: ctx.company.id,
    userId: ctx.user.id,
    sourceId: challan.id,
    description: `Cost of goods delivered — ${order.number} / ${challan.number}`,
    date: deliveryDate,
    cost,
  });

  const allDelivered = order.items.every(
    (i) => (delivered.get(i.variantId) ?? 0) + (merged.get(i.variantId) ?? 0) >= i.quantity,
  );
  await tx.salesOrder.update({
    where: { id: order.id },
    data: { status: allDelivered ? "DELIVERED" : "PROCESSING" },
  });
  if (order.partyId) await recordPartyActivity(order.partyId, deliveryDate, tx);
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "DeliveryChallan",
      entityId: challan.id,
      summary: `Delivery challan ${challan.number} for ${order.number}: ${[...merged.values()].reduce((a, b) => a + b, 0)} pcs out of stock`,
    },
    tx,
  );
  return challan;
}

export async function createDeliveryChallan(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  const input = deliveryChallanSchema.parse(raw);
  return prisma.$transaction((tx) => createDeliveryChallanTx(tx, ctx, orderId, input, meta), {
    timeout: 30_000,
  });
}

// =============================================================================
// Document data (for the PDF / print layouts)
// =============================================================================

const variantLabel = {
  select: {
    sku: true,
    style: { select: { code: true, name: true } },
    color: { select: { name: true, hexCode: true } },
    size: { select: { name: true } },
  },
} as const;

const partyDetails = {
  select: {
    id: true,
    code: true,
    name: true,
    contactPerson: true,
    phone: true,
    address: true,
    taxId: true,
  },
} as const;

export async function getInvoiceDocument(ctx: CompanyContext, invoiceId: string) {
  const invoice = await ctx.db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      party: partyDetails,
      order: {
        include: {
          items: { include: { variant: variantLabel } },
        },
      },
    },
  });
  if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found.");
  const payments = await ctx.db.payment.findMany({
    where: { orderId: invoice.orderId },
    orderBy: { paymentDate: "asc" },
    select: { number: true, paymentDate: true, amount: true, method: true, reference: true },
  });
  const { order } = invoice;
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    orderNumber: order.number,
    buyer: invoice.party ?? {
      name: order.customerName ?? "Walk-in customer",
      phone: order.customerPhone,
      address: order.shippingAddress,
    },
    items: order.items.map((i) => ({
      sku: i.variant.sku,
      style: i.variant.style.name,
      color: i.variant.color.name,
      size: i.variant.size.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
      lineTotal: i.lineTotal,
    })),
    subtotal: order.subtotal,
    discount: order.discount,
    shippingCharge: order.shippingCharge,
    tax: order.tax,
    total: invoice.total,
    paidAmount: invoice.paidAmount,
    dueAmount: invoice.dueAmount,
    payments,
    letterhead: await letterhead(ctx),
  };
}

/** Pick-list / packing list data; price-free like the challan. */
export async function getPackingListDocument(ctx: CompanyContext, packingListId: string) {
  const list = await ctx.db.packingList.findUnique({
    where: { id: packingListId },
    include: {
      items: { include: { variant: variantLabel }, orderBy: { id: "asc" } },
      order: {
        select: {
          number: true,
          customerName: true,
          customerPhone: true,
          shippingAddress: true,
          party: partyDetails,
        },
      },
    },
  });
  if (!list) throw new AppError("NOT_FOUND", "Packing list not found.");
  return {
    ...list,
    totalPieces: list.items.reduce((s, i) => s + i.quantity, 0),
    pickedPieces: list.items.filter((i) => i.isPicked).reduce((s, i) => s + i.quantity, 0),
    letterhead: await letterhead(ctx),
  };
}

/** Price-free by design (blueprint: official transport document). */
export async function getChallanDocument(ctx: CompanyContext, challanId: string) {
  const challan = await ctx.db.deliveryChallan.findUnique({
    where: { id: challanId },
    include: {
      items: { include: { variant: variantLabel } },
      order: {
        select: {
          number: true,
          customerName: true,
          customerPhone: true,
          shippingAddress: true,
          party: partyDetails,
        },
      },
    },
  });
  if (!challan) throw new AppError("NOT_FOUND", "Delivery challan not found.");
  return {
    ...challan,
    items: challan.items.map((i) => ({
      sku: i.variant.sku,
      style: i.variant.style.name,
      color: i.variant.color.name,
      size: i.variant.size.name,
      quantity: i.quantity,
    })),
    totalPieces: challan.items.reduce((s, i) => s + i.quantity, 0),
    letterhead: await letterhead(ctx),
  };
}

/** Historical challan lookup (by order, buyer or number). */
export async function listChallans(
  ctx: CompanyContext,
  query: { orderId?: string; partyId?: string; search?: string } = {},
) {
  return ctx.db.deliveryChallan.findMany({
    where: {
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.partyId ? { order: { partyId: query.partyId } } : {}),
      ...(query.search ? { number: { contains: query.search, mode: "insensitive" } } : {}),
    },
    include: {
      order: { select: { number: true, party: { select: { name: true } } } },
      _count: { select: { items: true } },
    },
    orderBy: { deliveryDate: "desc" },
    take: 200,
  });
}
