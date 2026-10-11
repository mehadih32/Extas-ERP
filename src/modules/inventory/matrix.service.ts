import type { ProductVariant } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRows } from "@/lib/row-lock";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { capToAvailable, fillByPacks, fillByTotal } from "@/modules/inventory/ratio";
import {
  generateMatrixSchema,
  ratioFillSchema,
  ratioPresetSchema,
  updateVariantSchema,
} from "@/modules/inventory/schemas";
import { stockByVariant } from "@/modules/inventory/stock.service";
import { SHIPMENT_OPEN } from "@/modules/sales/rules";

/** "Navy Blue" -> "NAVYBL" — the color part of a SKU. */
export function colorSkuCode(colorName: string): string {
  return (
    colorName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || "CLR"
  );
}

/** EX-PL-001 + Navy + XL -> EX-PL-001-NAVY-XL */
export function buildSku(styleCode: string, colorName: string, sizeName: string): string {
  const size = sizeName.toUpperCase().replace(/[^A-Z0-9]/g, "") || "OS";
  return `${styleCode}-${colorSkuCode(colorName)}-${size}`;
}

type Axis = { id: string; name: string; sortOrder: number };

/** A style's colours and sizes in display order (sort order, then name). */
export function matrixAxes<C extends Axis, S extends Axis>(
  variants: Array<{ color: C; size: S }>,
): { colors: C[]; sizes: S[] } {
  const byOrder = (a: Axis, b: Axis) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  return {
    colors: [...new Map(variants.map((v) => [v.color.id, v.color])).values()].sort(byOrder),
    sizes: [...new Map(variants.map((v) => [v.size.id, v.size])).values()].sort(byOrder),
  };
}

async function getStyleOrThrow(ctx: CompanyContext, styleId: string) {
  const style = await ctx.db.style.findUnique({ where: { id: styleId } });
  if (!style) throw new AppError("NOT_FOUND", "Style not found.");
  return style;
}

/**
 * The wholesale matrix for one style: rows = colors (with hex swatch), columns =
 * sizes in size order, each cell = SKU with live stock and effective prices.
 */
export async function getStyleMatrix(
  ctx: CompanyContext,
  styleId: string,
  options: { warehouseId?: string } = {},
) {
  const style = await getStyleOrThrow(ctx, styleId);
  const variants = await ctx.db.productVariant.findMany({
    where: { styleId: style.id, removedAt: null },
    include: { color: true, size: true },
  });
  const stock = await stockByVariant(
    ctx,
    variants.map((v) => v.id),
    options.warehouseId,
  );
  const threshold = ctx.company.lowStockThreshold;

  const { colors, sizes } = matrixAxes(variants);
  const byCell = new Map(variants.map((v) => [`${v.colorId}:${v.sizeId}`, v]));

  const columnTotals = new Map(sizes.map((s) => [s.id, 0]));
  let grandTotal = 0;
  const rows = colors.map((color) => {
    let rowTotal = 0;
    const cells = sizes.map((size) => {
      const v = byCell.get(`${color.id}:${size.id}`);
      if (!v) return null;
      const s = stock.get(v.id)!;
      if (v.isActive) {
        rowTotal += s.available;
        columnTotals.set(size.id, columnTotals.get(size.id)! + s.available);
      }
      return {
        variantId: v.id,
        sku: v.sku,
        barcode: v.barcode,
        isActive: v.isActive,
        sizeId: size.id,
        ...s,
        lowStock: v.isActive && s.available < threshold,
        retailPrice: (v.retailPrice ?? style.retailPrice).toFixed(2),
        wholesalePrice: (v.wholesalePrice ?? style.wholesalePrice).toFixed(2),
      };
    });
    grandTotal += rowTotal;
    return {
      color: { id: color.id, name: color.name, hexCode: color.hexCode },
      cells,
      total: rowTotal,
    };
  });

  return {
    style: {
      id: style.id,
      code: style.code,
      name: style.name,
      retailPrice: style.retailPrice.toFixed(2),
      wholesalePrice: style.wholesalePrice.toFixed(2),
    },
    sizes: sizes.map((s) => ({ id: s.id, name: s.name, total: columnTotals.get(s.id)! })),
    rows,
    total: grandTotal,
    lowStockThreshold: threshold,
  };
}

