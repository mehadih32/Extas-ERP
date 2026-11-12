import { Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { aiReady } from "@/modules/ai/claude";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { createColor, createSize } from "@/modules/inventory/catalog.service";
import { generateMatrix } from "@/modules/inventory/matrix.service";
import {
  applySavedLayout,
  canonicalSize,
  detectLayout,
  type PackingLayout,
  readBlocks,
  type Sheet,
} from "@/modules/inventory/packing-list/layout";
import { nameKey, type PaperBlock, renderPaperText } from "@/modules/inventory/packing-list/paper";
import { type FileRead, readPackingFile } from "@/modules/inventory/packing-list/readers";
import { listCategoryOptions } from "@/modules/inventory/screens.service";
import { listWarehouses, recordStockCount } from "@/modules/inventory/stock.service";
import { createStyle } from "@/modules/inventory/style.service";
import {
  AI_READING_OFF,
  type IntakeParser,
  intakeParserFor,
  type ParsedLine,
} from "@/modules/production/ai-intake";

/*
 * "Upload packing list" on a style's stock page (2026-11-12), without AI:
 *   1. Read: the file is read on our own server (Excel, CSV, PDF text, or a
 *      photo by OCR) and shown as "type it like the paper" text with a grid.
 *   2. Review: the person corrects the text or the grid beside the photo, picks
 *      or creates the style, and matches the colours and sizes.
 *   3. Save, through a flow that already exists: a production delivery (a draft
 *      the person confirms there), Buy ready stock (its form, filled in), or
 *      opening stock (the stock path Products' own count uses).
 * Each factory's or supplier's columns and colour spellings are remembered.
 * Everything here needs inventory.manage, as adding stock on that page does.
 */

function assertCanAddStock(ctx: CompanyContext) {
  if (!ctx.can("inventory.manage")) {
    throw new AppError("FORBIDDEN", "You do not have permission to add stock.");
  }
}

const sourceKey = (name: string) => nameKey(name).slice(0, 80);

/** How many rows and columns of a file go to the review screen for picking columns. */
const TABLE_ROWS = 300;
const TABLE_COLS = 40;

const id = z.string().trim().min(1).max(64);

// =============================================================================
// Setup
// =============================================================================

/** What the upload window needs: styles, colours, sizes, categories, places and switches. */
export async function getPackingListSetup(ctx: CompanyContext) {
  assertCanAddStock(ctx);
  const [styles, colours, sizes, categories, warehouses, sources, ai] = await Promise.all([
    ctx.db.style.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
      take: 5000,
    }),
    ctx.db.color.findMany({
      select: { id: true, name: true, hexCode: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    ctx.db.size.findMany({
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    listCategoryOptions(ctx),
    listWarehouses(ctx),
    ctx.db.packingListSource.findMany({
      select: { name: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    aiReady(ctx.company.id),
  ]);
  return {
    styles,
    colours,
    sizes,
    categories: categories.map((c) => ({ id: c.id, label: c.path.join(" / ") })),
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault })),
    sources: sources.map((s) => s.name),
    /** Whether "Read with AI" works now, and why not when it does not. */
    ai: ai.on ? { on: true as const } : { on: false as const, why: AI_READING_OFF },
    can: {
      /** Into a production project's delivery (Move to Stock). */
      deliver: ctx.can("production.stock_intake"),
      /** Into the Buy ready stock form. */
      buy: ctx.can("retail.purchases"),
    },
  };
}

export type PackingListSetup = Awaited<ReturnType<typeof getPackingListSetup>>;

// =============================================================================
// Reading
// =============================================================================

const readSchema = z.object({
  /** The factory or supplier it came from, to use and remember its layout. */
  source: z.string().trim().max(120).optional(),
});

async function findSource(ctx: CompanyContext, name: string | undefined) {
  const key = name ? sourceKey(name) : "";
  if (!key) return null;
  return ctx.db.packingListSource.findUnique({
    where: { companyId_key: { companyId: ctx.company.id, key } },
  });
}

function sourceColours(value: Prisma.JsonValue | undefined): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

const savedLayoutSchema = z.object({
  kind: z.enum(["GRID", "LIST"]),
  style: z.string().max(120).nullable(),
  colour: z.string().max(120).nullable(),
  size: z.string().max(120).nullable(),
  pieces: z.string().max(120).nullable(),
  sizeHeaders: z.array(z.string().max(60)).max(60),
});

/** A table trimmed for the screen (where the person can pick other columns). */
const forScreen = (sheet: Sheet): Sheet => ({
  ...sheet,
  rows: sheet.rows.slice(0, TABLE_ROWS).map((r) =>
    r.slice(0, TABLE_COLS).map((c) => ({
      text: c.text.slice(0, 80),
      ...(c.confidence !== undefined ? { confidence: Math.round(c.confidence) } : {}),
    })),
  ),
});

/**
 * Reads an uploaded packing list without AI. Returns the text to review (each
 * style a block, a "?" after numbers to check), the table and the columns
 * found (remembered for this source, or found now), and notes.
 */
export async function readPackingList(
  ctx: CompanyContext,
  file: { bytes: Uint8Array; fileName: string },
  raw: unknown = {},
  /** Tests pass a read file; otherwise it is read from the bytes. */
  given?: FileRead,
) {
  assertCanAddStock(ctx);
  const input = readSchema.parse(raw);
  const [source, sizes] = await Promise.all([
    findSource(ctx, input.source),
    ctx.db.size.findMany({ select: { name: true } }),
  ]);
  const known = sizes.map((s) => s.name);
  const read = given ?? (await readPackingFile(file));
  const saved = savedLayoutSchema.safeParse(source?.layout);

  // The first sheet whose columns are found (by the remembered names first).
  let chosen: {
    sheet: Sheet;
    index: number;
    layout: PackingLayout | null;
    from: "SAVED" | "FOUND" | null;
    blocks: PaperBlock[];
  } | null = null;
  for (const [index, sheet] of read.sheets.entries()) {
    const remembered = saved.success ? applySavedLayout(sheet, saved.data) : null;
    const layout = remembered ?? detectLayout(sheet, known);
    const blocks = layout ? readBlocks(sheet, layout) : [];
    const here = {
      sheet,
      index,
      layout,
      from: remembered ? ("SAVED" as const) : layout ? ("FOUND" as const) : null,
      blocks,
    };
    if (blocks.length > 0) {
      chosen = here;
      break;
    }
    chosen ??= here;
  }
  if (!chosen) throw new AppError("VALIDATION", "Nothing could be read from this file.");

  const notes = [...chosen.sheet.notes];
  if (read.sheets.length > 1) {
    notes.push(
      `The workbook has ${read.sheets.length} sheets; sheet ${chosen.index + 1} was read.`,
    );
  }
  // A photo whose table was not found: its lines as text, for the person to correct.
  const fromTable = chosen.blocks.length > 0;
  const text = fromTable ? renderPaperText(chosen.blocks) : (read.photoText ?? "");
  if (!fromTable && chosen.sheet.kind !== "PHOTO") {
    notes.push("No colour and size columns were found. Pick them below, or type the lines.");
  }
  return {
    fileName: file.fileName.slice(0, 200),
    kind: chosen.sheet.kind,
    /** The table, for picking other columns (not for a photo read as lines). */
    table: chosen.sheet.kind === "PHOTO" && !fromTable ? null : forScreen(chosen.sheet),
    layout: chosen.layout,
    layoutFrom: chosen.from,
    text,
    notes,
    source: source ? { name: source.name, colours: sourceColours(source.colours) } : null,
  };
}

export type PackingListRead = Awaited<ReturnType<typeof readPackingList>>;

/** AI's lines as style blocks: one per style code, the sizes in the order first read. */
export function blocksFromAi(lines: ParsedLine[]): { blocks: PaperBlock[]; bGrade: number } {
  const blocks = new Map<string, PaperBlock>();
  let bGrade = 0;
  for (const line of lines) {
    if (line.grade === "B_GRADE") {
      bGrade += line.quantity;
      continue;
    }
    const key = line.styleCode ? nameKey(line.styleCode) : "";
    let block = blocks.get(key);
    if (!block) {
      block = { title: line.styleCode, sizes: [], rows: [], writtenTotal: null };
      blocks.set(key, block);
    }
    const size = line.size ?? "?";
    let at = block.sizes.findIndex((s) => canonicalSize(s) === canonicalSize(size));
    if (at < 0) at = block.sizes.push(size) - 1;
    const colour = line.color ?? "?";
    let row = block.rows.find((r) => r.colour.toUpperCase() === colour.toUpperCase());
    if (!row) {
      row = { colour, cells: [], writtenTotal: null, line: block.rows.length + 1 };
      block.rows.push(row);
    }
    while (row.cells.length <= at) row.cells.push({ pieces: null, unsure: null });
    row.cells[at] = { pieces: (row.cells[at]!.pieces ?? 0) + line.quantity, unsure: null };
  }
  return { blocks: [...blocks.values()], bGrade };
}

/**
 * The second way in, only while the owner has AI on: the existing AI reader
 * reads the photo (handwriting too). Its result is checked the same way.
 */
export async function readPackingListWithAi(
  ctx: CompanyContext,
  file: { bytes: Uint8Array; fileName: string; mimeType: string },
  given?: IntakeParser | null,
) {
  assertCanAddStock(ctx);
  const parser = given === undefined ? await intakeParserFor(ctx.company.id, ctx.user.id) : given;
  if (!parser) {
    throw new AppError("UNAVAILABLE", `${AI_READING_OFF} Read it without AI instead.`);
  }
  const [styles, colours, sizes] = await Promise.all([
    ctx.db.style.findMany({ where: { isActive: true }, select: { code: true }, take: 200 }),
    ctx.db.color.findMany({ select: { name: true } }),
    ctx.db.size.findMany({ select: { name: true } }),
  ]);
  const parsed = await parser.parse(
    { bytes: Buffer.from(file.bytes), mimeType: file.mimeType, fileName: file.fileName },
    {
      projectStyle: null,
      styleCodes: styles.map((s) => s.code),
      colors: colours.map((c) => c.name),
      sizes: sizes.map((s) => s.name),
    },
  );
  const { blocks, bGrade } = blocksFromAi(parsed.lines);
  const notes = [
    "Read with AI. Check every line against the paper before saving.",
    parsed.notes ? `The AI says: ${parsed.notes}` : null,
    bGrade > 0 ? `${bGrade} B-grade pieces were left out: add them with Bulk update.` : null,
  ].filter((n): n is string => n !== null);
  return { text: renderPaperText(blocks), notes };
}

// =============================================================================
// Remembering a source
// =============================================================================

const rememberSchema = z.object({
  source: z.string().trim().min(1, "Write who sent the list").max(120),
  layout: savedLayoutSchema.nullish(),
  /** Written colour name -> the catalog colour it was matched to. */
  colours: z.record(z.string().max(80), id).optional(),
});

/** Keeps a factory's or supplier's columns and colour spellings for its next list. */
export async function rememberPackingSource(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanAddStock(ctx);
  const input = rememberSchema.parse(raw);
  const key = sourceKey(input.source);
  if (!key) throw new AppError("VALIDATION", "Write who sent the list.");
  const colourIds = [...new Set(Object.values(input.colours ?? {}))];
  const known = await ctx.db.color.findMany({
    where: { id: { in: colourIds } },
    select: { id: true },
  });
  const ok = new Set(known.map((c) => c.id));
  const colours = Object.fromEntries(
    Object.entries(input.colours ?? {})
      .filter(([written, colourId]) => nameKey(written) && ok.has(colourId))
      .map(([written, colourId]) => [nameKey(written), colourId]),
  );
  const existing = await findSource(ctx, input.source);
  const merged = { ...sourceColours(existing?.colours), ...colours };
  const layout = input.layout === undefined ? undefined : (input.layout ?? Prisma.DbNull);
  const saved = existing
    ? await ctx.db.packingListSource.update({
        where: { id: existing.id },
        data: {
          name: input.source,
          colours: merged,
          ...(layout !== undefined ? { layout } : {}),
          uses: { increment: 1 },
          updatedById: ctx.user.id,
        },
      })
    : await ctx.db.packingListSource.create({
        data: {
          companyId: ctx.company.id,
          name: input.source,
          key,
          colours: merged,
          layout: layout ?? Prisma.DbNull,
          uses: 1,
          updatedById: ctx.user.id,
        },
      });
  await auditInCompany(ctx, meta, {
    action: existing ? "UPDATE" : "CREATE",
    entityType: "PackingListSource",
    entityId: saved.id,
    summary: `Packing list layout remembered for ${input.source}`,
  });
  return { name: saved.name };
}

// =============================================================================
// The style, its colours and sizes
// =============================================================================

/** A colour for a new colour name: common garment colours, else a neutral grey. */
const HEX: Record<string, string> = {
  BLACK: "#111111",
  WHITE: "#FFFFFF",
  NAVY: "#1F2A44",
  GREY: "#8A8D91",
  GRAY: "#8A8D91",
  RED: "#C0392B",
  BLUE: "#2E5EAA",
  GREEN: "#2E7D32",
  BROWN: "#6D4C41",
  KHAKI: "#BDB76B",
  MAROON: "#7B1E2B",
  ORANGE: "#E67E22",
  YELLOW: "#F1C40F",
  PINK: "#E91E63",
  PURPLE: "#6A1B9A",
  BEIGE: "#D8C3A5",
  OLIVE: "#6B7B3A",
  ANTHRACITE: "#383E42",
  COFFEE: "#6F4E37",
  BRICK: "#A0412D",
  CREAM: "#F3E5C0",
  SKY: "#87CEEB",
  MINT: "#98D7C2",
  CHARCOAL: "#36454F",
};
const hexFor = (name: string) =>
  Object.entries(HEX).find(([word]) => nameKey(name).includes(word))?.[1] ?? "#9CA3AF";

const prepareSchema = z.object({
  style: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("PICK"), styleId: id }),
    z.object({
      mode: z.literal("NEW"),
      code: z.string().trim().max(40),
      name: z.string().trim().max(120),
      categoryId: id,
    }),
  ]),
  /** The colours the list needs: a catalog colour, or a new one by name. */
  colours: z
    .array(z.object({ colorId: id.optional(), name: z.string().trim().min(1).max(40) }))
    .min(1, "The list has no colours")
    .max(50),
  sizes: z
    .array(z.object({ sizeId: id.optional(), name: z.string().trim().min(1).max(20) }))
    .min(1, "The list has no sizes")
    .max(30),
});

