import type { Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { lockRow } from "@/lib/row-lock";
import type { CompanyContext } from "@/modules/auth/context";
import { availableByVariant } from "@/modules/inventory/stock.service";

/*
 * The shops' reserve (plan v6 sec 3)
 * ----------------------------------
 * One reserve for all shops, on a whole style or on one colour of it. A
 * wholesale order may not take the warehouse's stock of that style (or colour)
 * below the reserve, not even with Force Allow; the shops may take all of it.
 * Each piece billed to a shop comes off the reserve, and a piece the owner
 * approves back from a shop goes back on it.
 */

type Tx = Prisma.TransactionClient;

type Line = { variantId: string; styleId: string; colorId: string; quantity: number };

const inReserve = (r: { styleId: string; colorId: string | null }, v: Omit<Line, "quantity">) =>
  r.styleId === v.styleId && (r.colorId === null || r.colorId === v.colorId);

/**
 * The most each wholesale line may take without going into the shops' reserve,
 * for the lines of a reserved style. `ownReserved` is what the order already
 * holds (when it is edited): it counts as free for it.
 */
export async function wholesaleCaps(
  ctx: CompanyContext,
  lines: Line[],
  warehouseId: string,
  ownReserved: Map<string, number>,
): Promise<Map<string, number>> {
  const caps = new Map<string, number>();
  const styleIds = [...new Set(lines.map((l) => l.styleId))];
  if (styleIds.length === 0) return caps;
  const reserves = await ctx.db.retailReserve.findMany({
    where: { styleId: { in: styleIds }, quantity: { gt: 0 } },
  });
  if (reserves.length === 0) return caps;
  const variants = await ctx.db.productVariant.findMany({
    where: { styleId: { in: reserves.map((r) => r.styleId) } },
    select: { id: true, styleId: true, colorId: true },
  });
  const available = await availableByVariant(
    ctx,
    variants.map((v) => v.id),
    warehouseId,
  );
  for (const reserve of reserves) {
    const group = variants.filter((v) => inReserve(reserve, { ...v, variantId: v.id }));
    const free = group.reduce(
      (sum, v) => sum + (available.get(v.id) ?? 0) + (ownReserved.get(v.id) ?? 0),
      0,
    );
    let left = Math.max(free - reserve.quantity, 0);
    for (const line of lines.filter((l) => inReserve(reserve, l))) {
      caps.set(line.variantId, Math.min(caps.get(line.variantId) ?? Infinity, left));
      left = Math.max(left - line.quantity, 0);
    }
  }
  return caps;
}

/** The reserve a SKU falls under (a style has one for the whole style or ones per colour). */
async function reserveOf(db: Db, companyId: string, variantId: string) {
  const v = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { styleId: true, colorId: true },
  });
  return db.retailReserve.findFirst({
    where: {
      companyId,
      styleId: v.styleId,
      OR: [{ colorId: null }, { colorId: v.colorId }],
    },
    orderBy: { colorId: { sort: "asc", nulls: "first" } },
  });
}

/** Takes a billed store order's pieces off the reserve (as many as it holds). */
export async function takeFromReserveTx(tx: Tx, companyId: string, retailOrderId: string) {
  const lines = await tx.retailOrderLine.findMany({
    where: { retailOrderId, cancelledAt: null },
    select: { id: true, variantId: true, quantity: true },
  });
  for (const line of lines) {
    const reserve = await reserveOf(tx, companyId, line.variantId);
    if (!reserve) continue;
    // Locked: two bills at once never take the same pieces.
    await lockRow(tx, "RetailReserve", reserve.id);
    const { quantity } = await tx.retailReserve.findUniqueOrThrow({ where: { id: reserve.id } });
    const taken = Math.min(quantity, line.quantity);
    if (taken === 0) continue;
    await tx.retailReserve.update({
      where: { id: reserve.id },
      data: { quantity: quantity - taken, activeAt: new Date() },
    });
    await tx.retailOrderLine.update({ where: { id: line.id }, data: { fromReserve: taken } });
  }
}

/** An approved piece of a line that came off the reserve goes back on it. */
export async function putBackOnReserve(db: Db, companyId: string, lineIds: string[]) {
  for (const id of lineIds) {
    const line = await db.retailOrderLine.findUniqueOrThrow({
      where: { id },
      select: { variantId: true, fromReserve: true },
    });
    if (line.fromReserve <= 0) continue;
    const reserve = await reserveOf(db, companyId, line.variantId);
    if (!reserve) continue;
    await db.retailOrderLine.update({ where: { id }, data: { fromReserve: { decrement: 1 } } });
    await db.retailReserve.update({
      where: { id: reserve.id },
      data: { quantity: { increment: 1 } },
    });
  }
}
