import {
  type MeasurementUnit,
  type Prisma,
  type RawMaterial,
  type RawMaterialMovementType,
} from "@prisma/client";

import { toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { lockRows } from "@/lib/row-lock";
import type { CompanyContext } from "@/modules/auth/context";
import { getDefaultWarehouse } from "@/modules/inventory/stock.service";
import {
  averageCost,
  costPerUnit,
  formatQuantity,
  type Holding,
  money,
  removeAtValue,
  unitProblem,
  valueOut,
  ZERO,
} from "@/modules/materials/valuation";

/*
 * Every change to a raw material's stock goes through stockIn / stockOut, inside
 * a transaction that has locked the material first (lockMaterials). Each call
 * changes the store's quantity, the material's quantity and value, and writes
 * one line on the stock card. The caller posts the journal entry for the value.
 */

type Tx = Prisma.TransactionClient;

/** The locked materials, kept up to date as the transaction changes them. */
export type MaterialState = Map<string, RawMaterial>;

/** Locks the materials until the transaction ends and reads them fresh. */
export async function lockMaterials(
  tx: Tx,
  companyId: string,
  ids: string[],
): Promise<MaterialState> {
  const unique = [...new Set(ids)];
  await lockRows(tx, "RawMaterial", unique);
  const rows = await tx.rawMaterial.findMany({ where: { id: { in: unique }, companyId } });
  if (rows.length !== unique.length) throw new AppError("NOT_FOUND", "Raw material not found.");
  return new Map(rows.map((r) => [r.id, r]));
}

export const holdingOf = (m: RawMaterial): Holding => ({
  quantity: m.quantity,
  value: m.stockValue,
});

/** "FAB-0001 Single Jersey 180 GSM" */
export const materialLabel = (m: { code: string; name: string }) => `${m.code} ${m.name}`;

/** "FAB-0001 × 120.5 m", for journal memos. */
export const lineMemo = (
  m: { code: string; unit: MeasurementUnit },
  quantity: Prisma.Decimal.Value,
) => `${m.code} × ${formatQuantity(quantity, m.unit)}`;

/** Refuses fractions of whole units (half a cone, 2.5 pieces). */
export function assertUnitFits(
  m: { code: string; unit: MeasurementUnit },
  quantity: Prisma.Decimal,
  field = "quantity",
) {
  const problem = unitProblem(m.unit, quantity);
  if (problem) {
    throw new AppError("VALIDATION", `${m.code}: ${problem}`, { [field]: [problem] });
  }
}

/** The store to use: the one given, or the company's main store. */
export async function resolveStore(ctx: CompanyContext, warehouseId?: string | null) {
  if (!warehouseId) return getDefaultWarehouse(ctx);
  const warehouse = await ctx.db.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new AppError("NOT_FOUND", "Store (warehouse) not found.");
  return warehouse;
}

/** Materials named on a document, checked to exist and not be archived. */
export async function loadActiveMaterials(ctx: CompanyContext, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await ctx.db.rawMaterial.findMany({ where: { id: { in: unique } } });
  if (rows.length !== unique.length) throw new AppError("NOT_FOUND", "Raw material not found.");
  const archived = rows.find((m) => !m.isActive);
  if (archived) {
    throw new AppError(
      "VALIDATION",
      `${materialLabel(archived)} is archived; make it active first.`,
    );
  }
  return new Map(rows.map((m) => [m.id, m]));
}

/** A document date: a calendar day in company time, a timestamp, or now. */
export function documentDate(ctx: CompanyContext, value?: Date | string) {
  return value ? toInstant(value, ctx.company.timezone) : new Date();
}

export type MovementLinks = {
  productionProjectId?: string | null;
  supplierBillId?: string | null;
  issueId?: string | null;
  purchaseReturnId?: string | null;
  transferId?: string | null;
  journalEntryId?: string | null;
};

export type MoveArgs = {
  companyId: string;
  createdById: string;
  materialId: string;
  warehouseId: string;
  type: RawMaterialMovementType;
  /** How much moves (always more than zero). */
  quantity: Prisma.Decimal;
  date: Date;
  note?: string | null;
  links?: MovementLinks;
};

function lockedMaterial(state: MaterialState, materialId: string) {
  const m = state.get(materialId);
  if (!m) throw new AppError("INTERNAL", "Lock a raw material before changing its stock.");
  return m;
}

async function saveMaterial(
  tx: Tx,
  state: MaterialState,
  m: RawMaterial,
  quantity: Prisma.Decimal,
  value: Prisma.Decimal,
) {
  const updated = await tx.rawMaterial.update({
    where: { id: m.id },
    data: { quantity, stockValue: value, avgCost: averageCost({ quantity, value }, m.avgCost) },
  });
  state.set(m.id, updated);
  return updated;
}

/** Writes one line on the stock card (quantity and value signed: + in, - out). */
export async function writeMovement(
  tx: Tx,
  args: MoveArgs,
  signed: { quantity: Prisma.Decimal; value: Prisma.Decimal; unitCost: Prisma.Decimal },
) {
  return tx.rawMaterialMovement.create({
    data: {
      companyId: args.companyId,
      rawMaterialId: args.materialId,
      warehouseId: args.warehouseId,
      type: args.type,
      date: args.date,
      quantity: signed.quantity,
      unitCost: signed.unitCost,
      value: signed.value,
      productionProjectId: args.links?.productionProjectId ?? null,
      supplierBillId: args.links?.supplierBillId ?? null,
      issueId: args.links?.issueId ?? null,
      purchaseReturnId: args.links?.purchaseReturnId ?? null,
      transferId: args.links?.transferId ?? null,
      journalEntryId: args.links?.journalEntryId ?? null,
      note: args.note ?? null,
      createdById: args.createdById,
    },
  });
}

/** Adds to one store's quantity. */
export async function putIntoStore(
  tx: Tx,
  companyId: string,
  materialId: string,
  warehouseId: string,
  quantity: Prisma.Decimal,
) {
  await tx.rawMaterialStock.upsert({
    where: { rawMaterialId_warehouseId: { rawMaterialId: materialId, warehouseId } },
    create: { companyId, rawMaterialId: materialId, warehouseId, quantity },
    update: { quantity: { increment: quantity } },
  });
}

/** Takes from one store's quantity; refuses to go below zero. */
export async function takeFromStore(
  tx: Tx,
  m: RawMaterial,
  warehouseId: string,
  quantity: Prisma.Decimal,
) {
  const { count } = await tx.rawMaterialStock.updateMany({
    where: { rawMaterialId: m.id, warehouseId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (count === 0) throw await notEnough(tx, m, warehouseId, quantity);
}

async function notEnough(tx: Tx, m: RawMaterial, warehouseId: string, wanted: Prisma.Decimal) {
  const stock = await tx.rawMaterialStock.findUnique({
    where: { rawMaterialId_warehouseId: { rawMaterialId: m.id, warehouseId } },
    select: { quantity: true },
  });
  const store = await tx.warehouse.findUnique({ where: { id: warehouseId } });
  return new AppError(
    "CONFLICT",
    `Not enough ${materialLabel(m)} in ${store?.name ?? "the store"}: ${formatQuantity(
      stock?.quantity ?? 0,
      m.unit,
    )} in stock, ${formatQuantity(wanted, m.unit)} needed.`,
  );
}

/** Goods into a store, adding `value` to the material's value. */
export async function stockIn(
  tx: Tx,
  state: MaterialState,
  args: MoveArgs & { value: Prisma.Decimal },
) {
  const m = lockedMaterial(state, args.materialId);
  const value = money(args.value);
  if (args.quantity.lte(0) || value.isNegative()) {
    throw new AppError("INTERNAL", "Stock comes in as a positive quantity and value.");
  }
  // Checked under the lock, so archiving and stock coming in never cross.
  if (!m.isActive) {
    throw new AppError(
      "CONFLICT",
      `${materialLabel(m)} is archived; make it active again before stock comes in.`,
    );
  }
  await putIntoStore(tx, args.companyId, m.id, args.warehouseId, args.quantity);
  const updated = await saveMaterial(
    tx,
    state,
    m,
    m.quantity.plus(args.quantity),
    m.stockValue.plus(value),
  );
  const movement = await writeMovement(tx, args, {
    quantity: args.quantity,
    value,
    unitCost: costPerUnit(value, args.quantity, updated.avgCost),
  });
  return { movement, value };
}

/**
 * Goods out of a store. Their value leaves at the material's average cost, or
 * at `atValue` for goods going back on a bill (its price): then `difference`
 * is the bill price less the value that left, for the caller to post as a
 * cost difference.
 */
export async function stockOut(
  tx: Tx,
  state: MaterialState,
  args: MoveArgs & { atValue?: Prisma.Decimal },
) {
  const m = lockedMaterial(state, args.materialId);
  if (args.quantity.lte(0))
    throw new AppError("INTERNAL", "Stock goes out as a positive quantity.");
  await takeFromStore(tx, m, args.warehouseId, args.quantity);
  const holding = holdingOf(m);
  if (args.quantity.gt(holding.quantity))
    throw await notEnough(tx, m, args.warehouseId, args.quantity);
  let value = ZERO;
  let difference = ZERO;
  if (args.atValue === undefined) {
    value = valueOut(holding, args.quantity);
  } else {
    const removal = removeAtValue(holding, args.quantity, money(args.atValue));
    value = removal.removed;
    difference = removal.difference;
  }
  await saveMaterial(
    tx,
    state,
    m,
    holding.quantity.minus(args.quantity),
    holding.value.minus(value),
  );
  const movement = await writeMovement(tx, args, {
    quantity: args.quantity.neg(),
    value: value.neg(),
    unitCost: costPerUnit(value, args.quantity, m.avgCost),
  });
  return { movement, value, difference };
}

/** Links the stock card lines written for a document to its journal entry. */
export async function linkMovementsToEntry(
  tx: Tx,
  movementIds: string[],
  journalEntryId: string | null,
) {
  if (!journalEntryId || movementIds.length === 0) return;
  await tx.rawMaterialMovement.updateMany({
    where: { id: { in: movementIds } },
    data: { journalEntryId },
  });
}

/** "FAB-0001 × 120 m, TRM-0003 × 500 pcs and 4 more", for audit summaries. */
export function describeLines(
  lines: Array<{ material: { code: string; unit: MeasurementUnit }; quantity: Prisma.Decimal }>,
  limit = 5,
) {
  const shown = lines.slice(0, limit).map((l) => lineMemo(l.material, l.quantity));
  const more = lines.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}
