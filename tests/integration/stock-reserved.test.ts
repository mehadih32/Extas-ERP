import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as stock from "@/modules/inventory/stock.service";
import { releaseStock, reserveStock } from "@/modules/sales/stock-ops";

import { type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/*
 * Pieces reserved for shop or sales orders stay for those orders: "Move to bad
 * stock", a stock count and a correction may take a SKU's stock down only to
 * what is reserved, A-grade and B-grade alike, never below it. The orders
 * themselves reserve and deliver as before.
 */
run("Reserved pieces stay for their orders", () => {
  let shop: Shop;
  let navyS: Shop["variants"][number];
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    navyS = shop.variants.find(
      (v) => v.styleId === shop.polo.id && v.color.name === "Navy" && v.size.name === "S",
    )!;
  });

  const key = (grade: "A_GRADE" | "B_GRADE" = "A_GRADE") => ({
    companyId: shop.company.id,
    warehouseId: shop.warehouse.id,
    variantId: navyS.id,
    grade,
  });
  const reserve = (pieces: number, grade: "A_GRADE" | "B_GRADE" = "A_GRADE") =>
    prisma.$transaction((tx) => reserveStock(tx, key(grade), pieces, false));
  const balance = (grade: "A_GRADE" | "B_GRADE" = "A_GRADE") =>
    prisma.stockBalance.findUniqueOrThrow({
      where: {
        variantId_warehouseId_grade: {
          variantId: navyS.id,
          warehouseId: shop.warehouse.id,
          grade,
        },
      },
      select: { quantity: true, reserved: true },
    });
  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("CONFLICT");
    return (error as AppError).message;
  };
  const toBad = (quantity: number, grade: "A_GRADE" | "B_GRADE" = "A_GRADE") =>
    stock.moveToBadStock(shop.owner, {
      variantId: navyS.id,
      warehouseId: shop.warehouse.id,
      grade,
      quantity,
      reason: "Stained",
    });

  it("moves to bad stock only the A-grade pieces not reserved", async () => {
    expect(await reserve(7)).toBe(true);
    // 10 in hand, 7 for orders: 4 cannot go.
    expect(await refused(toBad(4))).toBe(
      `${navyS.sku}: 7 of the 10 pieces in hand are reserved for shop or sales orders, so only 3 can be taken off (4 asked). Deliver, change or cancel those orders first.`,
    );
    expect(await balance()).toEqual({ quantity: 10, reserved: 7 });
    expect(await prisma.badStockEntry.count()).toBe(0);
    await toBad(3);
    expect(await balance()).toEqual({ quantity: 7, reserved: 7 });
    await refused(toBad(1));
    // An order changed: its pieces come free again.
    await prisma.$transaction((tx) => releaseStock(tx, key(), 2));
    await toBad(2);
    expect(await balance()).toEqual({ quantity: 5, reserved: 5 });
  });

  it("never counts or corrects A-grade stock below what is reserved", async () => {
    await reserve(6);
    const count = (counted: number, expected = 10) =>
      stock.recordStockCount(shop.owner, {
        mode: "COUNT",
        warehouseId: shop.warehouse.id,
        lines: [{ variantId: navyS.id, counted, expected }],
      });
    expect(await refused(count(5))).toMatch(/6 of the 10 pieces in hand are reserved/);
    expect(await balance()).toEqual({ quantity: 10, reserved: 6 });
    await refused(
      stock.adjustStock(shop.owner, {
        variantId: navyS.id,
        warehouseId: shop.warehouse.id,
        quantity: -5,
        type: "ADJUSTMENT",
      }),
    );
    // Down to the reserved pieces is fine.
    await count(6);
    expect(await balance()).toEqual({ quantity: 6, reserved: 6 });
    // A count can still find more.
    await count(8, 6);
    expect(await balance()).toEqual({ quantity: 8, reserved: 6 });
  });

  it("keeps reserved B-grade pieces the same way", async () => {
    await stock.adjustStock(shop.owner, {
      variantId: navyS.id,
      warehouseId: shop.warehouse.id,
      grade: "B_GRADE",
      quantity: 5,
      type: "OPENING",
      unitCost: 300,
    });
    expect(await reserve(4, "B_GRADE")).toBe(true);
    expect(await refused(toBad(2, "B_GRADE"))).toBe(
      `${navyS.sku}: 4 of the 5 B-grade pieces in hand are reserved for shop or sales orders, so only 1 can be taken off (2 asked). Deliver, change or cancel those orders first.`,
    );
    await refused(
      stock.recordStockCount(shop.owner, {
        mode: "COUNT",
        warehouseId: shop.warehouse.id,
        grade: "B_GRADE",
        lines: [{ variantId: navyS.id, counted: 3, expected: 5 }],
      }),
    );
    await toBad(1, "B_GRADE");
    expect(await balance("B_GRADE")).toEqual({ quantity: 4, reserved: 4 });
    // The A-grade pieces are not touched by the B-grade reservation.
    await toBad(10);
    expect(await balance()).toEqual({ quantity: 0, reserved: 0 });
  });

  it("still says plainly when there are not enough pieces at all", async () => {
    expect(await refused(toBad(11))).toBe("Not enough stock: 10 in hand, 11 requested.");
  });
});
