import { Prisma, type SalesChannel } from "@prisma/client";

import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import { availableByVariant } from "@/modules/inventory/stock.service";
import { wholesaleCaps } from "@/modules/retail/reserve";
import { collectOrderLines, type RequestedLine } from "@/modules/sales/totals";

/** Channels sold at wholesale prices; the rest (shop, website, social) are retail. */
export const WHOLESALE_CHANNELS: SalesChannel[] = ["WHOLESALE", "B2B_PREORDER"];

export type ResolvedLine = {
  variantId: string;
  sku: string;
  styleId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  available: number;
  short: boolean;
  /** Wholesale: the most this line may take without going into the shops' reserve. */
  reserveCap?: number;
};

/**
 * Turns requested lines / matrix cells into priced SKU lines with the stock
 * available in the warehouse. Prices default to the SKU's wholesale or retail
 * price for the channel. `ownReserved` adds back what this order already holds
 * (when an order is edited).
 */
export async function resolveOrderLines(
  ctx: CompanyContext,
  input: Parameters<typeof collectOrderLines>[0],
  channel: SalesChannel,
  warehouseId: string,
  ownReserved: Map<string, number> = new Map(),
): Promise<ResolvedLine[]> {
  const { lines, matrixStyles } = collectOrderLines(input);
  const ids = lines.map((l) => l.variantId);
  const variants = await ctx.db.productVariant.findMany({
    where: { id: { in: ids } },
    include: {
      style: {
        select: { id: true, code: true, isActive: true, retailPrice: true, wholesalePrice: true },
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const available = await availableByVariant(ctx, ids, warehouseId);
  const wholesale = WHOLESALE_CHANNELS.includes(channel);
  const caps = wholesale
    ? await wholesaleCaps(
        ctx,
        lines.flatMap((l) => {
          const v = byId.get(l.variantId);
          return v ? [{ ...l, styleId: v.styleId, colorId: v.colorId }] : [];
        }),
        warehouseId,
        ownReserved,
      )
    : new Map<string, number>();

  return lines.map((line: RequestedLine) => {
    const v = byId.get(line.variantId);
    if (!v) throw new AppError("VALIDATION", "One of the SKUs was not found.");
    if (!v.isActive || !v.style.isActive) {
      throw new AppError("VALIDATION", `${v.sku} is archived and cannot be sold.`);
    }
    const matrixStyle = matrixStyles.get(v.id);
    if (matrixStyle && matrixStyle !== v.styleId) {
      throw new AppError("VALIDATION", `${v.sku} does not belong to the chosen style.`);
    }
    const listPrice = wholesale
      ? (v.wholesalePrice ?? v.style.wholesalePrice)
      : (v.retailPrice ?? v.style.retailPrice);
    const unitPrice =
      line.unitPrice !== undefined
        ? new Prisma.Decimal(line.unitPrice)
        : new Prisma.Decimal(listPrice);
    if (line.unitPrice === undefined && unitPrice.isZero()) {
      throw new AppError(
        "VALIDATION",
        `${v.sku} has no ${wholesale ? "wholesale" : "retail"} price; enter one.`,
      );
    }
    const reserveCap = caps.get(v.id);
    const free = Math.min(
      (available.get(v.id) ?? 0) + (ownReserved.get(v.id) ?? 0),
      reserveCap ?? Infinity,
    );
    return {
      variantId: v.id,
      sku: v.sku,
      styleId: v.styleId,
      quantity: line.quantity,
      unitPrice,
      discount: new Prisma.Decimal(line.discount ?? 0),
      available: free,
      short: line.quantity > free,
      ...(reserveCap !== undefined ? { reserveCap } : {}),
    };
  });
}

/**
 * Blueprint "Stock Limit Validation & Force Override": refuses lines above the
 * available stock unless the user ticked Force Override and may use it.
 */
export function assertStockOrOverride(
  ctx: CompanyContext,
  lines: ResolvedLine[],
  forceOverride?: { reason: string },
) {
  // The shops' reserve holds even against Force Allow (plan v6 sec 3).
  const held = lines.filter((l) => l.reserveCap !== undefined && l.quantity > l.reserveCap);
  if (held.length > 0) {
    throw new AppError(
      "INSUFFICIENT_STOCK",
      `${held.map((l) => l.sku).join(", ")}: the rest of the stock is held for the retail shops.`,
      Object.fromEntries(
        held.map((l) => [
          `stock.${l.sku}`,
          [`Requested ${l.quantity}, ${l.reserveCap} left outside the shops' reserve`],
        ]),
      ),
    );
  }
  const short = lines.filter((l) => l.short);
  if (short.length === 0) return;
  if (!forceOverride) {
    throw new AppError(
      "INSUFFICIENT_STOCK",
      `Not enough stock for ${short.length} item(s). Choose "Force Allow" to sell anyway.`,
      Object.fromEntries(
        short.map((l) => [
          `stock.${l.sku}`,
          [`Requested ${l.quantity}, available ${Math.max(l.available, 0)}`],
        ]),
      ),
    );
  }
  if (!ctx.can("sales.force_override")) {
    throw new AppError("FORBIDDEN", "You are not allowed to sell beyond available stock.");
  }
}
