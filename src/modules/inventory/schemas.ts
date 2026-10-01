import { StockGrade } from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";

const id = z.string().min(1);
const name = z.string().trim().min(1, "Required").max(120);
const money = z.number().min(0).max(1_000_000_000).multipleOf(0.01);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0B3D2E")
  .transform((v) => v.toUpperCase());

// --- Categories ----------------------------------------------------------------
export const createCategorySchema = z.object({
  name,
  parentId: id.nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export const updateCategorySchema = createCategorySchema.partial();

// --- Brands ---------------------------------------------------------------------
export const createBrandSchema = z.object({ name, logoUrl: optionalText(500) });
export const updateBrandSchema = createBrandSchema.partial();

// --- Colors & sizes -----------------------------------------------------------
export const createColorSchema = z.object({
  name: z.string().trim().min(1).max(40),
  hexCode: hexColorSchema,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export const updateColorSchema = createColorSchema.partial();

export const createSizeSchema = z.object({
  name: z.string().trim().min(1).max(20),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export const updateSizeSchema = createSizeSchema.partial();
export const reorderSizesSchema = z.object({ sizeIds: z.array(id).min(1).max(100) });

// --- Styles ---------------------------------------------------------------------
export const createStyleSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/, "Use letters, numbers and dashes (e.g. EX-PL-001)"),
  name,
  categoryId: id,
  brandId: id.nullish(),
  description: optionalText(2000),
  fabric: optionalText(200),
  imageUrl: optionalText(500),
  retailPrice: money.default(0),
  wholesalePrice: money.default(0),
});
export const updateStyleSchema = createStyleSchema
  .omit({ retailPrice: true, wholesalePrice: true })
  .partial()
  .extend({
    retailPrice: money.optional(),
    wholesalePrice: money.optional(),
    isActive: z.boolean().optional(),
  });

export const listStylesSchema = z.object({
  categoryId: id.optional(), // includes sub-categories
  brandId: id.optional(),
  search: z.string().trim().max(100).optional(),
  includeInactive: queryBoolean.optional(),
  cursor: id.optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

// --- Matrix & variants -----------------------------------------------------------
export const generateMatrixSchema = z.object({
  colorIds: z.array(id).min(1).max(50),
  sizeIds: z.array(id).min(1).max(30),
});

export const updateVariantSchema = z.object({
  barcode: z.string().trim().max(64).nullish(),
  retailPrice: money.nullish(),
  wholesalePrice: money.nullish(),
  isActive: z.boolean().optional(),
});

// --- Ratio fill -------------------------------------------------------------------
export const ratioEntriesSchema = z
  .array(z.object({ sizeId: id, ratio: z.number().int().min(0).max(1000) }))
  .min(1)
  .max(30)
  .refine((rows) => new Set(rows.map((r) => r.sizeId)).size === rows.length, {
    message: "Each size can appear once",
  })
  .refine((rows) => rows.some((r) => r.ratio > 0), {
    message: "At least one ratio must be above 0",
  });

export const ratioPresetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  entries: ratioEntriesSchema,
});

export const ratioFillSchema = z
  .object({
    styleId: id,
    colorIds: z.array(id).min(1).max(50),
    presetId: id.optional(),
    entries: ratioEntriesSchema.optional(),
    /** Fill by number of ratio packs (e.g. 10 packs of S1 M2 L2 XL1)… */
    packs: z.number().int().min(1).max(100_000).optional(),
    /** …or by total pieces per color, split by ratio. */
    totalPerColor: z.number().int().min(1).max(1_000_000).optional(),
    capToAvailable: z.boolean().default(false),
    warehouseId: id.optional(),
  })
  .refine((v) => Boolean(v.presetId) !== Boolean(v.entries), {
    message: "Give either presetId or entries",
  })
  .refine((v) => Boolean(v.packs) !== Boolean(v.totalPerColor), {
    message: "Give either packs or totalPerColor",
  });

// --- Stock ------------------------------------------------------------------------
export const createWarehouseSchema = z.object({
  name,
  address: optionalText(300),
  isDefault: z.boolean().optional(),
});

export const adjustStockSchema = z.object({
  variantId: id,
  warehouseId: id.optional(), // default warehouse when omitted
  grade: z.enum(StockGrade).default("A_GRADE"),
  /** Positive adds stock, negative removes it. */
  quantity: z
    .number()
    .int()
    .refine((q) => q !== 0, "Quantity cannot be 0")
    .refine((q) => Math.abs(q) <= 1_000_000, "Quantity too large"),
  type: z.enum(["OPENING", "ADJUSTMENT"]).default("ADJUSTMENT"),
  unitCost: z.number().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(500).optional(),
});

export const badStockSchema = z.object({
  variantId: id,
  warehouseId: id.optional(),
  grade: z.enum(StockGrade).default("A_GRADE"),
  quantity: z.number().int().min(1).max(1_000_000),
  source: z.enum(["WAREHOUSE_DAMAGE", "PRODUCTION_REJECT", "MANUAL"]).default("MANUAL"),
  reason: z.string().trim().max(500).optional(),
});

export const movementsQuerySchema = z.object({
  variantId: id.optional(),
  styleId: id.optional(),
  warehouseId: id.optional(),
  cursor: id.optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});
