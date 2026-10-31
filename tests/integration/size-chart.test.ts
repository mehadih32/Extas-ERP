import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET as sizeChartsRoute } from "@/app/api/v1/ecommerce/catalog/size-charts/route";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { scanShopChanges } from "@/modules/ecommerce/webhooks";
import * as charts from "@/modules/inventory/size-chart.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const later = async () => new Promise((resolve) => setTimeout(resolve, 5));

async function appError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

/*
 * A style's size chart (2026-10-31): kept per size, filled from the tech pack
 * with one button, and sent to the shops through the API and a webhook.
 */
run("Size charts: on the style, from the tech pack, to the shops", () => {
  let shop: Shop;
  beforeEach(async () => {
    await resetDb();
    shop = await setupShop();
    await later();
  });

  const sizeId = (name: string) =>
    shop.variants.find((v) => v.styleId === shop.polo.id && v.size.name === name)!.sizeId;

  it("saves a chart for the style's own sizes, refuses a measurement twice and people without the right", async () => {
    const empty = await charts.getSizeChart(shop.owner, shop.polo.id);
    expect(empty.saved).toBe(false);
    expect(empty.sizes.map((s) => s.name)).toEqual(["S", "M", "L"]);
    expect(empty.points.map((p) => p.name)).toEqual([
      "Chest",
      "Body length",
      "Shoulder",
      "Sleeve length",
    ]);

    const saved = await charts.saveSizeChart(shop.owner, shop.polo.id, {
      garment: "TOP",
      unit: "INCH",
      points: [
        { name: "Chest", values: { [sizeId("S")]: "38", [sizeId("M")]: 40.25, other: 1 } },
        { name: "Body length", values: { [sizeId("S")]: "", [sizeId("L")]: 30 } },
      ],
    });
    expect(saved.saved).toBe(true);
    expect(saved.points).toEqual([
      { name: "Chest", values: { [sizeId("S")]: 38, [sizeId("M")]: 40.25 } },
      { name: "Body length", values: { [sizeId("L")]: 30 } },
    ]);

    const twice = await appError(
      charts.saveSizeChart(shop.owner, shop.polo.id, {
        points: [
          { name: "Chest", values: {} },
          { name: "chest", values: {} },
        ],
      }),
    );
    expect(twice.code).toBe("VALIDATION");
    const viewer = { ...shop.owner, can: (k: string) => k !== "inventory.manage" };
    expect(
      (await appError(charts.saveSizeChart(viewer as typeof shop.owner, shop.polo.id, {}))).code,
    ).toBe("FORBIDDEN");
  });

  it("fills from the style's tech pack without saving", async () => {
    const pack = await prisma.techPack.create({
      data: {
        companyId: shop.company.id,
        number: "TP-2026-00001",
        styleId: shop.polo.id,
        measureUnit: "CM",
      },
    });
    await prisma.techPackMeasurement.create({
      data: {
        companyId: shop.company.id,
        techPackId: pack.id,
        code: "A",
        name: "Chest width",
        tolerance: 1,
        values: { S: 96.5, m: 101.5, XL: 110 },
        sources: {},
      },
    });
    expect((await charts.getSizeChart(shop.owner, shop.polo.id)).hasTechPack).toBe(true);
    const filled = await charts.sizeChartFromTechPack(shop.owner, shop.polo.id);
    expect(filled).toMatchObject({ techPack: "TP-2026-00001", unit: "CM" });
    expect(await prisma.styleSizeChart.count()).toBe(0);
    expect(filled.points).toEqual([
      { name: "Chest width", values: { [sizeId("S")]: 96.5, [sizeId("M")]: 101.5 } },
    ]);
    expect(filled.left).toBe(0);

    // A name twice is taken once; past 20 measurements the rest are left out (and counted).
    for (let i = 0; i < 22; i++) {
      await prisma.techPackMeasurement.create({
        data: {
          companyId: shop.company.id,
          techPackId: pack.id,
          code: `B${i}`,
          name: i === 0 ? "chest width" : `Point ${i}`,
          tolerance: 1,
          sortOrder: i + 1,
          values: { S: 10 },
          sources: {},
        },
      });
    }
    const many = await charts.sizeChartFromTechPack(shop.owner, shop.polo.id);
    expect(many.points).toHaveLength(20);
    expect(many.points.filter((p) => p.name.toLowerCase() === "chest width")).toHaveLength(1);
    expect(many.left).toBe(2);
    // What it fills saves as it is.
    await charts.saveSizeChart(shop.owner, shop.polo.id, { unit: many.unit, points: many.points });
  });

  it("gives the shops the chart by size name, and a size_chart.changed once per change", async () => {
    await charts.saveSizeChart(shop.owner, shop.polo.id, {
      garment: "TOP",
      unit: "INCH",
      points: [{ name: "Chest", values: { [sizeId("S")]: 38, [sizeId("M")]: 40 } }],
    });
    const chart = {
      styleCode: "EX-PL-001",
      styleName: "Classic Polo",
      unit: "inch",
      sizes: ["S", "M", "L"],
      points: [{ name: "Chest", values: { S: 38, M: 40, L: null } }],
    };

    const res = await callShop(shop, sizeChartsRoute, { path: "/catalog/size-charts" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ ...chart, updatedAt: expect.any(String) }]);
    expect(res.body.nextCursor).toBeNull();
    const none = await callShop(shop, sizeChartsRoute, {
      path: `/catalog/size-charts?updatedSince=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
    });
    expect(none.body.data).toEqual([]);

    await scanShopChanges();
    const sent = await prisma.webhookEvent.findMany({
      where: { integrationId: shop.integration.id, eventType: "size_chart.changed" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.externalId).toBe("EX-PL-001");
    expect(sent[0]!.payload).toMatchObject({ type: "size_chart.changed", data: chart });

    // Nothing new: nothing sent again.
    await later();
    await scanShopChanges();
    expect(
      await prisma.webhookEvent.count({
        where: { integrationId: shop.integration.id, eventType: "size_chart.changed" },
      }),
    ).toBe(1);
  });
});
