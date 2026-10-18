import { Prisma, type StockGrade, type StockMovement } from "@prisma/client";

import { verifyPassword } from "@/lib/auth/password";
import { dayRange } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
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
import { isCompanyOwner } from "@/modules/hr/access";
import { gradeCost, gradeCostData, receiveAtCost } from "@/modules/inventory/costs";
import { openLots } from "@/modules/inventory/lot.service";
import { refuseTakenName, sameName } from "@/modules/inventory/names";
import { canDeleteWarehouse, type WarehouseHold } from "@/modules/inventory/rules";
import {
  adjustStockSchema,
  badStockQuerySchema,
  badStockSchema,
  createWarehouseSchema,
  deleteWarehouseSchema,
  movementsQuerySchema,
  stockCountSchema,
} from "@/modules/inventory/schemas";
import { SHIPMENT_OPEN } from "@/modules/sales/rules";

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
 *     Count shortage       Dr Inventory Loss         Cr Inventory
 *     Count surplus        Dr Inventory              Cr Inventory Loss
 *     Damage & QC reject   Dr Inventory Loss         Cr Inventory
 *     Pieces sold before   Dr Inventory              Cr Cost of Goods Sold
 *     stock arrived        (or the other way round; receiveAtCostTx)
 *   (deliveries from production and sales post their own entries). Inventory
 *   Loss (5150) took over from Production & Inventory Losses (5100) in October
 *   2026; entries posted before stay where they are.
 */

// =============================================================================
// Warehouses
// =============================================================================

export const DEFAULT_WAREHOUSE_NAME = "Main Warehouse";

/** Deleted warehouses stay for the history but leave every list and picker. */
const LIVE = { deletedAt: null } as const;

export async function listWarehouses(ctx: CompanyContext) {
  return ctx.db.warehouse.findMany({
    where: LIVE,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

/** The company's default warehouse, created on first use. */
export async function getDefaultWarehouse(ctx: CompanyContext) {
  const existing =
    (await ctx.db.warehouse.findFirst({ where: { ...LIVE, isDefault: true } })) ??
    (await ctx.db.warehouse.findFirst({ where: LIVE, orderBy: { createdAt: "asc" } }));
  if (existing) return existing;
  return ctx.db.warehouse.upsert({
    where: { companyId_name: { companyId: ctx.company.id, name: DEFAULT_WAREHOUSE_NAME } },
    create: { companyId: ctx.company.id, name: DEFAULT_WAREHOUSE_NAME, isDefault: true },
    // A deleted Main Warehouse comes back rather than leave the company with none.
    update: { deletedAt: null, isDefault: true },
  });
}

export async function createWarehouse(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createWarehouseSchema.parse(raw);
  await refuseTakenName(
    ctx.db.warehouse.findFirst({
      where: { ...LIVE, ...sameName(input.name) },
      select: { id: true },
    }),
    `There is already a warehouse called ${input.name}.`,
  );
  // A deleted warehouse of the same name comes back, with its history.
  const deleted = await ctx.db.warehouse.findFirst({
    where: { deletedAt: { not: null }, ...sameName(input.name) },
    select: { id: true },
  });
  const warehouse = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.warehouse.updateMany({
        where: { companyId: ctx.company.id },
        data: { isDefault: false },
      });
    }
    const data = {
      name: input.name,
      address: input.address ?? null,
      isDefault: input.isDefault ?? false,
    };
    return deleted
      ? tx.warehouse.update({ where: { id: deleted.id }, data: { ...data, deletedAt: null } })
      : tx.warehouse.create({ data: { ...data, companyId: ctx.company.id } });
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "Warehouse",
    entityId: warehouse.id,
    summary: `${deleted ? "Brought back" : "Created"} warehouse "${warehouse.name}"`,
  });
  return warehouse;
}

/**
 * Each warehouse's stock and the open work bound for it: what keeps it from
 * being deleted (inventory/rules.ts canDeleteWarehouse).
 */