/**
 * Makes the style ready for the list, in the upload window: a new style (with
 * the code, name and category the person gave) or an existing one, with every
 * colour and size the list needs on its matrix. New colours and sizes join
 * the catalog first; a name already there is used, never made twice.
 */
export async function preparePackingStyle(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanAddStock(ctx);
  const input = prepareSchema.parse(raw);
  const styleId =
    input.style.mode === "PICK"
      ? (await ctx.db.style.findUnique({ where: { id: input.style.styleId } }))?.id
      : (
          await createStyle(
            ctx,
            { code: input.style.code, name: input.style.name, categoryId: input.style.categoryId },
            meta,
          )
        ).id;
  if (!styleId) throw new AppError("NOT_FOUND", "Style not found.");

  const [colours, sizes] = await Promise.all([
    ctx.db.color.findMany({ select: { id: true, name: true } }),
    ctx.db.size.findMany({ select: { id: true, name: true } }),
  ]);
  const colourIds: Record<string, string> = {};
  for (const c of input.colours) {
    const found =
      (c.colorId && colours.find((x) => x.id === c.colorId)) ||
      colours.find((x) => nameKey(x.name) === nameKey(c.name));
    if (c.colorId && !found) throw new AppError("NOT_FOUND", "One of the colours was not found.");
    const colour =
      found ?? (await createColor(ctx, { name: c.name, hexCode: hexFor(c.name) }, meta));
    colours.push(colour);
    colourIds[c.name] = colour.id;
  }
  const sizeIds: Record<string, string> = {};
  for (const s of input.sizes) {
    const found =
      (s.sizeId && sizes.find((x) => x.id === s.sizeId)) ||
      sizes.find((x) => canonicalSize(x.name) === canonicalSize(s.name));
    if (s.sizeId && !found) throw new AppError("NOT_FOUND", "One of the sizes was not found.");
    const size = found ?? (await createSize(ctx, { name: s.name }, meta));
    sizes.push(size);
    sizeIds[s.name] = size.id;
  }
  const result = await generateMatrix(
    ctx,
    styleId,
    {
      colorIds: [...new Set(Object.values(colourIds))],
      sizeIds: [...new Set(Object.values(sizeIds))],
    },
    meta,
  );
  return { styleId, colourIds, sizeIds, created: result.created };
}

