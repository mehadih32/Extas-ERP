import type { MeasurementUnit, Party, Prisma, PurchaseOrderStatus } from "@prisma/client";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanBuyMaterials, costMask } from "@/modules/materials/access";
import { OPEN_ORDER } from "@/modules/materials/material.service";
import {
  canCancelOrder,
  canChangeOrder,
  canChangeOrderLines,
  canCloseOrder,
} from "@/modules/materials/rules";
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
import { shareOut } from "@/modules/production/material-plan";
import { isProjectClosed } from "@/modules/production/project-costs";

/*
 * Purchase orders: what was ordered from a supplier (a fabric booking, a trims
 * order) and how much of it has arrived. No money moves on an order; the books
 * change when the goods arrive with the supplier's bill (purchase.service.ts),
 * which counts against the order's lines.
 */

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { timeout: 30_000 };

const orderInclude = {
  supplier: { select: { id: true, code: true, name: true, phone: true } },
  project: { select: { id: true, code: true, name: true, status: true } },
  batch: { select: { id: true, code: true, name: true } },
  booking: { select: { id: true, stage: true, source: true } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    orderBy: { id: "asc" },
    include: {
      rawMaterial: { select: { id: true, code: true, name: true, kind: true, unit: true } },
      shares: {
        orderBy: { id: "asc" },
        include: { project: { select: { id: true, code: true, name: true } } },
      },
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
    /** The master batch it was ordered for (its lines are shared out over the styles). */
    batch: order.batch,
    /** Written as a booking: its lines and specification change on the booking. */
    bookingId: order.booking?.id ?? null,
    /** Which kind of booking (its own permission changes it), or null. */
    bookingSource: order.booking?.source ?? null,
    /** A booking still waiting for approval: nothing arrives on it until it is approved. */
    awaitingApproval: order.booking?.stage === "DRAFT",
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
      /** The price is agreed when the goods arrive (unitPrice and amount are 0 until then). */
      priceLater: l.priceLater,
      /** A picture for the supplier (a material picture). */
      imageId: l.imageId,
      description: l.description,
      /** What part is for which style, garment colour and size. */
      shares: l.shares.map((sh) => ({
        project: sh.project,
        colorName: sh.colorName,
        sizeName: sh.sizeName,
        quantity: sh.quantity,
      })),
    })),
  };
}