/**
 * Creates the SKUs for every chosen color x size that does not exist yet, and
 * brings back any of them taken off the matrix earlier. Other SKUs are left
 * untouched, so this can be re-run to add a new color or size.
 */
export async function generateMatrix(
  ctx: CompanyContext,
  styleId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = generateMatrixSchema.parse(raw);
  const style = await getStyleOrThrow(ctx, styleId);
  const [colors, sizes, existing] = await Promise.all([
    ctx.db.color.findMany({ where: { id: { in: input.colorIds } } }),
    ctx.db.size.findMany({ where: { id: { in: input.sizeIds } } }),
    ctx.db.productVariant.findMany({
      where: { styleId: style.id },
      select: { id: true, sku: true, colorId: true, sizeId: true, removedAt: true },
    }),
  ]);
  if (colors.length !== new Set(input.colorIds).size) {
    throw new AppError("NOT_FOUND", "One or more colors were not found.");
  }
  if (sizes.length !== new Set(input.sizeIds).size) {
    throw new AppError("NOT_FOUND", "One or more sizes were not found.");
  }

  const have = new Set(existing.map((v) => `${v.colorId}:${v.sizeId}`));
  const chosen = (v: { colorId: string; sizeId: string }) =>
    input.colorIds.includes(v.colorId) && input.sizeIds.includes(v.sizeId);
  const back = existing.filter((v) => v.removedAt && chosen(v));
  if (back.length > 0) {
    await ctx.db.productVariant.updateMany({
      where: { id: { in: back.map((v) => v.id) } },
      data: { removedAt: null, isActive: true },
    });
    await auditInCompany(ctx, meta, {
      action: "UPDATE",
      entityType: "Style",
      entityId: style.id,
      summary: `Brought back ${back.length} SKU(s) to ${style.code}`,
      after: { skus: back.map((v) => v.sku) },
    });
  }
  const wanted = colors.flatMap((color) =>
    sizes
      .filter((size) => !have.has(`${color.id}:${size.id}`))
      .map((size) => ({ color, size, sku: buildSku(style.code, color.name, size.name) })),
  );

  if (wanted.length > 0) {
    // Two colors can shorten to the same code ("Navy Blue" / "Navy Blush"): add a suffix.
    const taken = new Set(
      (
        await ctx.db.productVariant.findMany({
          where: { sku: { startsWith: `${style.code}-` } },
          select: { sku: true },
        })
      ).map((v) => v.sku),
    );
    for (const w of wanted) {
      let sku = w.sku;
      for (let i = 2; taken.has(sku); i++) sku = `${w.sku}-${i}`;
      taken.add(sku);
      w.sku = sku;
    }
    await ctx.db.productVariant.createMany({
      data: wanted.map((w) => ({
        companyId: ctx.company.id,
        styleId: style.id,
        colorId: w.color.id,
        sizeId: w.size.id,
        sku: w.sku,
      })),
      skipDuplicates: true,
    });
    await auditInCompany(ctx, meta, {
      action: "CREATE",
      entityType: "Style",
      entityId: style.id,
      summary: `Added ${wanted.length} SKU(s) to ${style.code}`,
      after: { skus: wanted.map((w) => w.sku) },
    });
  }
  return {
    created: wanted.length,
    restored: back.length,
    matrix: await getStyleMatrix(ctx, style.id),
  };
}

/** What keeps a SKU on its matrix: pieces it holds, or a place on open work. */
export type SkuHold = { pieces: number; inUse: boolean };

/**
 * What keeps each SKU on its style's matrix: the pieces it holds (in every
 * warehouse and grade) and whether an open sales order or an unconfirmed
 * delivery from production names it.
 */
