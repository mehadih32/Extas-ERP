import { Prisma, type StockGrade, type StockMovement } from "@prisma/client";

import { dayRange } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow, lockRows } from "@/lib/row-lock";
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
import { gradeCost, gradeCostData } from "@/modules/inventory/costs";
import { refuseTakenName, sameName } from "@/modules/inventory/names";
import {
  adjustStockSchema,
  badStockQuerySchema,
  badStockSchema,
  createWarehouseSchema,
  movementsQuerySchema,
  stockCountSchema,
} from "@/modules/inventory/schemas";

/*
 * Stock rules
 * -----------
 * - StockBalance holds the live quantity per SKU x warehouse x grade (A / B).
 * - Every change also writes an immutable StockMovement explaining it.
 * - "Available" = A-grade quantity minus quantity reserved for open orders.
 * - Decreases are atomic and refuse to go below zero; only the Sales module's
 *   Force Override (built later) may sell past zero.
 * - Each SKU keeps a weighted average cost per grade (see ./costs.ts):
 *   avgCost for A-grade (stock value, COGS) and bGradeAvgCost for B-grade.
 *   Pieces in and out of a grade use and re-weight that grade's cost only.
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
  await refuseTakenName(
    ctx.db.warehouse.findFirst({ where: sameName(input.name), select: { id: true } }),
    `There is already a warehouse called ${input.name}.`,
  );
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
// Costs and people
// =============================================================================

/**
 * Hides what finished stock cost from people who may not see the financials
 * (as on the dashboard): their costs and values come back as null.
 */
export function costMask(ctx: CompanyContext) {
  const shown = canSeeFinancials(ctx);
  return (value: Prisma.Decimal | null): string | null =>
    shown && value !== null ? value.toFixed(2) : null;
}

/** A stock movement as the screens and the API show it. */
function presentMovement(cost: ReturnType<typeof costMask>, m: StockMovement) {
  return {
    id: m.id,
    variantId: m.variantId,
    warehouseId: m.warehouseId,
    grade: m.grade,
    type: m.type,
    /** Pieces in (+) or out (-). */
    quantity: m.quantity,
    note: m.note,
    referenceType: m.referenceType,
    referenceId: m.referenceId,
    createdAt: m.createdAt,
    unitCost: cost(m.unitCost),
    /** What the pieces were worth: quantity x cost. */
    value: cost(m.unitCost === null ? null : m.unitCost.times(Math.abs(m.quantity))),
  };
}