export async function warehouseHolds(
  db: Db,
  companyId: string,
  ids: string[],
): Promise<Map<string, WarehouseHold>> {
  const holds = new Map<string, WarehouseHold>(
    ids.map((id) => [id, { pieces: 0, materials: 0, orders: 0, deliveries: 0 }]),
  );
  if (ids.length === 0) return holds;
  const warehouseId = { in: ids };
  const [balances, materials, orders, deliveries] = await Promise.all([
    db.stockBalance.findMany({
      where: { companyId, warehouseId, OR: [{ quantity: { not: 0 } }, { reserved: { not: 0 } }] },
      select: { warehouseId: true, quantity: true, reserved: true },
    }),
    db.rawMaterialStock.groupBy({
      by: ["warehouseId"],
      where: { companyId, warehouseId, quantity: { not: 0 } },
      _count: { _all: true },
    }),
    db.salesOrder.groupBy({
      by: ["warehouseId"],
      where: { companyId, warehouseId, status: { in: [...SHIPMENT_OPEN] } },
      _count: { _all: true },
    }),
    db.stockIntake.groupBy({
      by: ["warehouseId"],
      where: { companyId, warehouseId, status: { in: ["DRAFT", "PARSED"] } },
      _count: { _all: true },
    }),
  ]);
  for (const b of balances) {
    // Pieces set aside with none on the shelf still count: an order is waiting on them.
    holds.get(b.warehouseId)!.pieces += Math.max(Math.abs(b.quantity), b.reserved);
  }
  for (const m of materials) holds.get(m.warehouseId)!.materials = m._count._all;
  for (const o of orders) if (o.warehouseId) holds.get(o.warehouseId)!.orders = o._count._all;
  for (const d of deliveries) {
    if (d.warehouseId) holds.get(d.warehouseId)!.deliveries = d._count._all;
  }
  return holds;
}

/**
 * Deletes an empty warehouse: a Super Admin only, who types their password
 * again. It is kept for the history (its movements, lots and documents still
 * name it) but leaves every list and picker; adding a warehouse of the same name
 * brings it back. The default passes to the oldest warehouse left.
 */
