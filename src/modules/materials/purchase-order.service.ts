import type { Prisma, PurchaseOrderStatus } from "@prisma/client";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanBuyMaterials, costMask } from "@/modules/materials/access";
import { OPEN_ORDER } from "@/modules/materials/material.service";
import {
  closeOrderSchema,
  createPurchaseOrderSchema,
  listPurchaseOrdersSchema,
  updatePurchaseOrderSchema,
} from "@/modules/materials/schemas";
import { assertUnitFits, loadActiveMaterials } from "@/modules/materials/stock";
import {
  money,
  orderStatus,
  pendingQuantity,
  qty,
  unitCost,
  ZERO,
} from "@/modules/materials/valuation";
import { assertPartyCanTransact } from "@/modules/parties/party.service";
import { isProjectClosed } from "@/modules/production/project-costs";

/*
 * Purchase orders: what was ordered from a supplier (a fabric booking, a trims
 * order) and how much of it has arrived. No money moves on an order; the books
 * change when the goods arrive with the supplier's bill (purchase.service.ts),
 * which counts against the order's lines.
 */

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 30_000 };

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  OPEN: "open",
  PARTIALLY_RECEIVED: "partly received",
  RECEIVED: "received in full",
  CLOSED: "closed",
  CANCELLED: "cancelled",
};

const orderInclude = {
  supplier: { select: { id: true, code: true, name: true, phone: true } },
  project: { select: { id: true, code: true, name: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    orderBy: { id: "asc" },
    include: {
      rawMaterial: { select: { id: true, code: true, name: true, kind: true, unit: true } },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

function presentOrder(ctx: CompanyContext, order: OrderRow) {
  const cost = costMask(ctx);
  const day = localDay(new Date(), ctx.company.timezone);
  const expected = dateOnly(order.expectedDate);
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    supplier: order.supplier,
    project: order.project,
    orderDate: dateOnly(order.orderDate),
    expectedDate: expected,
    /** Still open past the expected date. */
    isOverdue: OPEN_ORDER.includes(order.status) && expected !== null && expected < day,
    supplierRef: order.supplierRef,
    totalAmount: cost(order.totalAmount),
    notes: order.notes,
    closedReason: order.closedReason,
    closedAt: order.closedAt,
    createdBy: order.createdBy,
    createdAt: order.createdAt,
    lines: order.lines.map((l) => ({
      id: l.id,
      material: l.rawMaterial,
      quantity: l.quantity,
      receivedQty: l.receivedQty,
      /** Still to arrive. */
      pending: pendingQuantity(l),
      unitPrice: cost(l.unitPrice),
      amount: cost(l.amount),
      description: l.description,
    })),
  };
}

/** Lines from the API: materials checked, quantities fitted to their units, amounts worked out. */
async function prepareLines(
  ctx: CompanyContext,
  lines: Array<{
    materialId: string;
    quantity: number;
    unitPrice: number;
    description?: string | null;
  }>,
) {
  const materials = await loadActiveMaterials(
    ctx,
    lines.map((l) => l.materialId),
  );
  const prepared = lines.map((l, i) => {
    const m = materials.get(l.materialId)!;
    const quantity = qty(l.quantity);
    assertUnitFits(m, quantity, `lines.${i}.quantity`);
    const unitPrice = unitCost(l.unitPrice);
    return {
      rawMaterialId: m.id,
      quantity,
      unitPrice,
      amount: money(quantity.times(unitPrice)),
      description: l.description ?? null,
    };
  });
  return { lines: prepared, total: prepared.reduce((t, l) => t.plus(l.amount), ZERO) };
}

async function assertOpenProject(ctx: CompanyContext, projectId: string) {
  const project = await ctx.db.productionProject.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, status: true },
  });
  if (!project) throw new AppError("NOT_FOUND", "Production project not found.");
  if (isProjectClosed(project)) {
    throw new AppError(
      "CONFLICT",
      `${project.code} is ${project.status.toLowerCase()}; materials can no longer be ordered for it.`,
    );
  }
  return project;
}

