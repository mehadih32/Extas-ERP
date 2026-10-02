import { Prisma, type StockGrade } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { stockWindow } from "@/modules/dashboard/insights.service";
import { topSellers } from "@/modules/dashboard/sales-figures";
import {
  deadAndSlowStock,
  highestStock,
  lowStock,
  type SkuStock,
  stockOnHand,
} from "@/modules/dashboard/stock-figures";
import {
  adjustStockSchema,
  badStockSchema,
  createWarehouseSchema,
  movementsQuerySchema,
} from "@/modules/inventory/schemas";

/*
 * Stock rules
 * -----------
 * - StockBalance holds the live quantity per SKU x warehouse x grade (A / B).
 * - Every change also writes an immutable StockMovement explaining it.
 * - "Available" = A-grade quantity minus quantity reserved for open orders.
 * - Decreases are atomic and refuse to go below zero; only the Sales module's
 *   Force Override (built later) may sell past zero.
 * - ProductVariant.avgCost is the weighted average cost used for stock value,
 *   COGS and bad-stock loss.
 * - Every change in stock value reaches the books (Finished Goods Inventory):
 *     Opening stock        Dr Inventory              Cr Opening Balance Equity
 *     Count correction +/- Dr Inventory / Losses     Cr Production & Inventory Losses / Inventory
 *     Bad stock            Dr Production & Inventory Losses   Cr Inventory
 *   (deliveries from production and sales post their own entries).
 */

// =============================================================================
// Warehouses
// =============================================================================

export const DEFAULT_WAREHOUSE_NAME = "Main Warehouse";

export async function listWarehouses(ctx: CompanyContext) {
  return ctx.db.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
}

/** The company's default warehouse, created on first use. */
export async function getDefaultWarehouse(ctx: CompanyContext) {
  const existing =
    (await ctx.db.warehouse.findFirst({ where: { isDefault: true } })) ??
    (await ctx.db.warehouse.findFirst({ orderBy: { createdAt: "asc" } }));
  if (existing) return existing;
  return ctx.db.warehouse.upsert({
    where: { companyId_name: { companyId: ctx.company.id, name: DEFAULT_WAREHOUSE_NAME } },
    create: { companyId: ctx.company.id, name: DEFAULT_WAREHOUSE_NAME, isDefault: true },
    update: {},
  });
}

export async function createWarehouse(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createWarehouseSchema.parse(raw);
  const warehouse = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.warehouse.updateMany({
        where: { companyId: ctx.company.id },
        data: { isDefault: false },
      });
    }
    return tx.warehouse.create({
      data: {
        companyId: ctx.company.id,
        name: input.name,
        address: input.address ?? null,
        isDefault: input.isDefault ?? false,
      },
    });
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "Warehouse",
    entityId: warehouse.id,
    summary: `Created warehouse "${warehouse.name}"`,
  });
  return warehouse;
}

async function resolveWarehouse(ctx: CompanyContext, warehouseId?: string) {
  if (!warehouseId) return getDefaultWarehouse(ctx);
  const warehouse = await ctx.db.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new AppError("NOT_FOUND", "Warehouse not found.");
  return warehouse;
}

async function getVariant(ctx: CompanyContext, variantId: string) {
  const variant = await ctx.db.productVariant.findUnique({
    where: { id: variantId },
    include: { style: { select: { code: true, name: true } } },
  });
  if (!variant) throw new AppError("NOT_FOUND", "SKU not found.");
  return variant;
}

// =============================================================================
// Reading stock
// =============================================================================

export type StockCell = { aGrade: number; bGrade: number; reserved: number; available: number };

const emptyCell = (): StockCell => ({ aGrade: 0, bGrade: 0, reserved: 0, available: 0 });

function addBalance(cell: StockCell, grade: StockGrade, quantity: number, reserved: number) {
  if (grade === "A_GRADE") {
    cell.aGrade += quantity;
    cell.reserved += reserved;
  } else {
    cell.bGrade += quantity;
  }
  cell.available = cell.aGrade - cell.reserved;
}

