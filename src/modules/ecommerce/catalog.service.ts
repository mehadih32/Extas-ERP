import { Prisma } from "@prisma/client";

import type { CompanyContext } from "@/modules/auth/context";

import { EcommerceApiError } from "./errors";
import type { ShopCall } from "./route";
import type { RetailStore } from "@prisma/client";

import { storePrices } from "@/modules/retail/stores.service";

import {
  type CatalogVariant,
  catalogQuerySchema,
  type Page,
  pageQuerySchema,
  skuSchema,
  type StockRow,
  stockQuerySchema,
  type StoreCatalogVariant,
} from "./schemas";

/*
 * What the shop reads (CN-005): the catalog of SKUs with their prices, and
 * the A-grade (sellable) stock per SKU per warehouse. Both lists page by a
 * cursor that names the last row given (in id order, so a page never repeats
 * or skips a row while others change), and take `updatedSince` so the shop
 * can poll for changes when a webhook was missed.
 */

/** A number with 2 decimals, as the API gives money. */
export const amount = (value: Prisma.Decimal | number | null | undefined) =>
  value === null || value === undefined ? 0 : Number(new Prisma.Decimal(value).toFixed(2));

/** The query's fields, an empty one (`?cursor=`) taken as not sent. */
const fieldsOf = (query: URLSearchParams) =>
  Object.fromEntries([...query].filter(([, value]) => value !== ""));

/** For sale: the variant and its style are active and it was not taken off the matrix. */
export const variantActive = (v: {
  isActive: boolean;
  removedAt: Date | null;
  style: { isActive: boolean };
}) => v.isActive && !v.removedAt && v.style.isActive;

const encodeCursor = (id: string) => Buffer.from(`v1:${id}`).toString("base64url");

/** The id a cursor names, or a 422 when it is not one the API gave. */
function decodeCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  const text = /^[A-Za-z0-9_-]+$/.test(cursor) ? Buffer.from(cursor, "base64url").toString() : "";
  const match = /^v1:([A-Za-z0-9_-]{1,40})$/.exec(text);
  if (!match) {
    throw new EcommerceApiError(
      422,
      "VALIDATION",
      "This cursor is not valid: send the nextCursor of the page before, or none for the first page.",
      { cursor: ["Use nextCursor from the last page"] },
    );
  }
  return match[1];
}

/** The rows of one page and the cursor of the next (null on the last page). */
function pageOf<T extends { id: string }, R>(rows: T[], limit: number, map: (row: T) => R) {
  const more = rows.length > limit;
  const kept = more ? rows.slice(0, limit) : rows;
  return {
    data: kept.map(map),
    nextCursor: more ? encodeCursor(kept[kept.length - 1]!.id) : null,
  };
}

const variantInclude = {
  style: {
    select: { code: true, name: true, retailPrice: true, isActive: true, updatedAt: true },
  },
  color: { select: { name: true } },
  size: { select: { name: true } },
} as const;

type VariantRow = Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>;

export function catalogVariantOf(v: VariantRow): CatalogVariant {
  const updatedAt = v.updatedAt > v.style.updatedAt ? v.updatedAt : v.style.updatedAt;
  return {
    sku: v.sku,
    barcode: v.barcode,
    styleCode: v.style.code,
    styleName: v.style.name,
    color: v.color.name,
    size: v.size.name,
    retailPrice: amount(v.retailPrice ?? v.style.retailPrice),
    avgCost: amount(v.avgCost),
    active: variantActive(v),
    updatedAt: updatedAt.toISOString(),
  };
}

/** GET /catalog/variants: every SKU of the company, inactive ones too (active: false). */
export async function listCatalogVariants(
  ctx: CompanyContext,
  query: URLSearchParams,
): Promise<Page<CatalogVariant>> {
  const q = catalogQuerySchema.parse(fieldsOf(query));
  const after = decodeCursor(q.cursor);
  const since = q.updatedSince ? new Date(q.updatedSince) : undefined;
  const rows = await ctx.db.productVariant.findMany({
    where: {
      ...(since
        ? { OR: [{ updatedAt: { gt: since } }, { style: { updatedAt: { gt: since } } }] }
        : {}),
      ...(q.styleCode ? { style: { code: q.styleCode } } : {}),
      ...(after ? { id: { gt: after } } : {}),
    },
    include: variantInclude,
    orderBy: { id: "asc" },
    take: q.limit + 1,
  });
  return pageOf(rows, q.limit, catalogVariantOf);
}

/**
 * GET /catalog/variants for a retail store's shop (plan v6 sec 2): each SKU
 * with only the store's own price, never the ERP's cost or price list. A SKU
 * with no shop price is left out. `updatedSince` also finds SKUs whose price
 * changed: a hand price on them, or the store's rules (then every SKU).
 */