export async function createPurchaseOrder(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createPurchaseOrderSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  const companyId = ctx.company.id;
  const supplier = await assertPartyCanTransact(ctx, input.supplierId, "PURCHASE");
  const project = input.projectId ? await assertOpenProject(ctx, input.projectId) : null;
  const orderDay = input.orderDate ?? localDay(new Date(), ctx.company.timezone);
  if (input.expectedDate && input.expectedDate < orderDay) {
    throw new AppError("VALIDATION", "The goods cannot be expected before the order date.", {
      expectedDate: ["Choose a day on or after the order date"],
    });
  }
  const { lines, total } = await prepareLines(ctx, input.lines);
  const orderId = await runTransaction(async (tx) => {
    const order = await tx.purchaseOrder.create({
      data: {
        companyId,
        number: await nextDocumentNumber(tx, companyId, "PURCHASE_ORDER"),
        supplierId: supplier.id,
        projectId: project?.id ?? null,
        orderDate: dateColumn(orderDay),
        expectedDate: input.expectedDate ? dateColumn(input.expectedDate) : null,
        supplierRef: input.supplierRef ?? null,
        totalAmount: total,
        notes: input.notes ?? null,
        createdById: ctx.user.id,
        lines: { create: lines },
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "PurchaseOrder",
        entityId: order.id,
        summary: `Purchase order ${order.number} to ${supplier.name}: ${lines.length} line(s), ${total.toFixed(2)}${
          project ? ` for ${project.code}` : ""
        }`,
      },
      tx,
    );
    return order.id;
  }, TX_OPTIONS);
  return getPurchaseOrder(ctx, orderId);
}

/** Locks an order for the rest of the transaction and reads it. */
async function lockOrder(tx: Tx, companyId: string, orderId: string) {
  await lockRow(tx, "PurchaseOrder", orderId);
  const order = await tx.purchaseOrder.findFirst({
    where: { id: orderId, companyId },
    include: { lines: true, supplier: { select: { name: true } } },
  });
  if (!order) throw new AppError("NOT_FOUND", "Purchase order not found.");
  return order;
}

/**
 * Changes an open order: dates, references, the project, and (while nothing
 * has arrived) its lines.
 */
export async function updatePurchaseOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updatePurchaseOrderSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  const companyId = ctx.company.id;
  if (input.projectId) await assertOpenProject(ctx, input.projectId);
  const prepared = input.lines ? await prepareLines(ctx, input.lines) : null;
  await runTransaction(async (tx) => {
    const order = await lockOrder(tx, companyId, orderId);
    if (!OPEN_ORDER.includes(order.status)) {
      throw new AppError(
        "CONFLICT",
        `${order.number} is ${STATUS_LABEL[order.status]}; it can no longer change.`,
      );
    }
    if (prepared) {
      if (order.status !== "OPEN" || order.lines.some((l) => l.receivedQty.gt(0))) {
        throw new AppError(
          "CONFLICT",
          `Goods have already arrived on ${order.number}, so its lines can no longer change. Close it and order the rest again.`,
        );
      }
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: order.id } });
      await tx.purchaseOrderLine.createMany({
        data: prepared.lines.map((l) => ({ ...l, orderId: order.id })),
      });
    }
    const expectedDate =
      input.expectedDate === undefined
        ? undefined
        : input.expectedDate === null
          ? null
          : dateColumn(input.expectedDate);
    if (expectedDate && expectedDate < order.orderDate) {
      throw new AppError("VALIDATION", "The goods cannot be expected before the order date.", {
        expectedDate: ["Choose a day on or after the order date"],
      });
    }
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: {
        projectId: input.projectId,
        expectedDate,
        supplierRef: input.supplierRef,
        notes: input.notes,
        ...(prepared ? { totalAmount: prepared.total } : {}),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "PurchaseOrder",
        entityId: order.id,
        summary: `Updated purchase order ${order.number}${
          prepared ? `: ${prepared.lines.length} line(s), ${prepared.total.toFixed(2)}` : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPurchaseOrder(ctx, orderId);
}

/** Cancels an order nothing has arrived on (the supplier will not deliver). */
export async function cancelPurchaseOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = closeOrderSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  await runTransaction(async (tx) => {
    const order = await lockOrder(tx, ctx.company.id, orderId);
    if (order.status !== "OPEN" || order.lines.some((l) => l.receivedQty.gt(0))) {
      throw new AppError(
        "CONFLICT",
        OPEN_ORDER.includes(order.status) || order.status === "RECEIVED"
          ? `Goods have already arrived on ${order.number}; close it instead of cancelling it.`
          : `${order.number} is already ${STATUS_LABEL[order.status]}.`,
      );
    }
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "CANCELLED", closedReason: reason, closedAt: new Date() },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "PurchaseOrder",
        entityId: order.id,
        summary: `Cancelled purchase order ${order.number} to ${order.supplier.name}: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPurchaseOrder(ctx, orderId);
}

