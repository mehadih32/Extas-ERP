import type { StockGrade } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { type SalesTotals, styleSales } from "@/modules/dashboard/sales-figures";
import { isCompanyOwner } from "@/modules/hr/access";
import {
  type CategoryNode,
  listBrands,
  listCategoryTree,
  listColors,
  listSizes,
} from "@/modules/inventory/catalog.service";
import { gradeCost } from "@/modules/inventory/costs";
import {
  getStyleMatrix,
  matrixAxes,
  matrixLocks,
  type MatrixLocks,
} from "@/modules/inventory/matrix.service";
import { listStylesSchema, stockCountSheetQuerySchema } from "@/modules/inventory/schemas";
import {
  canDeleteBrand,
  canDeleteCategory,
  canDeleteColor,
  canDeleteSize,
  canDeleteStyle,
  canDeleteWarehouse,
} from "@/modules/inventory/rules";
import {
  costMask,
  DEFAULT_WAREHOUSE_NAME,
  listWarehouses,
  type StockCell,
  warehouseHolds,
} from "@/modules/inventory/stock.service";
import {
  getStyle,
  listStyles,
  staleStyles,
  styleHistoryCount,
} from "@/modules/inventory/style.service";

/*
 * What the Products screens show, as plain values (prices as "450.00" strings),
 * with what the person looking may do decided by the same rules and permissions
 * the inventory actions enforce: changes need inventory.manage, deleting follows
 * inventory/rules.ts, and costs follow the dashboard's financials rule.
 */

/** A category in tree order, with how deep it sits and the names above it. */
export type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  /** Names from the top category down to this one. */
  path: string[];
  styleCount: number;
  childCount: number;
};

function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
  path: string[] = [],
): CategoryOption[] {
  return nodes.flatMap((node) => {
    const here = [...path, node.name];
    return [
      {
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        depth,
        path: here,
        styleCount: node.styleCount,
        childCount: node.children.length,
      },
      ...flattenCategories(node.children, depth + 1, here),
    ];
  });
}

/** Every category in tree order (a parent, then its sub-categories). */
export async function listCategoryOptions(ctx: CompanyContext): Promise<CategoryOption[]> {
  return flattenCategories(await listCategoryTree(ctx));
}

// --- Setup: colours, sizes, categories, brands, warehouses -------------------------