export async function deleteWarehouse(
  ctx: CompanyContext,
  warehouseId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  if (!isCompanyOwner(ctx)) {
    throw new AppError("FORBIDDEN", "Only a Super Admin can delete a warehouse.");
  }
  const input = deleteWarehouseSchema.parse(raw);
  checkRateLimit(`warehouse-delete:${ctx.user.id}`, 5, 60_000);
  const user = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError("VALIDATION", "That password is not right.", {
      password: ["That password is not right. Type the one you sign in with."],
    });
  }
  const companyId = ctx.company.id;
  const warehouse = await prisma.$transaction(async (tx) => {
    // The company's warehouses (two deletes never leave it with none, and no new shelf
    // or movement can point at this one meanwhile), then this one's shelves.
    const live = await tx.$queryRaw<
      Array<{ id: string; name: string; isDefault: boolean; createdAt: Date }>
    >`
      SELECT id, name, "isDefault", "createdAt" FROM "Warehouse"
      WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
      ORDER BY id
      FOR UPDATE`;
    const found = live.find((w) => w.id === warehouseId);
    if (!found) throw new AppError("NOT_FOUND", "Warehouse not found.");
    await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE "warehouseId" = ${found.id} FOR UPDATE`;
    const holds = await warehouseHolds(tx, companyId, [found.id]);
    const others = live
      .filter((w) => w.id !== found.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const verdict = canDeleteWarehouse({ hold: holds.get(found.id)!, others: others.length });
    if (!verdict.ok) throw new AppError(verdict.code, `${found.name}: ${verdict.message}`);
    await tx.warehouse.update({
      where: { id: found.id },
      data: { deletedAt: new Date(), isDefault: false },
    });
    const heir = found.isDefault ? others[0]! : null;
    if (heir) await tx.warehouse.update({ where: { id: heir.id }, data: { isDefault: true } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Warehouse",
        entityId: found.id,
        summary: `Deleted warehouse "${found.name}"${heir ? `; ${heir.name} is now the default` : ""}`,
      },
      tx,
    );
    return { id: found.id, name: found.name, newDefault: heir?.name ?? null };
  });
  return warehouse;
}

/** A warehouse in use (not deleted), or the default one when none is given. */
export async function resolveWarehouse(
  ctx: CompanyContext,
  warehouseId?: string | null,
  notFound = "Warehouse not found.",
) {
  if (!warehouseId) return getDefaultWarehouse(ctx);
  const warehouse = await ctx.db.warehouse.findFirst({ where: { id: warehouseId, ...LIVE } });
  if (!warehouse) throw new AppError("NOT_FOUND", notFound);
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

/** A SKU taken off its style's matrix takes no stock until it is ticked again. */
function assertOnMatrix(variant: { sku: string; removedAt: Date | null } | undefined) {
  if (!variant?.removedAt) return;
  throw new AppError(
    "VALIDATION",
    `${variant.sku} was taken off its style's matrix. Tick its colour and size again first.`,
  );
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
      lot: { select: { number: true } },
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
      /** The inward batch the pieces came with or went back out of (LOT-2026-00001). */
      lot: m.lot?.number ?? null,
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

/**
 * Pieces coming in at a cost (a delivery from production, opening stock or a
 * correction with a cost, a cancelled order's delivered pieces back in stock)
 * re-weight their SKU grade's average cost. When the grade was below zero,
 * the first of them are pieces already sold at the old average: their cost of
 * sales is put right at the incoming cost (receiveAtCost), so Finished Goods
 * Inventory keeps matching the pieces on hand at average cost:
 *   cost overstated     Dr Finished Goods Inventory   Cr Cost of Goods Sold
 *   cost understated    Dr Cost of Goods Sold         Cr Finished Goods Inventory
 * Inside the caller's transaction with the SKU locked, after the movement that
 * brings the pieces in (the entry's source); `onHand` (every warehouse) and
 * `average` are the grade's from before they came.
 */
export async function receiveAtCostTx(
  tx: Tx,
  ctx: CompanyContext,
  args: {
    variant: { id: string; sku: string };
    grade: StockGrade;
    onHand: number;
    average: Prisma.Decimal.Value;
    quantity: number;
    unitCost: Prisma.Decimal.Value;
    movementId: string;
  },
) {
  const { variant, grade } = args;
  const received = receiveAtCost(args.onHand, args.average, args.quantity, args.unitCost);
  await tx.productVariant.update({
    where: { id: variant.id },
    data: gradeCostData(grade, received.average),
  });
  if (!received.trueUp.isZero()) {
    const acc = await ensureControlAccounts(ctx.company.id, tx);
    const amount = received.trueUp.abs();
    const pieces = `${variant.sku}${grade === "B_GRADE" ? " (B-grade)" : ""} × ${received.filled}`;
    await postJournalEntry(tx, {
      companyId: ctx.company.id,
      description: `Cost of pieces sold before stock arrived — ${pieces}`,
      sourceType: "STOCK_ADJUSTMENT",
      sourceId: args.movementId,
      postedById: ctx.user.id,
      lines: received.trueUp.gt(0)
        ? [
            { accountId: acc.INVENTORY, debit: amount, memo: pieces },
            { accountId: acc.COGS, credit: amount, memo: pieces },
          ]
        : [
            { accountId: acc.COGS, debit: amount, memo: pieces },
            { accountId: acc.INVENTORY, credit: amount, memo: pieces },
          ],
    });
  }
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
  /** The inward batch opening stock comes in with. */
  lotId?: string;
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

  // The grade's pieces before incoming ones with a cost, which re-weight its average.
  let before: number | undefined;
  if (quantity < 0) {
    await decrementBalance(tx, key, -quantity);
  } else {
    if (change.unitCost !== undefined) {
      const onHand = await tx.stockBalance.aggregate({
        where: { variantId: variant.id, grade },
        _sum: { quantity: true },
      });
      before = onHand._sum.quantity ?? 0;
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
      lotId: change.lotId,
      createdById: ctx.user.id,
    },
  });
  if (value.gt(0)) {
    const acc = await ensureControlAccounts(ctx.company.id, tx);
    // Opening stock is brought forward against equity; a count's shortage is an
    // inventory loss and its surplus takes some back.
    const opening = change.type === "OPENING";
    const other = opening ? acc.OPENING_EQUITY : acc.INVENTORY_LOSS;
    const memo = `${variant.sku} × ${Math.abs(quantity)}`;
    const what = opening ? "Opening stock" : `Stock count ${quantity < 0 ? "shortage" : "surplus"}`;
    await postJournalEntry(tx, {
      companyId: ctx.company.id,
      description: `${what} — ${variant.sku} ${quantity > 0 ? "+" : ""}${quantity}${
        change.note ? ` (${change.note})` : ""
      }`,
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
  if (before !== undefined) {
    await receiveAtCostTx(tx, ctx, {
      variant,
      grade,
      onHand: before,
      average,
      quantity,
      unitCost,
      movementId: created.id,
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
  if (input.quantity > 0) assertOnMatrix(variant);
  const warehouse = await resolveWarehouse(ctx, input.warehouseId);

  const movement = await prisma.$transaction(async (tx) => {
    const lots =
      input.type === "OPENING" && input.quantity > 0
        ? await openLots(tx, ctx, {
            variantIds: [variant.id],
            warehouseId: warehouse.id,
            source: "OPENING",
          })
        : undefined;
    const created = await applyAdjustment(tx, ctx, {
      variant,
      warehouse,
      grade: input.grade,
      quantity: input.quantity,
      type: input.type,
      unitCost: input.unitCost,
      note: input.note,
      lotId: lots?.get(variant.id),
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
  const ids = [...new Set(input.lines.map((l) => l.variantId))];
  const variants = await ctx.db.productVariant.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, removedAt: true },
  });
  if (variants.length !== ids.length) {
    throw new AppError("NOT_FOUND", "One or more SKUs were not found.");
  }
  assertOnMatrix(variants.find((v) => v.removedAt));
  const skuOf = new Map(variants.map((v) => [v.id, v.sku]));

  const changes =
    input.mode === "COUNT"
      ? input.lines
          .map((l) => ({ ...l, grade: l.grade ?? input.grade }))
          .filter((l) => l.counted !== l.expected)
          .map((l) => ({
            variantId: l.variantId,
            grade: l.grade,
            quantity: l.counted - l.expected,
            expected: l.expected,
          }))
      : input.lines.map((l) => ({
          variantId: l.variantId,
          grade: input.grade,
          quantity: l.quantity,
          expected: 0,
        }));
  const key = (c: { variantId: string; grade: StockGrade }) => `${c.variantId}:${c.grade}`;
  if (new Set(changes.map(key)).size !== changes.length) {
    throw new AppError("VALIDATION", "Each SKU can appear once in each grade.");
  }
  const added = changes.reduce((sum, c) => sum + Math.max(c.quantity, 0), 0);
  const removed = changes.reduce((sum, c) => sum + Math.max(-c.quantity, 0), 0);
  const summary = { changed: changes.length, added, removed };
  if (changes.length === 0) return summary;
  const grades = [...new Set(changes.map((c) => c.grade))].sort();

  await prisma.$transaction(
    async (tx) => {
      // The SKUs first, as every stock change locks them, then their shelves.
      await lockRows(
        tx,
        "ProductVariant",
        changes.map((c) => c.variantId),
      );
      if (input.mode === "COUNT") {
        const shelves = await tx.$queryRaw<
          Array<{ variantId: string; grade: StockGrade; quantity: number }>
        >`
          SELECT "variantId", grade, quantity FROM "StockBalance"
          WHERE "warehouseId" = ${warehouse.id}
            AND "variantId" IN (${Prisma.join(changes.map((c) => c.variantId))})
          FOR UPDATE`;
        const onShelf = new Map(shelves.map((r) => [key(r), r.quantity]));
        const moved = changes
          .filter((c) => (onShelf.get(key(c)) ?? 0) !== c.expected)
          .map((c) => skuOf.get(c.variantId)!);
        if (moved.length > 0) {
          throw new AppError(
            "CONFLICT",
            `Stock changed while you were counting (${[...new Set(moved)].join(", ")}). Reload the count, check those SKUs again and save.`,
          );
        }
      }
      // Opening stock comes in as one numbered batch per style.
      const lots =
        input.mode === "OPENING"
          ? await openLots(tx, ctx, {
              variantIds: changes.map((c) => c.variantId),
              warehouseId: warehouse.id,
              source: "OPENING",
            })
          : undefined;
      for (const change of changes) {
        await applyAdjustment(tx, ctx, {
          variant: { id: change.variantId, sku: skuOf.get(change.variantId)! },
          warehouse,
          grade: change.grade,
          quantity: change.quantity,
          type: input.mode === "OPENING" ? "OPENING" : "ADJUSTMENT",
          unitCost: input.mode === "OPENING" ? input.unitCost : undefined,
          note: input.note,
          lotId: lots?.get(change.variantId),
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
          summary: `${what} at ${warehouse.name} (${grades.map(gradeLetter).join(" and ")}-grade): ${
            changes.length
          } SKU(s), +${added} / -${removed}${input.note ? ` (${input.note})` : ""}`,
          after: {
            lines: changes.map((c) => ({
              sku: skuOf.get(c.variantId),
              grade: c.grade,
              change: c.quantity,
            })),
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
 * Moves pieces to Damage & QC Rejects (the bad stock): removes them from the
 * sellable stock and books their value (their grade's average cost) to the
 * Inventory Loss account.
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
        description: `Damage & QC reject — ${variant.sku} × ${input.quantity}${input.reason ? ` (${input.reason})` : ""}`,
        sourceType: "BAD_STOCK",
        sourceId: created.id,
        postedById: ctx.user.id,
        lines: [
          { accountId: acc.INVENTORY_LOSS, debit: lossValue, memo },
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
        summary: `Moved ${input.quantity} × ${variant.sku} to Damage & QC Rejects (loss ${lossValue.toFixed(2)})`,
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
    // A voided sales return's lines stay in the books but are no longer rejects.
    voidedAt: null,
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