/** People's names by id, for "recorded by". */
async function namesOf(ids: Array<string | null>) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map<string, { id: string; name: string }>();
  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u]));
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
      warehouse: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const people = await namesOf(page.map((m) => m.createdById));
  const cost = costMask(ctx);
  return {
    items: page.map((m) => ({
      ...presentMovement(cost, m),
      variant: m.variant,
      warehouse: m.warehouse,
      recordedBy: m.createdById ? (people.get(m.createdById) ?? null) : null,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
  };
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

/** The SKU's grade costs, locked so no other change re-weights them meanwhile. */
async function lockGradeCosts(tx: Tx, variantId: string) {
  await lockRow(tx, "ProductVariant", variantId);
  return tx.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { avgCost: true, bGradeAvgCost: true },
  });
}

/** One opening-stock or correction line: `quantity` pieces in (+) or out (-). */
type Adjustment = {
  variant: { id: string; sku: string };
  warehouse: { id: string };
  grade: StockGrade;
  quantity: number;
  type: "OPENING" | "ADJUSTMENT";
  /** What incoming pieces cost each; without it they come in at the grade's average cost. */
  unitCost?: number;
  note?: string;
};

/**
 * Applies one adjustment inside `tx`: the balance, the grade's average cost for
 * incoming pieces with a cost, the movement and the journal entry. Refuses to
 * take stock below zero.
 */
async function applyAdjustment(tx: Tx, ctx: CompanyContext, change: Adjustment) {
  const { variant, grade, quantity } = change;
  const key = { variantId: variant.id, warehouseId: change.warehouse.id, grade };
  const average = gradeCost(await lockGradeCosts(tx, variant.id), grade);
  // Value at the cost given for incoming stock, otherwise the grade's average cost.
  const unitCost =
    quantity > 0 && change.unitCost !== undefined ? new Prisma.Decimal(change.unitCost) : average;
  const value = unitCost.times(Math.abs(quantity)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  if (quantity < 0) {
    await decrementBalance(tx, key, -quantity);
  } else {
    if (change.unitCost !== undefined) {
      const onHand = await tx.stockBalance.aggregate({
        where: { variantId: variant.id, grade },
        _sum: { quantity: true },
      });
      const avg = weightedAverageCost(
        onHand._sum.quantity ?? 0,
        average.toNumber(),
        quantity,
        change.unitCost,
      );
      await tx.productVariant.update({
        where: { id: variant.id },
        data: gradeCostData(grade, avg),
      });
    }
    await tx.stockBalance.upsert({
      where: { variantId_warehouseId_grade: key },
      create: { ...key, companyId: ctx.company.id, quantity },
      update: { quantity: { increment: quantity } },
    });
  }
  const created = await tx.stockMovement.create({
    data: {
      ...key,
      companyId: ctx.company.id,
      type: change.type,
      quantity,
      unitCost,
      note: change.note,
      createdById: ctx.user.id,
    },
  });
  if (value.gt(0)) {
    const acc = await ensureControlAccounts(ctx.company.id, tx);
    // Opening stock is brought forward against equity; corrections are gains or losses.
    const other = change.type === "OPENING" ? acc.OPENING_EQUITY : acc.PRODUCTION_LOSS;
    const memo = `${variant.sku} × ${Math.abs(quantity)}`;
    await postJournalEntry(tx, {
      companyId: ctx.company.id,
      description: `${change.type === "OPENING" ? "Opening stock" : "Stock count correction"} — ${variant.sku} ${
        quantity > 0 ? "+" : ""
      }${quantity}${change.note ? ` (${change.note})` : ""}`,
      sourceType: "STOCK_ADJUSTMENT",
      sourceId: created.id,
      postedById: ctx.user.id,
      lines:
        quantity > 0
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
  return created;
}

const gradeLetter = (grade: StockGrade) => (grade === "A_GRADE" ? "A" : "B");

/**
 * Manual stock change: opening stock or a correction (+/-). Incoming stock with a
 * unit cost updates the weighted average cost of its grade.
 */
export async function adjustStock(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = adjustStockSchema.parse(raw);
  const variant = await getVariant(ctx, input.variantId);
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);

  const movement = await prisma.$transaction(async (tx) => {
    const created = await applyAdjustment(tx, ctx, {
      variant,
      warehouse,
      grade: input.grade,
      quantity: input.quantity,
      type: input.type,
      unitCost: input.unitCost,
      note: input.note,
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
        }${input.quantity} (${gradeLetter(input.grade)}-grade, ${warehouse.name})`,
      },
      tx,
    );
    return created;
  });

  const stock = (await stockByVariant(ctx, [variant.id])).get(variant.id)!;
  return { movement: presentMovement(costMask(ctx), movement), stock };
}

/**
 * A stock count or opening stock for several SKUs at one warehouse and grade, in
 * one go. A count gives the pieces found on the shelf and the pieces the screen
 * showed when counting began; if any SKU's stock moved since, nothing is saved
 * and the count is refused, so a sale or delivery in between is never undone.
 * Each SKU whose count differs gets a correction for the difference, valued at
 * its grade's average cost. Opening stock adds pieces, at `unitCost` when given.
 */
export async function recordStockCount(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = stockCountSchema.parse(raw);
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);
  const ids = input.lines.map((l) => l.variantId);
  const variants = await ctx.db.productVariant.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true },
  });
  if (variants.length !== ids.length) {
    throw new AppError("NOT_FOUND", "One or more SKUs were not found.");
  }
  const skuOf = new Map(variants.map((v) => [v.id, v.sku]));

  const changes =
    input.mode === "COUNT"
      ? input.lines
          .filter((l) => l.counted !== l.expected)
          .map((l) => ({
            variantId: l.variantId,
            quantity: l.counted - l.expected,
            expected: l.expected,
          }))
      : input.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, expected: 0 }));
  const added = changes.reduce((sum, c) => sum + Math.max(c.quantity, 0), 0);
  const removed = changes.reduce((sum, c) => sum + Math.max(-c.quantity, 0), 0);
  const summary = { changed: changes.length, added, removed };
  if (changes.length === 0) return summary;

  await prisma.$transaction(
    async (tx) => {
      // The SKUs first, as every stock change locks them, then their shelves.
      await lockRows(
        tx,
        "ProductVariant",
        changes.map((c) => c.variantId),
      );
      if (input.mode === "COUNT") {
        const shelves = await tx.$queryRaw<Array<{ variantId: string; quantity: number }>>`
          SELECT "variantId", quantity FROM "StockBalance"
          WHERE "warehouseId" = ${warehouse.id} AND grade = ${input.grade}::"StockGrade"
            AND "variantId" IN (${Prisma.join(changes.map((c) => c.variantId))})
          FOR UPDATE`;
        const onShelf = new Map(shelves.map((r) => [r.variantId, r.quantity]));
        const moved = changes
          .filter((c) => (onShelf.get(c.variantId) ?? 0) !== c.expected)
          .map((c) => skuOf.get(c.variantId)!);
        if (moved.length > 0) {
          throw new AppError(
            "CONFLICT",
            `Stock changed while you were counting (${moved.join(", ")}). Reload the count, check those SKUs again and save.`,
          );
        }
      }
      for (const change of changes) {
        await applyAdjustment(tx, ctx, {
          variant: { id: change.variantId, sku: skuOf.get(change.variantId)! },
          warehouse,
          grade: input.grade,
          quantity: change.quantity,
          type: input.mode === "OPENING" ? "OPENING" : "ADJUSTMENT",
          unitCost: input.mode === "OPENING" ? input.unitCost : undefined,
          note: input.note,
        });
      }
      const what = input.mode === "OPENING" ? "Opening stock" : "Stock count";
      await auditInCompany(
        ctx,
        meta,
        {
          action: "STOCK_ADJUSTMENT",
          entityType: "Warehouse",
          entityId: warehouse.id,
          summary: `${what} at ${warehouse.name} (${gradeLetter(input.grade)}-grade): ${
            changes.length
          } SKU(s), +${added} / -${removed}${input.note ? ` (${input.note})` : ""}`,
          after: {
            lines: changes.map((c) => ({ sku: skuOf.get(c.variantId), change: c.quantity })),
          },
        },
        tx,
      );
    },
    { timeout: 30_000 },
  );
  return summary;
}

/**
 * Moves pieces to Bad Stock: removes them from sellable stock and books their
 * value (their grade's average cost) as an inventory loss.
 */
export async function moveToBadStock(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = badStockSchema.parse(raw);
  const variant = await getVariant(ctx, input.variantId);
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);
  const key = { variantId: variant.id, warehouseId: warehouse.id, grade: input.grade };

  const entry = await prisma.$transaction(async (tx) => {
    const unitCost = gradeCost(await lockGradeCosts(tx, variant.id), input.grade);
    const lossValue = unitCost
      .times(input.quantity)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    await decrementBalance(tx, key, input.quantity);
    const created = await tx.badStockEntry.create({
      data: {
        companyId: ctx.company.id,
        variantId: variant.id,
        quantity: input.quantity,
        unitCost,
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
        unitCost,
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
  const cost = costMask(ctx);
  return {
    id: entry.id,
    variantId: entry.variantId,
    quantity: entry.quantity,
    source: entry.source,
    reason: entry.reason,
    createdAt: entry.createdAt,
    journalEntryId: entry.journalEntryId,
    unitCost: cost(entry.unitCost),
    lossValue: cost(entry.lossValue),
  };
}

/**
 * Bad stock entries, newest first, with where the pieces came from (warehouse
 * and grade), who recorded them and the totals for the chosen days. The cost
 * and loss of each entry go only to those who see the financials.
 */
export async function listBadStock(ctx: CompanyContext, raw: unknown = {}) {
  const query = badStockQuerySchema.parse(raw);
  const take = query.take ?? 30;
  const { start, end } = dayRange(query.from, query.to, ctx.company.timezone);
  const where: Prisma.BadStockEntryWhereInput = {
    ...(start || end
      ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
      : {}),
    ...(query.styleId ? { variant: { styleId: query.styleId } } : {}),
  };
  const [rows, totals] = await Promise.all([
    ctx.db.badStockEntry.findMany({
      where,
      include: {
        variant: {
          select: {
            sku: true,
            style: { select: { id: true, code: true, name: true } },
            color: { select: { name: true, hexCode: true } },
            size: { select: { name: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    ctx.db.badStockEntry.aggregate({
      where,
      _count: { _all: true },
      _sum: { quantity: true, lossValue: true },
    }),
  ]);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  // Where each entry's pieces left from: its Bad Stock movement.
  const movements = await ctx.db.stockMovement.findMany({
    where: { referenceType: "BadStockEntry", referenceId: { in: page.map((e) => e.id) } },
    select: {
      referenceId: true,
      grade: true,
      createdById: true,
      warehouse: { select: { id: true, name: true } },
    },
  });
  const movementOf = new Map(movements.map((m) => [m.referenceId, m]));
  const people = await namesOf(movements.map((m) => m.createdById));
  const cost = costMask(ctx);

  return {
    items: page.map((e) => {
      const movement = movementOf.get(e.id);
      return {
        id: e.id,
        createdAt: e.createdAt,
        quantity: e.quantity,
        source: e.source,
        reason: e.reason,
        variantId: e.variantId,
        sku: e.variant.sku,
        style: e.variant.style,
        color: e.variant.color,
        size: e.variant.size,
        warehouse: movement?.warehouse ?? null,
        grade: movement?.grade ?? null,
        recordedBy: movement?.createdById ? (people.get(movement.createdById) ?? null) : null,
        unitCost: cost(e.unitCost),
        lossValue: cost(e.lossValue),
      };
    }),
    nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    totals: {
      entries: totals._count._all,
      pieces: totals._sum.quantity ?? 0,
      lossValue: cost(totals._sum.lossValue ?? new Prisma.Decimal(0)),
    },
    /** Whether the costs and losses above are filled in for this person. */
    showsCosts: canSeeFinancials(ctx),
  };
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