/** Lines from the API: materials checked, quantities fitted to their units, amounts worked out. */
async function prepareLines(
  ctx: CompanyContext,
  lines: Array<{
    materialId: string;
    quantity: number;
    /** null: the price is agreed when the goods arrive. */
    unitPrice: number | null;
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
    const unitPrice = unitCost(l.unitPrice ?? 0);
    return {
      rawMaterialId: m.id,
      quantity,
      unitPrice,
      amount: money(quantity.times(unitPrice)),
      priceLater: l.unitPrice === null,
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
  const supplier = await assertPartyCanTransact(ctx, input.supplierId, "PURCHASE");
  const project = input.projectId ? await assertOpenProject(ctx, input.projectId) : null;
  const orderDay = input.orderDate ?? localDay(new Date(), ctx.company.timezone);
  if (input.expectedDate && input.expectedDate < orderDay) {
    throw new AppError("VALIDATION", "The goods cannot be expected before the order date.", {
      expectedDate: ["Choose a day on or after the order date"],
    });
  }
  const { lines, total } = await prepareLines(ctx, input.lines);
  const orderId = await runTransaction(
    async (tx) =>
      insertPurchaseOrder(tx, ctx, meta, {
        supplier,
        project,
        batch: null,
        orderDay,
        expectedDate: input.expectedDate ?? null,
        supplierRef: input.supplierRef ?? null,
        notes: input.notes ?? null,
        lines,
        total,
      }),
    TX_OPTIONS,
  );
  return getPurchaseOrder(ctx, orderId);
}

/** A line as it is written: worked out by prepareLines or for a batch, with its shares. */
export type NewOrderLine = {
  rawMaterialId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  priceLater: boolean;
  imageId?: string | null;
  description: string | null;
  /** A booking line's specification (production/booking-schemas.ts). */
  specs?: Prisma.InputJsonValue;
  shares?: Array<{
    projectId: string;
    colorName: string | null;
    sizeName: string | null;
    quantity: Prisma.Decimal;
  }>;
};

/** Writes a checked purchase order with its next number, and logs it. */
export async function insertPurchaseOrder(
  tx: Tx,
  ctx: CompanyContext,
  meta: RequestMeta | undefined,
  order: {
    supplier: Pick<Party, "id" | "name">;
    project: { id: string; code: string } | null;
    batch: { id: string; code: string } | null;
    orderDay: string;
    expectedDate: string | null;
    supplierRef: string | null;
    notes: string | null;
    lines: NewOrderLine[];
    total: Prisma.Decimal;
  },
) {
  const companyId = ctx.company.id;
  const created = await tx.purchaseOrder.create({
    data: {
      companyId,
      number: await nextDocumentNumber(tx, companyId, "PURCHASE_ORDER"),
      supplierId: order.supplier.id,
      projectId: order.project?.id ?? null,
      batchId: order.batch?.id ?? null,
      orderDate: dateColumn(order.orderDay),
      expectedDate: order.expectedDate ? dateColumn(order.expectedDate) : null,
      supplierRef: order.supplierRef,
      totalAmount: order.total,
      notes: order.notes,
      createdById: ctx.user.id,
      lines: {
        create: order.lines.map(({ shares, ...line }) => ({
          ...line,
          ...(shares?.length ? { shares: { create: shares } } : {}),
        })),
      },
    },
  });
  const later = order.lines.filter((l) => l.priceLater).length;
  const forWhat = order.batch ?? order.project;
  await auditInCompany(
    ctx,
    meta,
    {
      action: "CREATE",
      entityType: "PurchaseOrder",
      entityId: created.id,
      summary: `Purchase order ${created.number} to ${order.supplier.name}: ${order.lines.length} line(s), ${order.total.toFixed(2)}${
        later > 0 ? ` (${later} priced at receive)` : ""
      }${forWhat ? ` for ${forWhat.code}` : ""}`,
    },
    tx,
  );
  return created.id;
}

/** Locks an order for the rest of the transaction and reads it. */
async function lockOrder(tx: Tx, companyId: string, orderId: string) {
  await lockRow(tx, "PurchaseOrder", orderId);
  const order = await tx.purchaseOrder.findFirst({
    where: { id: orderId, companyId },
    include: {
      lines: true,
      supplier: { select: { name: true } },
      booking: { select: { id: true } },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Purchase order not found.");
  return order;
}

/** An order as the rules read it. */
export const orderState = (order: {
  number: string;
  status: PurchaseOrderStatus;
  lines: Array<{ receivedQty: Prisma.Decimal }>;
}) => ({
  number: order.number,
  status: order.status,
  received: order.lines.some((l) => l.receivedQty.gt(0)),
});

/**
 * Why a booking's order does not change here: on the booking, a change after
 * approval makes a new revision that is approved again.
 */
export const bookingOrderMessage = (number: string) =>
  `${number} is a booking; change it on the booking (Production > Bookings), where a change after approval is approved again.`;

/**
 * Changes an open order: dates, references, the project, and (while nothing
 * has arrived) its lines. A booking's order changes on the booking only.
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
    assertAllowed(canChangeOrder(orderState(order)));
    // A booking's in-house date, items and terms are part of its approval.
    if (order.booking) throw new AppError("CONFLICT", bookingOrderMessage(order.number));
    if (prepared) {
      assertAllowed(canChangeOrderLines(orderState(order)));
      const kept = await keptLineParts(tx, order.id);
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: order.id } });
      for (const line of prepared.lines) {
        const old = kept.get(line.rawMaterialId);
        await tx.purchaseOrderLine.create({
          data: {
            ...line,
            orderId: order.id,
            imageId: old?.imageId ?? null,
            ...(old && old.shares.length > 0
              ? { shares: { create: shareOut(line.quantity, old.shares, old.unit).map(asShare) } }
              : {}),
          },
        });
      }
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

/**
 * What an order's lines carry beyond the form's fields, by material: the picture
 * and the style-wise shares (set when it was made for a batch). Lines rewritten
 * with the same material keep them, the shares in the same proportions.
 */
async function keptLineParts(tx: Tx, orderId: string) {
  const lines = await tx.purchaseOrderLine.findMany({
    where: { orderId },
    orderBy: { id: "asc" },
    include: { shares: { orderBy: { id: "asc" } }, rawMaterial: { select: { unit: true } } },
  });
  const kept = new Map<
    string,
    { imageId: string | null; unit: MeasurementUnit; shares: Array<ShareRow> }
  >();
  for (const l of lines) {
    if (kept.has(l.rawMaterialId)) continue;
    kept.set(l.rawMaterialId, { imageId: l.imageId, unit: l.rawMaterial.unit, shares: l.shares });
  }
  return kept;
}

type ShareRow = {
  projectId: string;
  colorName: string | null;
  sizeName: string | null;
  quantity: Prisma.Decimal;
};

const asShare = (s: ShareRow & { share: Prisma.Decimal }) => ({
  projectId: s.projectId,
  colorName: s.colorName,
  sizeName: s.sizeName,
  quantity: s.share,
});

/**
 * After goods arrive on lines priced at receive: the price on the bill becomes
 * the line's price (and later arrivals default to it), and the order's total
 * counts it.
 */
export async function settleLaterPrices(
  tx: Tx,
  orderId: string,
  billed: Array<{ purchaseOrderLineId: string | null; unitPrice: Prisma.Decimal }>,
) {
  const lines = await tx.purchaseOrderLine.findMany({
    where: { orderId, priceLater: true },
    select: { id: true, quantity: true },
  });
  let changed = false;
  for (const line of lines) {
    const item = billed.find((b) => b.purchaseOrderLineId === line.id);
    if (!item) continue;
    await tx.purchaseOrderLine.update({
      where: { id: line.id },
      data: {
        unitPrice: item.unitPrice,
        amount: money(line.quantity.times(item.unitPrice)),
        priceLater: false,
      },
    });
    changed = true;
  }
  if (!changed) return;
  const all = await tx.purchaseOrderLine.findMany({ where: { orderId }, select: { amount: true } });
  await tx.purchaseOrder.update({
    where: { id: orderId },
    data: { totalAmount: all.reduce((t, l) => t.plus(l.amount), ZERO) },
  });
}

/** Who may cancel or close an order: buyers, or for a booking's the booking permission. */
async function assertCanEndOrder(ctx: CompanyContext, orderId: string) {
  const booking = await ctx.db.booking.findFirst({ where: { orderId }, select: { id: true } });
  if (!booking) return assertCanBuyMaterials(ctx);
  if (!ctx.can("production.bookings.close")) {
    throw new AppError(
      "FORBIDDEN",
      "This order is a booking: closing or cancelling it needs permission to close bookings (production.bookings.close).",
    );
  }
}

/** Cancels an order nothing has arrived on (the supplier will not deliver). */
export async function cancelPurchaseOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  await assertCanEndOrder(ctx, orderId);
  await endOrder(ctx, orderId, raw, meta, "CANCELLED");
  return getPurchaseOrder(ctx, orderId);
}

/** Closes a partly received order: the rest will not come. */
export async function closePurchaseOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  await assertCanEndOrder(ctx, orderId);
  await endOrder(ctx, orderId, raw, meta, "CLOSED");
  return getPurchaseOrder(ctx, orderId);
}

/**
 * Cancels or closes an order with the reason given. The caller checks who may:
 * buyers for purchase orders (above), the booking permissions for a booking's.
 */
export async function endOrder(
  ctx: CompanyContext,
  orderId: string,
  raw: unknown,
  meta: RequestMeta | undefined,
  status: "CANCELLED" | "CLOSED",
) {
  const { reason } = closeOrderSchema.parse(raw);
  if (status === "CLOSED") {
    await runTransaction(async (tx) => {
      const order = await lockOrder(tx, ctx.company.id, orderId);
      assertAllowed(canCloseOrder(orderState(order)));
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
    return;
  }
  await runTransaction(async (tx) => {
    const order = await lockOrder(tx, ctx.company.id, orderId);
    assertAllowed(canCancelOrder(orderState(order)));
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
