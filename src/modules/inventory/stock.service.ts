import { Prisma, type StockGrade } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
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
 * Moves pieces to Bad Stock: removes them from sellable stock and records the
 * purchase value as an inventory loss. (The Accounts module will post the
 * matching journal entry and link it via `journalEntryId`.)
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
    return created;
  });
  return entry;
}

// =============================================================================
// Dashboard insights
// =============================================================================

type SkuRow = {
  variantId: string;
  sku: string;
  styleCode: string;
  styleName: string;
  colorName: string;
  sizeName: string;
  available: number;
};

/**
 * Inventory figures for the master dashboard: stock value, piece counts, low
 * stock (< company threshold), highest stock, slow/dead stock and top sellers.
 */
export async function getStockSummary(ctx: CompanyContext, options: { slowDays?: number } = {}) {
  const companyId = ctx.company.id;
  const threshold = ctx.company.lowStockThreshold;
  const slowSince = new Date(Date.now() - (options.slowDays ?? 90) * 24 * 60 * 60 * 1000);
  const sellingSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Per-SKU available A-grade stock (0 when the SKU has no balance yet).
  const perSku = Prisma.sql`
    SELECT pv.id AS "variantId", pv.sku, s.code AS "styleCode", s.name AS "styleName",
           c.name AS "colorName", z.name AS "sizeName",
           COALESCE(SUM(CASE WHEN sb.grade = 'A_GRADE' THEN sb.quantity - sb.reserved END), 0)::int AS available
    FROM "ProductVariant" pv
    JOIN "Style" s ON s.id = pv."styleId"
    JOIN "Color" c ON c.id = pv."colorId"
    JOIN "Size" z ON z.id = pv."sizeId"
    LEFT JOIN "StockBalance" sb ON sb."variantId" = pv.id
    WHERE pv."companyId" = ${companyId} AND pv."isActive" = true AND s."isActive" = true
    GROUP BY pv.id, s.code, s.name, c.name, z.name`;

  const [totals, lowStock, highestStock, slowStock, topSelling] = await Promise.all([
    prisma.$queryRaw<
      Array<{ value: Prisma.Decimal | null; aGrade: bigint | null; bGrade: bigint | null }>
    >`
      SELECT SUM(GREATEST(sb.quantity, 0) * pv."avgCost") AS value,
             SUM(CASE WHEN sb.grade = 'A_GRADE' THEN sb.quantity END) AS "aGrade",
             SUM(CASE WHEN sb.grade = 'B_GRADE' THEN sb.quantity END) AS "bGrade"
      FROM "StockBalance" sb JOIN "ProductVariant" pv ON pv.id = sb."variantId"
      WHERE sb."companyId" = ${companyId}`,
    prisma.$queryRaw<SkuRow[]>`
      SELECT * FROM (${perSku}) t WHERE available < ${threshold} ORDER BY available ASC, sku LIMIT 50`,
    prisma.$queryRaw<SkuRow[]>`
      SELECT * FROM (${perSku}) t WHERE available > 0 ORDER BY available DESC, sku LIMIT 10`,
    prisma.$queryRaw<SkuRow[]>`
      SELECT * FROM (${perSku}) t
      WHERE available > 0 AND NOT EXISTS (
        SELECT 1 FROM "StockMovement" m
        WHERE m."variantId" = t."variantId" AND m.type = 'SALE_OUT' AND m."createdAt" >= ${slowSince}
      )
      ORDER BY available DESC, sku LIMIT 50`,
    prisma.$queryRaw<Array<{ variantId: string; sku: string; soldQty: bigint }>>`
      SELECT pv.id AS "variantId", pv.sku, -SUM(m.quantity) AS "soldQty"
      FROM "StockMovement" m JOIN "ProductVariant" pv ON pv.id = m."variantId"
      WHERE m."companyId" = ${companyId} AND m.type = 'SALE_OUT' AND m."createdAt" >= ${sellingSince}
      GROUP BY pv.id ORDER BY "soldQty" DESC LIMIT 10`,
  ]);

  const total = totals[0];
  return {
    // Money figures are only shown to roles that may see financials.
    stockValue: ctx.can("dashboard.financials")
      ? (total?.value ?? new Prisma.Decimal(0)).toFixed(2)
      : null,
    aGradePieces: Number(total?.aGrade ?? 0),
    bGradePieces: Number(total?.bGrade ?? 0),
    lowStockThreshold: threshold,
    lowStock,
    highestStock,
    slowStock,
    slowStockDays: options.slowDays ?? 90,
    topSelling: topSelling.map((r) => ({ ...r, soldQty: Number(r.soldQty) })),
  };
}