/** Stock per SKU (summed across warehouses unless one is given). */
export async function stockByVariant(
  ctx: CompanyContext,
  variantIds: string[],
  warehouseId?: string,
): Promise<Map<string, StockCell>> {
  const result = new Map<string, StockCell>(variantIds.map((id) => [id, emptyCell()]));
  if (variantIds.length === 0) return result;
  const balances = await ctx.db.stockBalance.findMany({
    where: { variantId: { in: variantIds }, ...(warehouseId ? { warehouseId } : {}) },
    select: { variantId: true, grade: true, quantity: true, reserved: true },
  });
  for (const b of balances) addBalance(result.get(b.variantId)!, b.grade, b.quantity, b.reserved);
  return result;
}

/** Available (sellable) A-grade quantity per SKU — used by sales validation. */
export async function availableByVariant(
  ctx: CompanyContext,
  variantIds: string[],
  warehouseId?: string,
): Promise<Map<string, number>> {
  const cells = await stockByVariant(ctx, variantIds, warehouseId);
  return new Map([...cells].map(([id, cell]) => [id, cell.available]));
}

/** Stock totals per style, for style lists. */
export async function stockTotalsByStyle(
  ctx: CompanyContext,
  styleIds: string[],
): Promise<Map<string, StockCell>> {
  const result = new Map<string, StockCell>(styleIds.map((id) => [id, emptyCell()]));
  if (styleIds.length === 0) return result;
  const rows = await prisma.$queryRaw<
    Array<{ styleId: string; grade: StockGrade; quantity: bigint; reserved: bigint }>
  >`
    SELECT pv."styleId", sb.grade, SUM(sb.quantity) AS quantity, SUM(sb.reserved) AS reserved
    FROM "StockBalance" sb
    JOIN "ProductVariant" pv ON pv.id = sb."variantId"
    WHERE sb."companyId" = ${ctx.company.id} AND pv."styleId" IN (${Prisma.join(styleIds)})
    GROUP BY pv."styleId", sb.grade`;
  for (const r of rows) {
    addBalance(result.get(r.styleId)!, r.grade, Number(r.quantity), Number(r.reserved));
  }
  return result;
}

