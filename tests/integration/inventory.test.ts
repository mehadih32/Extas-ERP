import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** A company with a Super Admin context, sizes S–3XL, two colors and one category. */
async function setup(companyName = "Extras") {
  const { company, roles } = await makeCompany(companyName);
  const user = await makeUser(`admin@${company.slug}.test`);
  await addToCompany(user.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(user.id, company.id);

  const sizes = [];
  for (const name of catalog.DEFAULT_SIZES) sizes.push(await catalog.createSize(ctx, { name }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const brand = await catalog.createBrand(ctx, { name: "Extras Signature" });
  return { ctx, company, sizes, navy, white, tops, brand };
}

async function makePolo(env: Awaited<ReturnType<typeof setup>>) {
  const style = await styles.createStyle(env.ctx, {
    code: "ex-pl-001",
    name: "Classic Polo",
    categoryId: env.tops.id,
    brandId: env.brand.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  const { matrix: grid } = await matrix.generateMatrix(env.ctx, style.id, {
    colorIds: [env.navy.id, env.white.id],
    sizeIds: env.sizes.slice(0, 4).map((s) => s.id), // S M L XL
  });
  const cell = (color: string, size: string) =>
    grid.rows
      .find((r) => r.color.name === color)!
      .cells.find((c) => c && grid.sizes.find((s) => s.id === c.sizeId)?.name === size)!;
  return { style, grid, cell };
}

run("catalog", () => {
  beforeEach(resetDb);

  it("builds a nested category tree and blocks loops", async () => {
    const { ctx, tops } = await setup();
    const polos = await catalog.createCategory(ctx, { name: "Polos", parentId: tops.id });
    await catalog.createCategory(ctx, { name: "Tops" }); // same name -> unique slug
    const tree = await catalog.listCategoryTree(ctx);
    expect(tree.find((c) => c.id === tops.id)!.children.map((c) => c.name)).toEqual(["Polos"]);
    expect(
      tree
        .filter((c) => c.name === "Tops")
        .map((c) => c.slug)
        .sort(),
    ).toEqual(["tops", "tops-2"]);

    await expect(
      catalog.updateCategory(ctx, tops.id, { parentId: polos.id }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(catalog.deleteCategory(ctx, tops.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps sizes in matrix order and validates colors", async () => {
    const { ctx, sizes } = await setup();
    expect((await catalog.listSizes(ctx)).map((s) => s.name)).toEqual([...catalog.DEFAULT_SIZES]);
    const reversed = [...sizes].reverse().map((s) => s.id);
    const reordered = await catalog.reorderSizes(ctx, { sizeIds: reversed });
    expect(reordered[0]!.name).toBe("3XL");
    await expect(catalog.createColor(ctx, { name: "Bad", hexCode: "red" })).rejects.toMatchObject({
      name: "ZodError",
    });
    expect((await catalog.listColors(ctx)).map((c) => c.hexCode)).toContain("#1F2A44");
  });

  it("rejects duplicate style codes and unknown categories", async () => {
    const env = await setup();
    await makePolo(env);
    await expect(
      styles.createStyle(env.ctx, { code: "EX-PL-001", name: "Dup", categoryId: env.tops.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      styles.createStyle(env.ctx, { code: "EX-PL-002", name: "X", categoryId: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

run("color × size matrix", () => {
  beforeEach(resetDb);

  it("generates one SKU per cell, ordered by color and size", async () => {
    const env = await setup();
    const { grid, style } = await makePolo(env);
    expect(style.code).toBe("EX-PL-001");
    expect(grid.sizes.map((s) => s.name)).toEqual(["S", "M", "L", "XL"]);
    expect(grid.rows.map((r) => r.color.name)).toEqual(["Navy", "White"]);
    expect(grid.rows[0]!.color.hexCode).toBe("#1F2A44");
    expect(grid.rows[0]!.cells.map((c) => c!.sku)).toEqual([
      "EX-PL-001-NAVY-S",
      "EX-PL-001-NAVY-M",
      "EX-PL-001-NAVY-L",
      "EX-PL-001-NAVY-XL",
    ]);
    expect(grid.rows[0]!.cells[0]!.wholesalePrice).toBe("900.00");
  });

  it("is safe to re-run and only adds new cells", async () => {
    const env = await setup();
    const { style } = await makePolo(env);
    const again = await matrix.generateMatrix(env.ctx, style.id, {
      colorIds: [env.navy.id],
      sizeIds: env.sizes.map((s) => s.id), // adds XXL, 3XL for Navy only
    });
    expect(again.created).toBe(2);
    expect(again.matrix.sizes).toHaveLength(6);
    expect(again.matrix.rows[1]!.cells.filter((c) => c === null)).toHaveLength(2);
  });

  it("applies per-SKU price overrides and unique barcodes", async () => {
    const env = await setup();
    const { style, cell } = await makePolo(env);
    const xl = cell("Navy", "XL");
    await matrix.updateVariant(env.ctx, xl.variantId, { wholesalePrice: 950, barcode: "880001" });
    await expect(
      matrix.updateVariant(env.ctx, cell("Navy", "L").variantId, { barcode: "880001" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const grid = await matrix.getStyleMatrix(env.ctx, style.id);
    expect(grid.rows[0]!.cells[3]!.wholesalePrice).toBe("950.00");
    expect((await matrix.lookupVariant(env.ctx, "880001")).sku).toBe("EX-PL-001-NAVY-XL");
  });
});

run("stock", () => {
  beforeEach(resetDb);

  it("adds opening stock, tracks average cost and shows it in the matrix", async () => {
    const env = await setup();
    const { style, cell } = await makePolo(env);
    const m = cell("Navy", "M").variantId;

    await stock.adjustStock(env.ctx, {
      variantId: m,
      quantity: 10,
      type: "OPENING",
      unitCost: 400,
    });
    const { stock: after } = await stock.adjustStock(env.ctx, {
      variantId: m,
      quantity: 10,
      unitCost: 500,
    });
    expect(after).toMatchObject({ aGrade: 20, available: 20 });
    expect(Number((await prisma.productVariant.findUnique({ where: { id: m } }))!.avgCost)).toBe(
      450,
    );

    const grid = await matrix.getStyleMatrix(env.ctx, style.id);
    expect(grid.total).toBe(20);
    expect(grid.rows[0]!.total).toBe(20);
    expect(grid.sizes.find((s) => s.name === "M")!.total).toBe(20);
    expect(grid.rows[0]!.cells[1]!.lowStock).toBe(false);
    expect(grid.rows[0]!.cells[0]!.lowStock).toBe(true); // S has 0 (< 5)

    const movements = await stock.listMovements(env.ctx, { variantId: m });
    expect(movements.items.map((x) => x.quantity)).toEqual([10, 10]);
  });

  it("refuses to take stock below zero", async () => {
    const env = await setup();
    const { cell } = await makePolo(env);
    const s = cell("White", "S").variantId;
    await stock.adjustStock(env.ctx, { variantId: s, quantity: 3 });
    await expect(stock.adjustStock(env.ctx, { variantId: s, quantity: -4 })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Not enough stock: 3 in hand, 4 requested.",
    });
    const { stock: after } = await stock.adjustStock(env.ctx, { variantId: s, quantity: -3 });
    expect(after.aGrade).toBe(0);
  });

  it("handles concurrent removals without overselling", async () => {
    const env = await setup();
    const { cell } = await makePolo(env);
    const v = cell("Navy", "L").variantId;
    await stock.adjustStock(env.ctx, { variantId: v, quantity: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => stock.adjustStock(env.ctx, { variantId: v, quantity: -1 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const balance = await prisma.stockBalance.findFirst({ where: { variantId: v } });
    expect(balance!.quantity).toBe(0);
  });

  it("moves pieces to bad stock and records the loss at average cost", async () => {
    const env = await setup();
    const { cell } = await makePolo(env);
    const v = cell("Navy", "S").variantId;
    await stock.adjustStock(env.ctx, { variantId: v, quantity: 10, unitCost: 420 });
    const entry = await stock.moveToBadStock(env.ctx, {
      variantId: v,
      quantity: 2,
      reason: "Stain on collar",
    });
    expect(entry.lossValue.toFixed(2)).toBe("840.00");
    const balance = await prisma.stockBalance.findFirst({ where: { variantId: v } });
    expect(balance!.quantity).toBe(8);
    expect(
      await prisma.stockMovement.count({ where: { variantId: v, type: "BAD_STOCK_OUT" } }),
    ).toBe(1);
  });

  it("keeps A-grade and B-grade separate; only A-grade is available to sell", async () => {
    const env = await setup();
    const { cell } = await makePolo(env);
    const v = cell("White", "M").variantId;
    await stock.adjustStock(env.ctx, { variantId: v, quantity: 6 });
    await stock.adjustStock(env.ctx, { variantId: v, quantity: 4, grade: "B_GRADE" });
    const available = await stock.availableByVariant(env.ctx, [v]);
    expect(available.get(v)).toBe(6);
  });

  it("summarises value, low stock and highest stock for the dashboard", async () => {
    const env = await setup();
    const { cell } = await makePolo(env);
    const navyM = cell("Navy", "M").variantId;
    await stock.adjustStock(env.ctx, { variantId: navyM, quantity: 50, unitCost: 400 });
    await stock.adjustStock(env.ctx, {
      variantId: cell("Navy", "L").variantId,
      quantity: 3,
      unitCost: 400,
    });
    // Navy M has been in stock for 100 days without selling; Navy L only just arrived.
    await prisma.stockMovement.updateMany({
      where: { variantId: navyM },
      data: { createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
    });
    const summary = await stock.getStockSummary(env.ctx);
    expect(summary.stockValue).toBe("21200.00");
    expect(summary.aGradePieces).toBe(53);
    expect(summary.highestStock[0]!.sku).toBe("EX-PL-001-NAVY-M");
    expect(summary.lowStock.map((r) => r.sku)).toContain("EX-PL-001-NAVY-L");
    expect(summary.lowStock.map((r) => r.sku)).not.toContain("EX-PL-001-NAVY-M");
    // SKUs never stocked are not "low"; stock that just arrived is not judged as slow yet.
    expect(summary.lowStock.map((r) => r.sku)).not.toContain("EX-PL-001-WHITE-M");
    expect(summary.slowStock).toEqual([
      expect.objectContaining({ sku: "EX-PL-001-NAVY-M", movement: "DEAD", available: 50 }),
    ]);
  });
});

run("ratio fill", () => {
  beforeEach(resetDb);

  it("fills the matrix from a saved preset and caps to stock", async () => {
    const env = await setup();
    const { style, cell } = await makePolo(env);
    const [s, m, l, xl] = env.sizes;
    const preset = await matrix.createRatioPreset(env.ctx, {
      name: "Standard 1-2-2-1",
      entries: [
        { sizeId: s!.id, ratio: 1 },
        { sizeId: m!.id, ratio: 2 },
        { sizeId: l!.id, ratio: 2 },
        { sizeId: xl!.id, ratio: 1 },
      ],
    });
    expect(preset.entries.map((e) => e.size.name)).toEqual(["S", "M", "L", "XL"]);
    await stock.adjustStock(env.ctx, { variantId: cell("Navy", "M").variantId, quantity: 15 });

    const plan = await matrix.ratioFill(env.ctx, {
      styleId: style.id,
      colorIds: [env.navy.id],
      presetId: preset.id,
      packs: 10,
      capToAvailable: true,
    });
    const navy = plan.rows[0]!;
    expect(navy.cells.map((c) => [c.sku.split("-").pop(), c.requested, c.quantity])).toEqual([
      ["S", 10, 0],
      ["M", 20, 15],
      ["L", 20, 0],
      ["XL", 10, 0],
    ]);
    expect(plan.hasShortage).toBe(true);

    const byTotal = await matrix.ratioFill(env.ctx, {
      styleId: style.id,
      colorIds: [env.navy.id, env.white.id],
      presetId: preset.id,
      totalPerColor: 60,
    });
    expect(byTotal.total).toBe(120);
  });
});

run("inventory isolation between companies", () => {
  beforeEach(resetDb);

  it("never shows or touches another company's styles and stock", async () => {
    const extras = await setup("Extras");
    const fabric = await setup("Fabric Apparel");
    const { style, cell } = await makePolo(extras);
    await stock.adjustStock(extras.ctx, { variantId: cell("Navy", "M").variantId, quantity: 9 });

    const other: CompanyContext = fabric.ctx;
    expect((await styles.listStyles(other)).items).toHaveLength(0);
    await expect(matrix.getStyleMatrix(other, style.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      stock.adjustStock(other, { variantId: cell("Navy", "M").variantId, quantity: -9 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      matrix.generateMatrix(other, style.id, { colorIds: [extras.navy.id], sizeIds: [] }),
    ).rejects.toBeTruthy();
    // Same style code is allowed in a different company.
    await expect(
      styles.createStyle(other, { code: "EX-PL-001", name: "Polo", categoryId: fabric.tops.id }),
    ).resolves.toBeTruthy();
    expect((await stock.getStockSummary(other)).aGradePieces).toBe(0);
  });
});

run("inventory tree and style list", () => {
  beforeEach(resetDb);

  it("groups styles by category and brand, and filters by sub-category", async () => {
    const env = await setup();
    await makePolo(env);
    const polos = await catalog.createCategory(env.ctx, { name: "Polos", parentId: env.tops.id });
    await styles.createStyle(env.ctx, {
      code: "EX-PL-002",
      name: "Pique Polo",
      categoryId: polos.id,
    });

    const tree = await styles.getInventoryTree(env.ctx);
    const topsNode = tree.find((c) => c.id === env.tops.id)!;
    expect(topsNode.brands.map((b) => b.brandName)).toEqual(["Extras Signature"]);
    expect(topsNode.children[0]!.brands[0]!.brandName).toBe("No brand");

    const list = await styles.listStyles(env.ctx, { categoryId: env.tops.id });
    expect(list.items.map((s) => s.code)).toEqual(["EX-PL-001", "EX-PL-002"]);
    expect((await styles.listStyles(env.ctx, { search: "pique" })).items).toHaveLength(1);

    const archived = (await styles.listStyles(env.ctx, { search: "pique" })).items[0]!;
    await styles.updateStyle(env.ctx, archived.id, { isActive: false });
    expect((await styles.listStyles(env.ctx, { search: "pique" })).items).toHaveLength(0);
    await styles.deleteStyle(env.ctx, archived.id); // no history -> allowed
  });

  it("refuses to delete a style that has stock history", async () => {
    const env = await setup();
    const { style, cell } = await makePolo(env);
    await stock.adjustStock(env.ctx, { variantId: cell("Navy", "S").variantId, quantity: 1 });
    await expect(styles.deleteStyle(env.ctx, style.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
