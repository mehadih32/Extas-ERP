import { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanBuyMaterials } from "@/modules/materials/access";
import { insertPurchaseOrder, type NewOrderLine } from "@/modules/materials/purchase-order.service";
import { assertUnitFits, loadActiveMaterials } from "@/modules/materials/stock";
import { money, qty, unitCost } from "@/modules/materials/valuation";
import { assertPartyCanTransact } from "@/modules/parties/party.service";
import { assertMaterialImages } from "@/modules/production/material-image.service";
import { type PlannedNeed, planStyles } from "@/modules/production/material-need.service";
import { shareOut } from "@/modules/production/material-plan";
import { createBatchOrdersSchema } from "@/modules/production/schemas";
import { OPEN_STATUSES } from "@/modules/production/timeline";

/*
 * Buying for a master batch in one go: the materials per piece of all its open
 * styles added up by material (what is needed, what the batch's orders already
 * cover and what is still to order), grouped by each material's usual supplier,
 * and one purchase order per supplier with each line shared out over the styles,
 * colours and sizes it is for (the order's style-wise breakdown and its collar
 * and cuff matrices). A line can leave its price for when the goods arrive.
 * Fabric is never ordered here: a batch's fabric is booked with a booking
 * (booking.service.ts), which is shared out over the styles the same way.
 * Buyers only (materials.purchase), as on the purchase orders.
 */

const ZERO = new Prisma.Decimal(0);

type Part = {
  projectId: string;
  colorName: string | null;
  sizeName: string | null;
  quantity: Prisma.Decimal;
};

/** One material over the batch's styles. */
export type BatchMaterialRow = {
  material: PlannedNeed["material"];
  needed: Prisma.Decimal;
  ordered: Prisma.Decimal;
  toOrder: Prisma.Decimal;
  /** Where it goes ("Main body", "Collar"), each once. */
  placements: string[];
  /** The first picture on the styles' needs of it. */
  imageId: string | null;
  /** Codes of the styles that need it. */
  styles: string[];
  /** What the pieces need, by style, colour and size, weighed by what is still to order. */
  parts: Part[];
};

/**
 * What a batch's open styles need, by material: needed, ordered and still to
 * order (never below zero), with the weights a new order is shared out by.
 */
export async function batchMaterialPlan(ctx: CompanyContext, batchId: string) {
  const batch = await ctx.db.productionBatch.findUnique({
    where: { id: batchId },
    select: { id: true, code: true, name: true, kind: true },
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  const styles = await ctx.db.productionProject.findMany({
    where: { batchId: batch.id, status: { in: [...OPEN_STATUSES] } },
    select: { id: true, code: true, name: true, targetQuantity: true },
    orderBy: { code: "asc" },
  });
  const planned = await planStyles(prisma, styles);
  const rows = new Map<string, BatchMaterialRow & { weighted: Part[] }>();
  for (const style of styles) {
    for (const need of planned.get(style.id) ?? []) {
      const row =
        rows.get(need.materialId) ??
        ({
          material: need.material,
          needed: ZERO,
          ordered: ZERO,
          toOrder: ZERO,
          placements: [],
          imageId: null,
          styles: [],
          parts: [],
          weighted: [],
        } satisfies BatchMaterialRow & { weighted: Part[] });
      row.needed = row.needed.plus(need.total);
      row.ordered = row.ordered.plus(need.covered);
      row.toOrder = row.toOrder.plus(need.toOrder);
      if (need.placement && !row.placements.includes(need.placement)) {
        row.placements.push(need.placement);
      }
      row.imageId ??= need.imageId;
      if (!row.styles.includes(style.code)) row.styles.push(style.code);
      // A new order goes first to what is still to order; once all is ordered, to the pieces.
      const left = need.total.gt(0) ? need.toOrder.dividedBy(need.total) : ZERO;
      for (const p of need.parts) {
        const part = { projectId: style.id, colorName: p.colorName, sizeName: p.sizeName };
        row.parts.push({ ...part, quantity: p.quantity });
        row.weighted.push({ ...part, quantity: p.quantity.times(left) });
      }
      rows.set(need.materialId, row);
    }
  }
  const materials = [...rows.values()]
    .map(({ weighted, ...row }) => ({
      ...row,
      parts: weighted.some((w) => w.quantity.gt(0)) ? weighted : row.parts,
    }))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.material.kind) - KIND_ORDER.indexOf(b.material.kind) ||
        a.material.code.localeCompare(b.material.code),
    );
  return {
    batch,
    styles: styles.map((s) => ({
      ...s,
      needs: planned.get(s.id)?.length ?? 0,
    })),
    materials,
  };
}