export async function listMovements(ctx: CompanyContext, raw: unknown = {}) {
  const query = movementsQuerySchema.parse(raw);
  const take = query.take ?? 50;
  const rows = await ctx.db.stockMovement.findMany({
    where: {
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.styleId ? { variant: { styleId: query.styleId } } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    },
    include: {
      variant: {
        select: {
          sku: true,
          color: { select: { name: true } },
          size: { select: { name: true } },
        },
      },
      warehouse: { select: { name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]?.id : undefined };
}

// =============================================================================
// Changing stock
// =============================================================================

type Tx = Prisma.TransactionClient;

/** Atomically removes stock; fails instead of going below zero. */
async function decrementBalance(
  tx: Tx,
  key: { variantId: string; warehouseId: string; grade: StockGrade },
  quantity: number,
) {
  const { count } = await tx.stockBalance.updateMany({
    where: { ...key, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (count === 0) {
    const current = await tx.stockBalance.findUnique({
      where: { variantId_warehouseId_grade: key },
      select: { quantity: true },
    });
    throw new AppError(
      "CONFLICT",
      `Not enough stock: ${current?.quantity ?? 0} in hand, ${quantity} requested.`,
    );
  }
}

/** New weighted average after receiving `quantity` pieces at `unitCost`. */
export function weightedAverageCost(
  onHand: number,
  currentAvg: number,
  quantity: number,
  unitCost: number,
): number {
  const base = Math.max(onHand, 0);
  if (base + quantity <= 0) return unitCost;
  return (base * currentAvg + quantity * unitCost) / (base + quantity);
}

/**
 * Manual stock change: opening stock or a correction (+/-). Incoming stock with a
 * unit cost updates the SKU's weighted average cost.
 */
export async function adjustStock(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = adjustStockSchema.parse(raw);
  const variant = await getVariant(ctx, input.variantId);
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);
  const key = { variantId: variant.id, warehouseId: warehouse.id, grade: input.grade };

  // Value at the cost given for incoming stock, otherwise the SKU's average cost.
  const unitCost =
    input.quantity > 0 && input.unitCost !== undefined ? input.unitCost : Number(variant.avgCost);
  const value = new Prisma.Decimal((unitCost * Math.abs(input.quantity)).toFixed(2));

  const movement = await prisma.$transaction(async (tx) => {
    if (input.quantity < 0) {
      await decrementBalance(tx, key, -input.quantity);
    } else {
      if (input.unitCost !== undefined) {
        const onHand = await tx.stockBalance.aggregate({
          where: { variantId: variant.id },
          _sum: { quantity: true },
        });
        const avg = weightedAverageCost(
          onHand._sum.quantity ?? 0,
          Number(variant.avgCost),
          input.quantity,
          input.unitCost,
        );
        await tx.productVariant.update({
          where: { id: variant.id },
          data: { avgCost: new Prisma.Decimal(avg.toFixed(4)) },
        });
      }
      await tx.stockBalance.upsert({
        where: { variantId_warehouseId_grade: key },
        create: { ...key, companyId: ctx.company.id, quantity: input.quantity },
        update: { quantity: { increment: input.quantity } },
      });
    }
    const created = await tx.stockMovement.create({
      data: {
        ...key,
        companyId: ctx.company.id,
        type: input.type,
        quantity: input.quantity,
        unitCost: input.unitCost ?? variant.avgCost,
        note: input.note,
        createdById: ctx.user.id,
      },
    });
    if (value.gt(0)) {
      const acc = await ensureControlAccounts(ctx.company.id, tx);
      // Opening stock is brought forward against equity; corrections are gains or losses.
      const other = input.type === "OPENING" ? acc.OPENING_EQUITY : acc.PRODUCTION_LOSS;
      const memo = `${variant.sku} × ${Math.abs(input.quantity)}`;
      await postJournalEntry(tx, {
        companyId: ctx.company.id,
        description: `${input.type === "OPENING" ? "Opening stock" : "Stock count correction"} — ${variant.sku} ${
          input.quantity > 0 ? "+" : ""
        }${input.quantity}${input.note ? ` (${input.note})` : ""}`,
        sourceType: "STOCK_ADJUSTMENT",
        sourceId: created.id,
        postedById: ctx.user.id,
        lines:
          input.quantity > 0
            ? [
                { accountId: acc.INVENTORY, debit: value, memo },
                { accountId: other, credit: value, memo },
              ]
            : [
                { accountId: other, debit: value, memo },
                { accountId: acc.INVENTORY, credit: value, memo },
              ],
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STOCK_ADJUSTMENT",
        entityType: "ProductVariant",
        entityId: variant.id,
        summary: `${input.type === "OPENING" ? "Opening stock" : "Adjusted"} ${variant.sku}: ${
          input.quantity > 0 ? "+" : ""
        }${input.quantity} (${input.grade === "A_GRADE" ? "A" : "B"}-grade, ${warehouse.name})`,
      },
      tx,
    );
    return created;
  });

  const stock = (await stockByVariant(ctx, [variant.id])).get(variant.id)!;
  return { movement, stock };
}

/**
 * Moves pieces to Bad Stock: removes them from sellable stock and books their
 * value (average cost) as an inventory loss.
 */
export async function moveToBadStock(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = badStockSchema.parse(raw);
  const variant = await getVariant(ctx, input.variantId);
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);
  const key = { variantId: variant.id, warehouseId: warehouse.id, grade: input.grade };
  const unitCost = Number(variant.avgCost);
  const lossValue = new Prisma.Decimal((unitCost * input.quantity).toFixed(2));

  const entry = await prisma.$transaction(async (tx) => {
    await decrementBalance(tx, key, input.quantity);
    const created = await tx.badStockEntry.create({
      data: {
        companyId: ctx.company.id,
        variantId: variant.id,
        quantity: input.quantity,
        unitCost: variant.avgCost,
        lossValue,
        source: input.source,
        reason: input.reason,
      },
    });
    await tx.stockMovement.create({
      data: {
        ...key,
        companyId: ctx.company.id,
        type: "BAD_STOCK_OUT",
        quantity: -input.quantity,
        unitCost: variant.avgCost,
        referenceType: "BadStockEntry",
        referenceId: created.id,
        note: input.reason,
        createdById: ctx.user.id,
      },
    });
    let journalEntryId: string | null = null;
    if (lossValue.gt(0)) {
      const acc = await ensureControlAccounts(ctx.company.id, tx);
      const memo = `${variant.sku} × ${input.quantity}`;
      const journal = await postJournalEntry(tx, {
        companyId: ctx.company.id,
        description: `Bad stock — ${variant.sku} × ${input.quantity}${input.reason ? ` (${input.reason})` : ""}`,
        sourceType: "BAD_STOCK",
        sourceId: created.id,
        postedById: ctx.user.id,
        lines: [
          { accountId: acc.PRODUCTION_LOSS, debit: lossValue, memo },
          { accountId: acc.INVENTORY, credit: lossValue, memo },
        ],
      });
      await tx.badStockEntry.update({
        where: { id: created.id },
        data: { journalEntryId: journal.id },
      });
      journalEntryId = journal.id;
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STOCK_ADJUSTMENT",
        entityType: "BadStockEntry",
        entityId: created.id,
        summary: `Moved ${input.quantity} × ${variant.sku} to Bad Stock (loss ${lossValue.toFixed(2)})`,
      },
      tx,
    );
    return { ...created, journalEntryId };
  });
  return entry;
}

// =============================================================================
// Stock summary
// =============================================================================

const skuRow = (r: SkuStock) => ({
  variantId: r.variantId,
  sku: r.sku,
  styleCode: r.styleCode,
  styleName: r.styleName,
  colorName: r.colorName,
  sizeName: r.sizeName,
  available: r.available,
});

/**
 * Inventory figures: stock value, piece counts, low stock (below the company's
 * threshold), highest stock, dead and slow stock, and the top sellers of the
 * last 30 days. Same rules as the master dashboard (src/modules/dashboard), so
 * the two never disagree.
 */
export async function getStockSummary(ctx: CompanyContext, options: { slowDays?: number } = {}) {
  const companyId = ctx.company.id;
  const threshold = ctx.company.lowStockThreshold;
  const slowDays = options.slowDays ?? 90;
  const now = new Date();
  const window = stockWindow(ctx.company, { slowDays, coverDays: 180 }, now);

  const [onHand, low, highest, deadSlow, top] = await Promise.all([
    stockOnHand(companyId),
    lowStock(companyId, window, threshold, 50),
    highestStock(companyId, window, 10),
    deadAndSlowStock(companyId, window, 50),
    topSellers(
      companyId,
      { start: window.recentSince, end: now },
      { groupBy: "SKU", sortBy: "QUANTITY", limit: 10 },
    ),
  ]);

  return {
    // Money figures are only shown to roles that may see financials.
    stockValue: canSeeFinancials(ctx)
      ? onHand.aGradeValue.plus(onHand.bGradeValue).toFixed(2)
      : null,
    aGradePieces: onHand.aGradePieces,
    bGradePieces: onHand.bGradePieces,
    lowStockThreshold: threshold,
    lowStock: low.items.map(skuRow),
    highestStock: highest.map(skuRow),
    /** Dead stock (nothing sold in slowStockDays), then slow stock. */
    slowStock: deadSlow.items.map((r) => ({ ...skuRow(r), movement: r.movement })),
    slowStockDays: slowDays,
    topSelling: top.items.map((r) => ({ variantId: r.id, sku: r.sku, soldQty: r.pieces })),
  };
}