async function skuHolds(db: Db, companyId: string, variantIds: string[]) {
  const holds = new Map<string, SkuHold>(variantIds.map((id) => [id, { pieces: 0, inUse: false }]));
  if (variantIds.length === 0) return holds;
  const ids = { in: variantIds };
  const [balances, ordered, delivering] = await Promise.all([
    db.stockBalance.groupBy({
      by: ["variantId"],
      where: { companyId, variantId: ids },
      _sum: { quantity: true },
    }),
    db.salesOrderItem.findMany({
      where: { variantId: ids, order: { companyId, status: { in: [...SHIPMENT_OPEN] } } },
      select: { variantId: true },
      distinct: ["variantId"],
    }),
    db.stockIntakeLine.findMany({
      where: { variantId: ids, intake: { companyId, status: { in: ["DRAFT", "PARSED"] } } },
      select: { variantId: true },
      distinct: ["variantId"],
    }),
  ]);
  for (const b of balances) holds.get(b.variantId)!.pieces = Math.max(0, b._sum.quantity ?? 0);
  for (const line of [...ordered, ...delivering]) holds.get(line.variantId)!.inUse = true;
  return holds;
}

const held = (hold: SkuHold) => hold.pieces > 0 || hold.inUse;

/**
 * The style's colours and sizes that cannot be unticked, with the pieces they
 * hold: one of their SKUs has stock, or is on an open order or delivery.
 */
export type MatrixLocks = { colors: Record<string, SkuHold>; sizes: Record<string, SkuHold> };

export async function matrixLocks(ctx: CompanyContext, styleId: string): Promise<MatrixLocks> {
  const variants = await ctx.db.productVariant.findMany({
    where: { styleId, removedAt: null },
    select: { id: true, colorId: true, sizeId: true },
  });
  const holds = await skuHolds(
    prisma,
    ctx.company.id,
    variants.map((v) => v.id),
  );
  const { colors, sizes }: MatrixLocks = { colors: {}, sizes: {} };
  const add = (into: Record<string, SkuHold>, key: string, hold: SkuHold) => {
    const was = into[key] ?? { pieces: 0, inUse: false };
    into[key] = { pieces: was.pieces + hold.pieces, inUse: was.inUse || hold.inUse };
  };
  for (const v of variants) {
    const hold = holds.get(v.id)!;
    if (!held(hold)) continue;
    add(colors, v.colorId, hold);
    add(sizes, v.sizeId, hold);
  }
  return { colors, sizes };
}

/**
 * Sets a style's colours and sizes in one go: SKUs for newly ticked ones are
 * made (or brought back), and those of unticked ones leave the matrix. A SKU
 * leaves only with no stock anywhere and no open order or delivery; otherwise
 * nothing changes. One with no history is deleted; one with history is taken
 * off the matrix (kept for the reports, not for sale).
 */
export async function setMatrix(
  ctx: CompanyContext,
  styleId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = generateMatrixSchema.parse(raw);
  const style = await getStyleOrThrow(ctx, styleId);
  // Checked before anything leaves, so a bad pick changes nothing.
  const [colors, sizes] = await Promise.all([
    ctx.db.color.count({ where: { id: { in: input.colorIds } } }),
    ctx.db.size.count({ where: { id: { in: input.sizeIds } } }),
  ]);
  if (colors !== new Set(input.colorIds).size || sizes !== new Set(input.sizeIds).size) {
    throw new AppError("NOT_FOUND", "One or more colours or sizes were not found.");
  }
  const leaving = await ctx.db.productVariant.findMany({
    where: {
      styleId: style.id,
      removedAt: null,
      OR: [{ colorId: { notIn: input.colorIds } }, { sizeId: { notIn: input.sizeIds } }],
    },
    select: { id: true, sku: true },
  });
  let removed = 0;
  if (leaving.length > 0) {
    const ids = leaving.map((v) => v.id);
    removed = await prisma.$transaction(async (tx) => {
      // Stock changes lock their SKU first, so none can arrive while this checks.
      await lockRows(tx, "ProductVariant", ids);
      const holds = await skuHolds(tx, ctx.company.id, ids);
      const kept = leaving.filter((v) => held(holds.get(v.id)!));
      if (kept.length > 0) {
        throw new AppError(
          "CONFLICT",
          `${kept.map((v) => v.sku).join(", ")} still ${kept.length === 1 ? "has" : "have"} stock or open orders, so ${kept.length === 1 ? "it stays" : "they stay"} on the matrix.`,
        );
      }
      const used = await tx.productVariant.findMany({
        where: {
          id: { in: ids },
          OR: [
            { stockMovements: { some: {} } },
            { stockBalances: { some: {} } },
            { badStockEntries: { some: {} } },
            { orderItems: { some: {} } },
            { returnItems: { some: {} } },
            { intakeLines: { some: {} } },
            { packingListItems: { some: {} } },
            { challanItems: { some: {} } },
            { productionTargets: { some: {} } },
          ],
        },
        select: { id: true },
      });
      const keep = new Set(used.map((v) => v.id));
      await tx.productVariant.updateMany({
        where: { id: { in: [...keep] } },
        data: { removedAt: new Date(), isActive: false },
      });
      await tx.productVariant.deleteMany({
        where: { id: { in: ids.filter((id) => !keep.has(id)) } },
      });
      return ids.length;
    });
    await auditInCompany(ctx, meta, {
      action: "DELETE",
      entityType: "Style",
      entityId: style.id,
      summary: `Took ${removed} SKU(s) off ${style.code}`,
      before: { skus: leaving.map((v) => v.sku) },
    });
  }
  const result = await generateMatrix(ctx, style.id, input, meta);
  return { created: result.created, restored: result.restored, removed };
}