export async function listStoreCatalog(
  ctx: CompanyContext,
  store: Pick<RetailStore, "id" | "updatedAt">,
  query: URLSearchParams,
): Promise<Page<StoreCatalogVariant>> {
  const q = catalogQuerySchema.parse(fieldsOf(query));
  const after = decodeCursor(q.cursor);
  const since = q.updatedSince ? new Date(q.updatedSince) : undefined;
  const priced = since
    ? { storeId: store.id, OR: [{ setAt: { gt: since } }, { removedAt: { gt: since } }] }
    : null;
  const rows = await ctx.db.productVariant.findMany({
    where: {
      ...(since && priced && store.updatedAt <= since
        ? {
            OR: [
              { updatedAt: { gt: since } },
              { style: { updatedAt: { gt: since } } },
              { style: { retailPrices: { some: priced } } },
            ],
          }
        : {}),
      ...(q.styleCode ? { style: { code: q.styleCode } } : {}),
      ...(after ? { id: { gt: after } } : {}),
    },
    include: variantInclude,
    orderBy: { id: "asc" },
    take: q.limit + 1,
  });
  const more = rows.length > q.limit;
  const kept = more ? rows.slice(0, q.limit) : rows;
  const prices = await storePrices(
    ctx,
    store.id,
    kept.map((v) => v.id),
    "A",
  );
  const data = kept.flatMap((v): StoreCatalogVariant[] => {
    const price = prices.get(v.id);
    if (!price) return [];
    const updatedAt = v.updatedAt > v.style.updatedAt ? v.updatedAt : v.style.updatedAt;
    return [
      {
        sku: v.sku,
        barcode: v.barcode,
        styleCode: v.style.code,
        styleName: v.style.name,
        color: v.color.name,
        size: v.size.name,
        grade: "A",
        shopPrice: amount(price),
        active: variantActive(v),
        updatedAt: updatedAt.toISOString(),
      },
    ];
  });
  return { data, nextCursor: more ? encodeCursor(kept[kept.length - 1]!.id) : null };
}

const balanceInclude = {
  variant: { select: { sku: true } },
  warehouse: { select: { id: true, name: true } },
} as const;

type BalanceRow = Prisma.StockBalanceGetPayload<{ include: typeof balanceInclude }>;

export function stockRowOf(b: BalanceRow): StockRow {
  return {
    sku: b.variant.sku,
    warehouseId: b.warehouse.id,
    warehouseName: b.warehouse.name,
    onHand: b.quantity,
    reserved: b.reserved,
    available: Math.max(b.quantity - b.reserved, 0),
    updatedAt: b.updatedAt.toISOString(),
  };
}

/** GET /stock: A-grade stock per SKU per warehouse (warehouses not deleted). */
export async function listStock(
  ctx: CompanyContext,
  query: URLSearchParams,
): Promise<Page<StockRow>> {
  const q = stockQuerySchema.parse(fieldsOf(query));
  const after = decodeCursor(q.cursor);
  if (q.warehouseId) {
    const warehouse = await ctx.db.warehouse.findFirst({
      where: { id: q.warehouseId, deletedAt: null },
      select: { id: true },
    });
    if (!warehouse) {
      throw new EcommerceApiError(404, "NOT_FOUND", "There is no warehouse with this id.");
    }
  }
  const rows = await ctx.db.stockBalance.findMany({
    where: {
      grade: "A_GRADE",
      warehouse: { deletedAt: null },
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {}),
      ...(after ? { id: { gt: after } } : {}),
    },
    include: balanceInclude,
    orderBy: { id: "asc" },
    take: q.limit + 1,
  });
  return pageOf(rows, q.limit, stockRowOf);
}

/**
 * GET /stock/{sku}: live stock of one SKU, for the checkout's last check. The
 * top `available` is the shop's own warehouse's (0 when it holds none).
 */
export async function stockOfSku(call: Pick<ShopCall, "ctx" | "integration">, rawSku: string) {
  const sku = skuSchema.parse(rawSku);
  const variant = await call.ctx.db.productVariant.findFirst({
    where: { sku },
    select: {
      id: true,
      sku: true,
      isActive: true,
      removedAt: true,
      style: { select: { isActive: true } },
    },
  });
  if (!variant) throw new EcommerceApiError(404, "NOT_FOUND", `There is no SKU ${sku} in the ERP.`);
  const balances = await call.ctx.db.stockBalance.findMany({
    where: { variantId: variant.id, grade: "A_GRADE", warehouse: { deletedAt: null } },
    include: balanceInclude,
    orderBy: [{ warehouse: { name: "asc" } }, { id: "asc" }],
  });
  const warehouses = balances.map(stockRowOf);
  return {
    sku: variant.sku,
    active: variantActive(variant),
    available:
      warehouses.find((w) => w.warehouseId === call.integration.warehouseId)?.available ?? 0,
    warehouses,
  };
}
