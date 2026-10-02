import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
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
    where: { styleId: style.id },
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
 * Creates the SKUs for every chosen color x size that does not exist yet.
 * Existing SKUs are left untouched, so this can be re-run to add a new color or size.
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
      select: { colorId: true, sizeId: true },
    }),
  ]);
  if (colors.length !== new Set(input.colorIds).size) {
    throw new AppError("NOT_FOUND", "One or more colors were not found.");
  }
  if (sizes.length !== new Set(input.sizeIds).size) {
    throw new AppError("NOT_FOUND", "One or more sizes were not found.");
  }

  const have = new Set(existing.map((v) => `${v.colorId}:${v.sizeId}`));
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
  return { created: wanted.length, matrix: await getStyleMatrix(ctx, style.id) };
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
  return updated;
}

/** Finds a SKU by barcode or SKU text (for scanners and quick search). */
export async function lookupVariant(ctx: CompanyContext, code: string) {
  const term = code.trim();
  if (!term) throw new AppError("VALIDATION", "Enter a SKU or barcode.");
  const variant = await ctx.db.productVariant.findFirst({
    where: { OR: [{ barcode: term }, { sku: term.toUpperCase() }] },
    include: {
      style: { select: { id: true, code: true, name: true } },
      color: { select: { name: true, hexCode: true } },
      size: { select: { name: true } },
    },
  });
  if (!variant) throw new AppError("NOT_FOUND", "No SKU matches that code.");
  const stock = (await stockByVariant(ctx, [variant.id])).get(variant.id)!;
  return { ...variant, stock };
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