/**
 * A SKU as the API returns it after a change: its own prices (null when it sells
 * at the style's), never what it cost, which follows the financials rule.
 */
function presentVariant(v: ProductVariant) {
  return {
    id: v.id,
    styleId: v.styleId,
    colorId: v.colorId,
    sizeId: v.sizeId,
    sku: v.sku,
    barcode: v.barcode,
    isActive: v.isActive,
    retailPrice: v.retailPrice?.toFixed(2) ?? null,
    wholesalePrice: v.wholesalePrice?.toFixed(2) ?? null,
  };
}

/** Per-SKU price override, barcode, or deactivating a single cell. */
export async function updateVariant(
  ctx: CompanyContext,
  variantId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateVariantSchema.parse(raw);
  const variant = await ctx.db.productVariant.findUnique({ where: { id: variantId } });
  if (!variant) throw new AppError("NOT_FOUND", "SKU not found.");
  if (input.barcode) {
    const clash = await ctx.db.productVariant.findFirst({
      where: { barcode: input.barcode, id: { not: variant.id } },
      select: { sku: true },
    });
    if (clash) throw new AppError("CONFLICT", `Barcode already used by ${clash.sku}.`);
  }
  const updated = await ctx.db.productVariant.update({ where: { id: variant.id }, data: input });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "ProductVariant",
    entityId: variant.id,
    summary: `Updated SKU ${variant.sku}: ${Object.keys(input).join(", ")}`,
  });
  return presentVariant(updated);
}

/**
 * Finds a SKU by barcode or SKU text (for scanners and quick search), with the
 * prices it sells at (its own or the style's) and its stock in all warehouses.
 */
export async function lookupVariant(ctx: CompanyContext, code: string) {
  const term = code.trim();
  if (!term) throw new AppError("VALIDATION", "Enter a SKU or barcode.");
  const variant = await ctx.db.productVariant.findFirst({
    where: { OR: [{ barcode: term }, { sku: term.toUpperCase() }] },
    include: {
      style: {
        select: { id: true, code: true, name: true, retailPrice: true, wholesalePrice: true },
      },
      color: { select: { name: true, hexCode: true } },
      size: { select: { name: true } },
    },
  });
  if (!variant) throw new AppError("NOT_FOUND", "No SKU matches that code.");
  const stock = (await stockByVariant(ctx, [variant.id])).get(variant.id)!;
  const { style } = variant;
  return {
    ...presentVariant(variant),
    retailPrice: (variant.retailPrice ?? style.retailPrice).toFixed(2),
    wholesalePrice: (variant.wholesalePrice ?? style.wholesalePrice).toFixed(2),
    style: { id: style.id, code: style.code, name: style.name },
    color: variant.color,
    size: variant.size,
    stock,
  };
}

// =============================================================================
// Ratio presets & Ratio Fill
// =============================================================================

const presetInclude = {
  entries: {
    include: { size: { select: { id: true, name: true, sortOrder: true } } },
    orderBy: { size: { sortOrder: "asc" } },
  },
} as const;

export async function listRatioPresets(ctx: CompanyContext) {
  return ctx.db.sizeRatioPreset.findMany({ include: presetInclude, orderBy: { name: "asc" } });
}