/** The Setup tab: the lists styles are built from, with what this person may change. */
export async function getCatalogSetup(ctx: CompanyContext) {
  const canManage = ctx.can("inventory.manage");
  const [colors, sizes, categories, brands, warehouses] = await Promise.all([
    ctx.db.color.findMany({
      include: { _count: { select: { variants: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    ctx.db.size.findMany({
      include: { _count: { select: { variants: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    listCategoryOptions(ctx),
    listBrands(ctx),
    listWarehouses(ctx),
  ]);
  // Only a Super Admin deletes warehouses: they see what each one still holds.
  const owner = canManage && isCompanyOwner(ctx);
  const holds = await warehouseHolds(
    prisma,
    ctx.company.id,
    warehouses.map((w) => w.id),
  );
  return {
    canManage,
    colors: colors.map((c) => {
      const variantCount = c._count.variants;
      return {
        id: c.id,
        name: c.name,
        hexCode: c.hexCode,
        variantCount,
        can: { delete: canManage && canDeleteColor({ variantCount }).ok },
      };
    }),
    sizes: sizes.map((s) => {
      const variantCount = s._count.variants;
      return {
        id: s.id,
        name: s.name,
        variantCount,
        can: { delete: canManage && canDeleteSize({ variantCount }).ok },
      };
    }),
    categories: categories.map((c) => ({
      ...c,
      can: { delete: canManage && canDeleteCategory(c).ok },
    })),
    brands: brands.map((b) => ({
      id: b.id,
      name: b.name,
      styleCount: b.styleCount,
      can: { delete: canManage && canDeleteBrand(b).ok },
    })),
    warehouses: warehouses.map((w) => {
      const hold = holds.get(w.id)!;
      const verdict = canDeleteWarehouse({ hold, others: warehouses.length - 1 });
      return {
        id: w.id,
        name: w.name,
        address: w.address,
        isDefault: w.isDefault,
        hold,
        can: { delete: owner && verdict.ok },
        /** Why a Super Admin cannot delete it yet (null when they can, or are not one). */
        blocked: owner && !verdict.ok ? verdict.message : null,
      };
    }),
  };
}

export type CatalogSetup = Awaited<ReturnType<typeof getCatalogSetup>>;

// --- Styles ------------------------------------------------------------------------

type StyleRow = Awaited<ReturnType<typeof getStyle>>;

function presentStyle(style: StyleRow, categories: CategoryOption[]) {
  const category = categories.find((c) => c.id === style.categoryId);
  return {
    id: style.id,
    code: style.code,
    name: style.name,
    description: style.description,
    fabric: style.fabric,
    isActive: style.isActive,
    retailPrice: style.retailPrice.toFixed(2),
    wholesalePrice: style.wholesalePrice.toFixed(2),
    category: {
      id: style.category.id,
      name: style.category.name,
      path: category?.path ?? [style.category.name],
    },
    brand: style.brand,
    variantCount: style._count.variants,
    createdAt: style.createdAt,
    updatedAt: style.updatedAt,
  };
}

export type StyleDetails = ReturnType<typeof presentStyle>;

/** The style list: each style with its stock (all warehouses) and prices. */
export async function listStyleCards(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listStyles(ctx, raw);
  return {
    items: page.items.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      imageUrl: s.imageUrl,
      isActive: s.isActive,
      category: s.category,
      brand: s.brand,
      variantCount: s.variantCount,
      stock: s.stock,
      retailPrice: s.retailPrice.toFixed(2),
      wholesalePrice: s.wholesalePrice.toFixed(2),
    })),
    nextCursor: page.nextCursor,
  };
}

export type StyleCard = Awaited<ReturnType<typeof listStyleCards>>["items"][number];

/**
 * The Styles tab: the first page of styles for the filters given, the categories
 * and brands to filter by, and whether this person may add styles.
 */
export async function getStyleList(ctx: CompanyContext, raw: unknown = {}) {
  const canManage = ctx.can("inventory.manage");
  const archived = listStylesSchema.parse(raw).archived ?? false;
  const [page, categories, brands, stale, groups] = await Promise.all([
    listStyleCards(ctx, raw),
    listCategoryOptions(ctx),
    listBrands(ctx),
    canManage && !archived ? staleStyles(ctx) : Promise.resolve([]),
    ctx.db.style.groupBy({ by: ["categoryId"], where: { isActive: !archived }, _count: true }),
  ]);
  // Styles in each category and the ones under it (the tree is listed parents first).
  const counts: Record<string, number> = Object.fromEntries(
    groups.map((g) => [g.categoryId, g._count]),
  );
  for (const c of categories.toReversed()) {
    if (c.parentId) counts[c.parentId] = (counts[c.parentId] ?? 0) + (counts[c.id] ?? 0);
  }
  return {
    ...page,
    categories,
    /** This tab's styles per category, counting the categories under it. */
    counts,
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    /** Add, archive and unarchive styles (and change stock or SKUs on the style pages). */
    canManage,
    /** Styles with no stock for six months, suggested for archiving (inventory.manage only). */
    stale: stale.map((st) => ({
      id: st.id,
      code: st.code,
      name: st.name,
      /** The day its stock last moved (or it was added). */
      since: localDay(st.since, ctx.company.timezone),
    })),
  };
}

export type StyleList = Awaited<ReturnType<typeof getStyleList>>;

/** What the new-style and edit-style forms need: the style (when editing) and the choices. */
export async function getStyleForm(ctx: CompanyContext, styleId?: string) {
  const [categories, brands, style] = await Promise.all([
    listCategoryOptions(ctx),
    listBrands(ctx),
    styleId ? getStyle(ctx, styleId) : Promise.resolve(null),
  ]);
  return {
    style: style ? presentStyle(style, categories) : null,
    categories,
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
  };
}

/**
 * One style's page: its details, the colour x size matrix with stock (all
 * warehouses, or the one chosen), the colours and sizes it could add, and what
 * this person may do. Deleting is offered only to a style with no history.
 */
export async function getStyleScreen(
  ctx: CompanyContext,
  styleId: string,
  options: { warehouseId?: string } = {},
) {
  const canManage = ctx.can("inventory.manage");
  const style = await getStyle(ctx, styleId);
  const warehouses = await listWarehouses(ctx);
  const warehouseId = warehouses.some((w) => w.id === options.warehouseId)
    ? options.warehouseId
    : undefined;
  const [matrix, categories, colors, sizes, historyCount, sales, locks] = await Promise.all([
    getStyleMatrix(ctx, style.id, { warehouseId }),
    listCategoryOptions(ctx),
    listColors(ctx),
    listSizes(ctx),
    canManage ? styleHistoryCount(ctx, style.id) : Promise.resolve(0),
    ctx.can("sales.view") ? styleSales(ctx.company.id, style.id) : Promise.resolve(null),
    canManage
      ? matrixLocks(ctx, style.id)
      : Promise.resolve<MatrixLocks>({ colors: {}, sizes: {} }),
  ]);
  const sold = (side: SalesTotals) => ({
    orders: side.orders,
    pieces: side.pieces,
    net: side.net.toFixed(2),
  });
  return {
    style: presentStyle(style, categories),
    matrix,
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault })),
    /** The warehouse the matrix shows, or null for all of them added up. */
    warehouseId: warehouseId ?? null,
    colors: colors.map((c) => ({ id: c.id, name: c.name, hexCode: c.hexCode })),
    sizes: sizes.map((s) => ({ id: s.id, name: s.name })),
    can: {
      /** Edit, archive, add colours and sizes, change SKUs, count and move to bad stock. */
      manage: canManage,
      delete: canManage && canDeleteStyle({ historyCount }).ok,
    },
    /**
     * The colours and sizes that cannot be unticked (inventory.manage): one of
     * their SKUs holds stock in some warehouse, or is on an open order or delivery.
     */
    locks,
    /** Whether the stock history shows what the pieces cost. */
    showsCosts: canSeeFinancials(ctx),
    /** Units sold and revenue, wholesale and retail (invoiced, all time): sales.view only. */
    sales: sales
      ? {
          wholesale: sold(sales.wholesale),
          retail: sold(sales.retail),
          total: sold({
            orders: sales.wholesale.orders + sales.retail.orders,
            pieces: sales.wholesale.pieces + sales.retail.pieces,
            net: sales.wholesale.net.add(sales.retail.net),
          }),
        }
      : null,
  };
}

export type StyleScreen = Awaited<ReturnType<typeof getStyleScreen>>;

// --- One SKU -----------------------------------------------------------------------

const emptyCell = (): StockCell => ({ aGrade: 0, bGrade: 0, reserved: 0, available: 0 });

function addTo(cell: StockCell, grade: StockGrade, quantity: number, reserved: number) {
  if (grade === "A_GRADE") {
    cell.aGrade += quantity;
    cell.reserved += reserved;
  } else {
    cell.bGrade += quantity;
  }
  cell.available = cell.aGrade - cell.reserved;
}

/**
 * One SKU: its prices (its own or the style's), barcode, and its stock in each
 * warehouse by grade, for the matrix cell window and the bad stock form.
 */
export async function getVariantDetails(ctx: CompanyContext, variantId: string) {
  const variant = await ctx.db.productVariant.findUnique({
    where: { id: variantId },
    include: {
      style: {
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          retailPrice: true,
          wholesalePrice: true,
        },
      },
      color: { select: { id: true, name: true, hexCode: true } },
      size: { select: { id: true, name: true } },
    },
  });
  if (!variant) throw new AppError("NOT_FOUND", "SKU not found.");
  const [warehouses, balances] = await Promise.all([
    listWarehouses(ctx),
    ctx.db.stockBalance.findMany({
      where: { variantId: variant.id },
      select: { warehouseId: true, grade: true, quantity: true, reserved: true },
    }),
  ]);
  const total = emptyCell();
  const byWarehouse = new Map(warehouses.map((w) => [w.id, emptyCell()]));
  for (const b of balances) {
    addTo(total, b.grade, b.quantity, b.reserved);
    const cell = byWarehouse.get(b.warehouseId);
    if (cell) addTo(cell, b.grade, b.quantity, b.reserved);
  }
  const { style } = variant;
  const cost = costMask(ctx);
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    isActive: variant.isActive,
    style: {
      id: style.id,
      code: style.code,
      name: style.name,
      isActive: style.isActive,
      retailPrice: style.retailPrice.toFixed(2),
      wholesalePrice: style.wholesalePrice.toFixed(2),
    },
    color: variant.color,
    size: variant.size,
    /** The prices it sells at: its own when set, else the style's. */
    retailPrice: (variant.retailPrice ?? style.retailPrice).toFixed(2),
    wholesalePrice: (variant.wholesalePrice ?? style.wholesalePrice).toFixed(2),
    ownRetailPrice: variant.retailPrice?.toFixed(2) ?? null,
    ownWholesalePrice: variant.wholesalePrice?.toFixed(2) ?? null,
    stock: total,
    /**
     * Its stock in each warehouse. Before any warehouse exists this is the default
     * one with nothing in it (id null): the first stock change sets it up.
     */
    warehouses:
      warehouses.length > 0
        ? warehouses.map((w) => ({
            id: w.id as string | null,
            name: w.name,
            isDefault: w.isDefault,
            ...byWarehouse.get(w.id)!,
          }))
        : [{ id: null, name: DEFAULT_WAREHOUSE_NAME, isDefault: true, ...emptyCell() }],
    /** What a piece cost on average, by grade: only for people who see the financials. */
    averageCost: { aGrade: cost(variant.avgCost), bGrade: cost(variant.bGradeAvgCost) },
    showsCosts: canSeeFinancials(ctx),
    /** Change the SKU, count it or move pieces to bad stock. */
    canManage: ctx.can("inventory.manage"),
  };
}

export type VariantDetails = Awaited<ReturnType<typeof getVariantDetails>>;

// --- Stock count ---------------------------------------------------------------------

/**
 * The Stock count tab: the styles that have SKUs, the warehouses, and for the
 * chosen style, warehouse and grade, each SKU's pieces on the shelf now. The
 * count sends these back as what it expected, so stock that moves meanwhile is
 * caught instead of overwritten. Without any warehouse yet, the count goes to
 * the default one, which the first stock change sets up.
 */
export async function getStockCountSheet(ctx: CompanyContext, raw: unknown = {}) {
  const options = stockCountSheetQuerySchema.parse(raw);
  const grade = options.grade;
  const [styles, warehouses] = await Promise.all([
    ctx.db.style.findMany({
      where: { variants: { some: { removedAt: null } } },
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: [{ code: "asc" }, { id: "asc" }],
    }),
    listWarehouses(ctx),
  ]);
  const warehouse = warehouses.find((w) => w.id === options.warehouseId) ?? warehouses[0];
  const style = styles.find((s) => s.id === options.styleId);

  let sheet = null;
  if (style) {
    const variants = await ctx.db.productVariant.findMany({
      where: { styleId: style.id, removedAt: null },
      include: { color: true, size: true },
    });
    const balances = warehouse
      ? await ctx.db.stockBalance.findMany({
          where: { variantId: { in: variants.map((v) => v.id) }, warehouseId: warehouse.id, grade },
          select: { variantId: true, quantity: true, reserved: true },
        })
      : [];
    const shelf = new Map(balances.map((b) => [b.variantId, b]));
    const cost = costMask(ctx);
    const { colors, sizes } = matrixAxes(variants);
    const byCell = new Map(variants.map((v) => [`${v.colorId}:${v.sizeId}`, v]));
    sheet = {
      style,
      sizes: sizes.map((s) => ({ id: s.id, name: s.name })),
      rows: colors.map((color) => ({
        color: { id: color.id, name: color.name, hexCode: color.hexCode },
        cells: sizes.map((size) => {
          const variant = byCell.get(`${color.id}:${size.id}`);
          if (!variant) return null;
          const balance = shelf.get(variant.id);
          return {
            variantId: variant.id,
            sku: variant.sku,
            isActive: variant.isActive,
            /** Pieces of this grade on the shelf, including any set aside for orders. */
            onShelf: balance?.quantity ?? 0,
            reserved: balance?.reserved ?? 0,
            /** What one piece of this grade costs, for people who see the financials. */
            unitCost: cost(gradeCost(variant, grade)),
          };
        }),
      })),
    };
  }

  return {
    styles,
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault })),
    /** Where the count goes: the warehouse chosen, else the default one (id null: not set up yet). */
    warehouse: warehouse
      ? { id: warehouse.id as string | null, name: warehouse.name }
      : { id: null, name: DEFAULT_WAREHOUSE_NAME },
    grade,
    sheet,
    /** Whether shortages show what they cost (the cells' unitCost). */
    showsCosts: canSeeFinancials(ctx),
  };
}

export type StockCountSheet = Awaited<ReturnType<typeof getStockCountSheet>>;
