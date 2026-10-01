import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";

/*
 * Atomic A-grade stock operations for sales (single SQL statements, safe when
 * two people sell the last pieces at the same moment).
 *   reserve  - confirmed order: available = quantity - reserved goes down
 *   release  - order edited or cancelled before delivery
 *   deliver  - goods leave the warehouse: quantity and reservation go down
 * Only Force Override lines may push stock below zero.
 */

type Tx = Prisma.TransactionClient;
type Key = { companyId: string; warehouseId: string; variantId: string };

/** Reserves `qty` if that much is available; with `allowShort` reserves anyway. */
export async function reserveStock(tx: Tx, key: Key, qty: number, allowShort: boolean) {
  const reserved = await tx.$executeRaw`
    UPDATE "StockBalance" SET reserved = reserved + ${qty}, "updatedAt" = now()
    WHERE "variantId" = ${key.variantId} AND "warehouseId" = ${key.warehouseId}
      AND grade = 'A_GRADE'::"StockGrade" AND quantity - reserved >= ${qty}`;
  if (reserved === 1) return true;
  if (!allowShort) return false;
  await tx.$executeRaw`
    INSERT INTO "StockBalance" (id, "companyId", "variantId", "warehouseId", grade, quantity, reserved, "updatedAt")
    VALUES (${randomUUID()}, ${key.companyId}, ${key.variantId}, ${key.warehouseId}, 'A_GRADE'::"StockGrade", 0, ${qty}, now())
    ON CONFLICT ("variantId", "warehouseId", grade)
    DO UPDATE SET reserved = "StockBalance".reserved + EXCLUDED.reserved, "updatedAt" = now()`;
  return true;
}

export async function releaseStock(tx: Tx, key: Key, qty: number) {
  if (qty <= 0) return;
  await tx.$executeRaw`
    UPDATE "StockBalance" SET reserved = GREATEST(reserved - ${qty}, 0), "updatedAt" = now()
    WHERE "variantId" = ${key.variantId} AND "warehouseId" = ${key.warehouseId}
      AND grade = 'A_GRADE'::"StockGrade"`;
}

/** Takes delivered pieces out of stock and out of the reservation. */
export async function deliverStock(
  tx: Tx,
  key: Key & { sku: string },
  qty: number,
  allowNegative: boolean,
) {
  const updated = await tx.$executeRaw`
    UPDATE "StockBalance"
    SET quantity = quantity - ${qty}, reserved = GREATEST(reserved - ${qty}, 0), "updatedAt" = now()
    WHERE "variantId" = ${key.variantId} AND "warehouseId" = ${key.warehouseId}
      AND grade = 'A_GRADE'::"StockGrade" AND (quantity >= ${qty} OR ${allowNegative})`;
  if (updated === 1) return;
  if (!allowNegative) {
    throw new AppError(
      "INSUFFICIENT_STOCK",
      `Not enough ${key.sku} in the warehouse to deliver ${qty} pcs.`,
      { [`stock.${key.sku}`]: [`${qty} to deliver, not enough in hand`] },
    );
  }
  await tx.$executeRaw`
    INSERT INTO "StockBalance" (id, "companyId", "variantId", "warehouseId", grade, quantity, reserved, "updatedAt")
    VALUES (${randomUUID()}, ${key.companyId}, ${key.variantId}, ${key.warehouseId}, 'A_GRADE'::"StockGrade", ${-qty}, 0, now())
    ON CONFLICT ("variantId", "warehouseId", grade)
    DO UPDATE SET quantity = "StockBalance".quantity + EXCLUDED.quantity, "updatedAt" = now()`;
}