async function assertSizes(ctx: CompanyContext, sizeIds: string[]) {
  const found = await ctx.db.size.count({ where: { id: { in: sizeIds } } });
  if (found !== sizeIds.length)
    throw new AppError("NOT_FOUND", "One or more sizes were not found.");
}

export async function createRatioPreset(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = ratioPresetSchema.parse(raw);
  await assertSizes(
    ctx,
    input.entries.map((e) => e.sizeId),
  );
  const preset = await ctx.db.sizeRatioPreset.create({
    data: {
      companyId: ctx.company.id,
      name: input.name,
      entries: { create: input.entries },
    },
    include: presetInclude,
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "SizeRatioPreset",
    entityId: preset.id,
    summary: `Created ratio preset "${preset.name}"`,
  });
  return preset;
}

export async function updateRatioPreset(
  ctx: CompanyContext,
  presetId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = ratioPresetSchema.partial().parse(raw);
  const preset = await ctx.db.sizeRatioPreset.findUnique({ where: { id: presetId } });
  if (!preset) throw new AppError("NOT_FOUND", "Ratio preset not found.");
  if (input.entries) {
    await assertSizes(
      ctx,
      input.entries.map((e) => e.sizeId),
    );
  }
  const updated = await ctx.db.sizeRatioPreset.update({
    where: { id: preset.id },
    data: {
      name: input.name,
      ...(input.entries ? { entries: { deleteMany: {}, create: input.entries } } : {}),
    },
    include: presetInclude,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "SizeRatioPreset",
    entityId: preset.id,
    summary: `Updated ratio preset "${updated.name}"`,
  });
  return updated;
}

export async function deleteRatioPreset(ctx: CompanyContext, presetId: string, meta?: RequestMeta) {
  const preset = await ctx.db.sizeRatioPreset.findUnique({ where: { id: presetId } });
  if (!preset) throw new AppError("NOT_FOUND", "Ratio preset not found.");
  await ctx.db.sizeRatioPreset.delete({ where: { id: preset.id } });
  await auditInCompany(ctx, meta, {
    action: "DELETE",
    entityType: "SizeRatioPreset",
    entityId: preset.id,
    summary: `Deleted ratio preset "${preset.name}"`,
  });
}

/**
 * "Ratio Fill" shortcut: computes order quantities for each chosen color across the
 * style's sizes, by packs or by total pieces, optionally capped to available stock.
 * Returns the suggested grid only; nothing is saved.
 */
export async function ratioFill(ctx: CompanyContext, raw: unknown) {
  const input = ratioFillSchema.parse(raw);
  let entries = input.entries;
  if (input.presetId) {
    const preset = await ctx.db.sizeRatioPreset.findUnique({
      where: { id: input.presetId },
      include: { entries: true },
    });
    if (!preset) throw new AppError("NOT_FOUND", "Ratio preset not found.");
    entries = preset.entries.map((e) => ({ sizeId: e.sizeId, ratio: e.ratio }));
  }
  const matrix = await getStyleMatrix(ctx, input.styleId, { warehouseId: input.warehouseId });
  const quantities = input.packs
    ? fillByPacks(entries!, input.packs)
    : fillByTotal(entries!, input.totalPerColor!);

  const rows = input.colorIds.map((colorId) => {
    const row = matrix.rows.find((r) => r.color.id === colorId);
    if (!row) throw new AppError("NOT_FOUND", "That color is not part of this style.");
    const cells = row.cells
      .filter((cell): cell is NonNullable<typeof cell> => cell !== null && cell.isActive)
      .filter((cell) => quantities.has(cell.sizeId))
      .map((cell) => {
        const requested = quantities.get(cell.sizeId)!;
        const quantity = input.capToAvailable
          ? capToAvailable(requested, cell.available)
          : requested;
        return {
          variantId: cell.variantId,
          sku: cell.sku,
          sizeId: cell.sizeId,
          requested,
          quantity,
          available: cell.available,
          shortBy: Math.max(0, requested - cell.available),
        };
      });
    return {
      color: row.color,
      cells,
      total: cells.reduce((sum, c) => sum + c.quantity, 0),
    };
  });
  return {
    styleId: input.styleId,
    rows,
    total: rows.reduce((sum, r) => sum + r.total, 0),
    hasShortage: rows.some((r) => r.cells.some((c) => c.shortBy > 0)),
  };
}