const KIND_ORDER = ["FABRIC", "TRIM", "ACCESSORY", "PACKAGING", "OTHER"];

export type BatchMaterialPlan = Awaited<ReturnType<typeof batchMaterialPlan>>;

/**
 * Makes one purchase order per supplier for the batch: each line's quantity is
 * shared out over the styles, colours and sizes that need it, its picture is
 * the one on the styles' materials unless another is given, and a line without
 * a price is priced at receive.
 */
export async function createBatchOrders(
  ctx: CompanyContext,
  batchId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = createBatchOrdersSchema.parse(raw);
  assertCanBuyMaterials(ctx);
  const plan = await batchMaterialPlan(ctx, batchId);
  if (plan.styles.length === 0) {
    throw new AppError("CONFLICT", `${plan.batch.code} has no open style to buy materials for.`);
  }
  const rows = new Map(plan.materials.map((m) => [m.material.id, m]));
  const materials = await loadActiveMaterials(
    ctx,
    input.orders.flatMap((o) => o.lines.map((l) => l.materialId)),
  );
  await assertMaterialImages(
    ctx,
    input.orders.flatMap((o) => o.lines.map((l) => l.imageId)),
  );
  const today = localDay(new Date(), ctx.company.timezone);
  const orders: Array<{
    supplier: Awaited<ReturnType<typeof assertPartyCanTransact>>;
    expectedDate: string | null;
    supplierRef: string | null;
    notes: string | null;
    lines: NewOrderLine[];
    total: Prisma.Decimal;
  }> = [];
  for (const [oi, order] of input.orders.entries()) {
    const supplier = await assertPartyCanTransact(ctx, order.supplierId, "PURCHASE");
    if (order.expectedDate && order.expectedDate < today) {
      throw new AppError("VALIDATION", "The goods cannot be expected before today.", {
        [`orders.${oi}.expectedDate`]: ["Choose today or a later day"],
      });
    }
    const lines: NewOrderLine[] = order.lines.map((l, li) => {
      const m = materials.get(l.materialId)!;
      const row = rows.get(l.materialId);
      if (m.kind === "FABRIC") {
        throw new AppError(
          "VALIDATION",
          `${m.code} ${m.name} is fabric. A batch's fabric is ordered with a booking: use "Book fabric", or attach a booking on ${plan.batch.code}.`,
          { [`orders.${oi}.lines.${li}.materialId`]: ["Book fabric with a booking"] },
        );
      }
      if (!row) {
        throw new AppError(
          "VALIDATION",
          `${m.code} ${m.name} is not on the materials per piece of ${plan.batch.code}'s styles.`,
          { [`orders.${oi}.lines.${li}.materialId`]: ["Add it to a style's materials first"] },
        );
      }
      const quantity = qty(l.quantity);
      assertUnitFits(m, quantity, `orders.${oi}.lines.${li}.quantity`);
      const unitPrice = unitCost(l.unitPrice ?? 0);
      return {
        rawMaterialId: m.id,
        quantity,
        unitPrice,
        amount: money(quantity.times(unitPrice)),
        priceLater: l.unitPrice === null || l.unitPrice === undefined,
        imageId: l.imageId ?? row.imageId,
        description: l.description ?? (row.placements.join(", ") || null),
        shares: shareOut(quantity, row.parts, m.unit)
          .filter((s) => s.share.gt(0))
          .map((s) => ({
            projectId: s.projectId,
            colorName: s.colorName,
            sizeName: s.sizeName,
            quantity: s.share,
          })),
      };
    });
    orders.push({
      supplier,
      expectedDate: order.expectedDate ?? null,
      supplierRef: order.supplierRef ?? null,
      notes: order.notes ?? null,
      lines,
      total: lines.reduce((t, l) => t.plus(l.amount), ZERO),
    });
  }
  const created = await runTransaction(
    async (tx) => {
      await lockRow(tx, "ProductionBatch", plan.batch.id);
      const ids: string[] = [];
      for (const o of orders) {
        ids.push(
          await insertPurchaseOrder(tx, ctx, meta, {
            ...o,
            project: null,
            batch: plan.batch,
            orderDay: today,
          }),
        );
      }
      return tx.purchaseOrder.findMany({
        where: { id: { in: ids } },
        select: { id: true, number: true },
        orderBy: { number: "asc" },
      });
    },
    { timeout: 30_000 },
  );
  return { batch: { id: plan.batch.id, code: plan.batch.code }, orders: created };
}