// =============================================================================
// Opening stock
// =============================================================================

const stockSchema = z.object({
  styleId: id,
  warehouseId: id.optional(),
  grade: z.enum(["A_GRADE", "B_GRADE"]).default("A_GRADE"),
  /** What each piece cost; without it the pieces come in at the SKU's average cost. */
  unitCost: z.number().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(500).optional(),
  cells: z
    .array(
      z.object({
        colorId: id,
        sizeId: id,
        pieces: z.number().int().min(1).max(1_000_000),
      }),
    )
    .min(1, "Add pieces to at least one colour and size")
    .max(500),
});

/**
 * Adds the list's pieces as opening stock through the stock count's own path
 * (recordStockCount, mode OPENING): one numbered batch per style, Dr Finished
 * Goods Inventory, Cr Opening Balance Equity, at the cost given (else the
 * SKU's average). Nothing new is invented here: only colour x size is turned
 * into the style's SKUs.
 */
export async function addPackingListStock(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanAddStock(ctx);
  const input = stockSchema.parse(raw);
  const style = await ctx.db.style.findUnique({ where: { id: input.styleId } });
  if (!style) throw new AppError("NOT_FOUND", "Style not found.");
  const variants = await ctx.db.productVariant.findMany({
    where: { styleId: style.id, removedAt: null },
    select: { id: true, colorId: true, sizeId: true },
  });
  const byCell = new Map(variants.map((v) => [`${v.colorId}:${v.sizeId}`, v.id]));
  const pieces = new Map<string, number>();
  for (const cell of input.cells) {
    const variantId = byCell.get(`${cell.colorId}:${cell.sizeId}`);
    if (!variantId) {
      throw new AppError(
        "VALIDATION",
        `A colour and size on the list is not on ${style.code}. Add it to the style first.`,
      );
    }
    pieces.set(variantId, (pieces.get(variantId) ?? 0) + cell.pieces);
  }
  const note = input.note || "From a packing list";
  return recordStockCount(
    ctx,
    {
      mode: "OPENING",
      warehouseId: input.warehouseId,
      grade: input.grade,
      unitCost: input.unitCost,
      note,
      lines: [...pieces].map(([variantId, quantity]) => ({ variantId, quantity })),
    },
    meta,
  );
}
