import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET as variantsRoute } from "@/app/api/v1/ecommerce/catalog/variants/route";
import { GET as stockOneRoute } from "@/app/api/v1/ecommerce/stock/[sku]/route";
import { GET as stockRoute } from "@/app/api/v1/ecommerce/stock/route";
import { prisma } from "@/lib/prisma";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const variants = (shop: Shop, path: string) => callShop(shop, variantsRoute, { path });
const stock = (shop: Shop, path: string) => callShop(shop, stockRoute, { path });
const stockOf = (shop: Shop, sku: string) =>
  callShop<{ sku: string }>(shop, stockOneRoute, {
    path: `/stock/${encodeURIComponent(sku)}`,
    params: { sku },
  });

/** Every page of a list, following nextCursor. */
async function allPages(fetch: (cursor?: string) => ReturnType<typeof variants>) {
  const pages = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(cursor);
    expect(res.status).toBe(200);
    pages.push(res.body.data as Array<Record<string, unknown>>);
    cursor = res.body.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}

run("E-commerce API: catalog and stock (CN-005)", () => {
  let shop: Shop;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
  });

  it("lists every variant with its prices, cost and active flag, inactive ones too", async () => {
    const navyS = shop.sku("EX-PL-001", "Navy", "S");
    await prisma.productVariant.update({
      where: { companyId_sku: { companyId: shop.company.id, sku: navyS } },
      data: { retailPrice: 1350, barcode: "8900000000017" },
    });
    await prisma.style.update({ where: { id: shop.tee.id }, data: { isActive: false } });
    const removed = shop.sku("EX-PL-001", "White", "L");
    await prisma.productVariant.update({
      where: { companyId_sku: { companyId: shop.company.id, sku: removed } },
      data: { removedAt: new Date() },
    });

    const res = await variants(shop, "/catalog/variants");
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.sku === navyS)).toEqual({
      sku: navyS,
      barcode: "8900000000017",
      styleCode: "EX-PL-001",
      styleName: "Classic Polo",
      color: "Navy",
      size: "S",
      retailPrice: 1350,
      avgCost: 500,
      active: true,
      updatedAt: expect.any(String),
    });
    expect(rows.find((r) => r.sku === shop.sku("EX-PL-001", "Navy", "M"))).toMatchObject({
      retailPrice: 1450,
      barcode: null,
    });
    expect(rows.find((r) => r.sku === removed)?.active).toBe(false);
    expect(rows.find((r) => r.styleCode === "EX-TS-002")).toMatchObject({
      active: false,
      avgCost: 0,
      retailPrice: 600,
    });
  });

  it("pages by a stable cursor and refuses a bad cursor or limit", async () => {
    const pages = await allPages((cursor) =>
      variants(shop, `/catalog/variants?limit=3${cursor ? `&cursor=${cursor}` : ""}`),
    );
    expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
    const skus = pages.flat().map((r) => r.sku);
    expect(new Set(skus).size).toBe(7);

    for (const bad of ["nonsense!", "abc", Buffer.from("v2:x").toString("base64url")]) {
      const res = await variants(shop, `/catalog/variants?cursor=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION");
    }
    expect((await variants(shop, "/catalog/variants?limit=0")).status).toBe(422);
    expect((await variants(shop, "/catalog/variants?limit=501")).status).toBe(422);
    expect((await variants(shop, "/catalog/variants?updatedSince=yesterday")).status).toBe(422);
    // Empty fields, as in the contract's ?updatedSince=&cursor=&limit=, count as not sent.
    const empty = await variants(shop, "/catalog/variants?updatedSince=&cursor=&limit=");
    expect(empty.status).toBe(200);
    expect(empty.body.data).toHaveLength(7);
  });

  it("gives what changed after updatedSince: the variant's or its style's change", async () => {
    const since = new Date(Date.now() + 1000);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const at = encodeURIComponent(since.toISOString());
    expect((await variants(shop, `/catalog/variants?updatedSince=${at}`)).body.data).toEqual([]);

    await prisma.style.update({ where: { id: shop.tee.id }, data: { retailPrice: 650 } });
    const navyS = shop.sku("EX-PL-001", "Navy", "S");
    await prisma.productVariant.update({
      where: { companyId_sku: { companyId: shop.company.id, sku: navyS } },
      data: { isActive: false },
    });
    const res = await variants(shop, `/catalog/variants?updatedSince=${at}`);
    const rows = res.body.data as Array<{ sku: string; active: boolean; retailPrice: number }>;
    expect(rows.map((r) => r.sku).sort()).toEqual(
      [navyS, shop.sku("EX-TS-002", "White", "S")].sort(),
    );
    expect(rows.find((r) => r.sku === navyS)?.active).toBe(false);
    expect(rows.find((r) => r.sku !== navyS)?.retailPrice).toBe(650);
  });

  it("never shows another company's variants or stock, and refuses a missing key", async () => {
    const other = await setupShop("Other Co");
    // Both companies have the same 7 SKUs: each shop sees only its own company's.
    const res = await variants(shop, "/catalog/variants?limit=500");
    expect(res.body.data).toHaveLength(7);
    expect((await variants(other, "/catalog/variants?limit=500")).body.data).toHaveLength(7);
    expect((await stock(shop, "/stock")).body.data).toHaveLength(6);
    const ours = await stock(shop, "/stock");
    expect(
      ours.body.data.every((r: { warehouseId: string }) => r.warehouseId === shop.warehouse.id),
    ).toBe(true);
    const theirs = await stock(shop, `/stock?warehouseId=${other.warehouse.id}`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.code).toBe("NOT_FOUND");

    for (const call of [
      callShop(shop, variantsRoute, { path: "/catalog/variants", key: null }),
      callShop(shop, stockRoute, { path: "/stock", key: "wrong-key" }),
      callShop<{ sku: string }>(shop, stockOneRoute, {
        path: "/stock/x",
        params: { sku: "x" },
        key: null,
      }),
    ]) {
      const refused = await call;
      expect(refused.status).toBe(401);
      expect(refused.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("lists A-grade stock per SKU per warehouse, by warehouse and updatedSince", async () => {
    const res = await stock(shop, "/stock");
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({
      sku: expect.any(String),
      warehouseId: shop.warehouse.id,
      warehouseName: shop.warehouse.name,
      onHand: 10,
      reserved: 0,
      available: 10,
      updatedAt: expect.any(String),
    });

    // A second warehouse, a deleted one and B-grade pieces.
    const navyS = shop.variants.find((v) => v.sku === shop.sku("EX-PL-001", "Navy", "S"))!;
    const outlet = await prisma.warehouse.create({
      data: { companyId: shop.company.id, name: "Outlet" },
    });
    const closed = await prisma.warehouse.create({
      data: { companyId: shop.company.id, name: "Closed", deletedAt: new Date() },
    });
    await prisma.stockBalance.createMany({
      data: [
        {
          companyId: shop.company.id,
          variantId: navyS.id,
          warehouseId: outlet.id,
          quantity: 4,
          reserved: 6,
        },
        { companyId: shop.company.id, variantId: navyS.id, warehouseId: closed.id, quantity: 9 },
        {
          companyId: shop.company.id,
          variantId: navyS.id,
          warehouseId: shop.warehouse.id,
          grade: "B_GRADE",
          quantity: 3,
        },
      ],
    });
    const all = await stock(shop, "/stock");
    expect(all.body.data).toHaveLength(7);
    const atOutlet = await stock(shop, `/stock?warehouseId=${outlet.id}`);
    expect(atOutlet.body.data).toEqual([
      expect.objectContaining({ sku: navyS.sku, onHand: 4, reserved: 6, available: 0 }),
    ]);
    expect((await stock(shop, `/stock?warehouseId=${closed.id}`)).status).toBe(404);
    expect((await stock(shop, "/stock?warehouseId=nope")).status).toBe(404);

    const pages = await allPages((cursor) =>
      stock(shop, `/stock?limit=4${cursor ? `&cursor=${cursor}` : ""}`),
    );
    expect(pages.map((p) => p.length)).toEqual([4, 3]);

    const since = new Date(Date.now() + 1000);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await prisma.stockBalance.update({
      where: {
        variantId_warehouseId_grade: {
          variantId: navyS.id,
          warehouseId: shop.warehouse.id,
          grade: "A_GRADE",
        },
      },
      data: { quantity: 7 },
    });
    const changed = await stock(
      shop,
      `/stock?updatedSince=${encodeURIComponent(since.toISOString())}`,
    );
    expect(changed.body.data).toEqual([
      expect.objectContaining({ sku: navyS.sku, warehouseId: shop.warehouse.id, onHand: 7 }),
    ]);
  });

  it("gives one SKU's live stock, the shop's own warehouse on top", async () => {
    const navyS = shop.variants.find((v) => v.sku === shop.sku("EX-PL-001", "Navy", "S"))!;
    const outlet = await prisma.warehouse.create({
      data: { companyId: shop.company.id, name: "A Outlet" },
    });
    await prisma.stockBalance.create({
      data: {
        companyId: shop.company.id,
        variantId: navyS.id,
        warehouseId: outlet.id,
        quantity: 4,
      },
    });
    const res = await stockOf(shop, navyS.sku);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sku: navyS.sku,
      active: true,
      available: 10,
      warehouses: [
        expect.objectContaining({ warehouseId: outlet.id, onHand: 4, available: 4 }),
        expect.objectContaining({ warehouseId: shop.warehouse.id, onHand: 10, available: 10 }),
      ],
    });

    const tee = await stockOf(shop, shop.sku("EX-TS-002", "White", "S"));
    expect(tee.body).toEqual({
      sku: shop.sku("EX-TS-002", "White", "S"),
      active: true,
      available: 0,
      warehouses: [],
    });
    const unknown = await stockOf(shop, "NO-SUCH-SKU");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("NOT_FOUND");

    // A shop with no warehouse of its own sees 0 on top, and every warehouse below.
    await prisma.salesChannelIntegration.update({
      where: { id: shop.integration.id },
      data: { warehouseId: null },
    });
    const none = await stockOf(shop, navyS.sku);
    expect(none.body.available).toBe(0);
    expect(none.body.warehouses).toHaveLength(2);
  });
});