/** Closes a partly received order: the rest will not come. */
export async function closePurchaseOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { reason } = closeOrderSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  await runTransaction(async (tx) => {
    const order = await lockOrder(tx, ctx.company.id, orderId);
    if (order.status !== "PARTIALLY_RECEIVED") {
      throw new AppError(
        "CONFLICT",
        order.status === "OPEN"
          ? `Nothing has arrived on ${order.number} yet; cancel it instead.`
          : `${order.number} is already ${STATUS_LABEL[order.status]}.`,
      );
    }
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "CLOSED", closedReason: reason, closedAt: new Date() },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "PurchaseOrder",
        entityId: order.id,
        summary: `Closed purchase order ${order.number} before everything arrived: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPurchaseOrder(ctx, orderId);
}

/**
 * Re-counts what has arrived on each order line from the bills that are not
 * void, and moves the order between open, partly received and received.
 */
export async function refreshPurchaseOrders(tx: Tx, orderIds: string[]) {
  for (const orderId of new Set(orderIds)) {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { lines: true },
    });
    if (!order) continue;
    const arrived = await tx.supplierBillItem.groupBy({
      by: ["purchaseOrderLineId"],
      where: {
        purchaseOrderLineId: { in: order.lines.map((l) => l.id) },
        bill: { status: { not: "VOID" } },
      },
      _sum: { quantity: true },
    });
    const byLine = new Map(arrived.map((a) => [a.purchaseOrderLineId, a._sum.quantity ?? ZERO]));
    const lines = order.lines.map((l) => ({ ...l, received: byLine.get(l.id) ?? ZERO }));
    for (const l of lines) {
      if (!l.received.equals(l.receivedQty)) {
        await tx.purchaseOrderLine.update({
          where: { id: l.id },
          data: { receivedQty: l.received },
        });
      }
    }
    const status = orderStatus(
      order.status,
      lines.map((l) => ({ quantity: l.quantity, receivedQty: l.received })),
    );
    if (status !== order.status) {
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status } });
    }
  }
}

export async function getPurchaseOrder(ctx: CompanyContext, orderId: string) {
  const cost = costMask(ctx);
  const order = await ctx.db.purchaseOrder.findUnique({
    where: { id: orderId },
    include: {
      ...orderInclude,
      bills: {
        orderBy: [{ billDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          number: true,
          billDate: true,
          status: true,
          supplierRef: true,
          totalAmount: true,
        },
      },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Purchase order not found.");
  return {
    ...presentOrder(ctx, order),
    /** Bills the goods arrived on (void ones included, marked VOID). */
    bills: order.bills.map((b) => ({ ...b, totalAmount: cost(b.totalAmount) })),
  };
}

export async function listPurchaseOrders(ctx: CompanyContext, raw: unknown = {}) {
  const q = listPurchaseOrdersSchema.parse(raw);
  const take = q.take ?? 50;
  const day = localDay(new Date(), ctx.company.timezone);
  const and: Prisma.PurchaseOrderWhereInput[] = [];
  if (q.supplierId) and.push({ supplierId: q.supplierId });
  if (q.projectId) and.push({ projectId: q.projectId });
  if (q.status) and.push({ status: q.status });
  if (q.materialId) and.push({ lines: { some: { rawMaterialId: q.materialId } } });
  if (q.overdue) {
    and.push({ status: { in: OPEN_ORDER }, expectedDate: { lt: dateColumn(day) } });
  }
  if (q.from) and.push({ orderDate: { gte: dateColumn(q.from) } });
  if (q.to) and.push({ orderDate: { lte: dateColumn(q.to) } });
  if (q.search) {
    const contains = { contains: q.search, mode: "insensitive" } as const;
    and.push({ OR: [{ number: contains }, { supplierRef: contains }] });
  }
  const rows = await ctx.db.purchaseOrder.findMany({
    where: { AND: and },
    include: orderInclude,
    orderBy: [{ orderDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    items: page.map((o) => presentOrder(ctx, o)),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
}
