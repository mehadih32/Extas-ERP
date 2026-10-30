import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT as summaryRoute } from "@/app/api/v1/ecommerce/daily-summaries/[date]/route";
import { PUT as fixedRoute } from "@/app/api/v1/ecommerce/fixed-costs/[month]/route";
import * as dashboards from "@/modules/retail/dashboards.service";
import * as stores from "@/modules/retail/stores.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** The site's sample day (site-changes-v6 sec 2.6): profit 35,300 with 6,500 of ads. */
const sample = (date: string, extra: Record<string, unknown> = {}) => ({
  date,
  orders: { count: 42, pieces: 61 },
  sales: { gross: 98500, discounts: 6200, customerReturns: 3900, net: 88400 },
  income: { deliveryCharges: 3700 },
  deliveries: { delivered: 37, failed: 2, returned: 3, codPending: 21500 },
  costs: {
    goods: 41250,
    returnLosses: 650,
    packaging: 1850,
    delivery: 4600,
    paymentFees: 650,
    accessories: 400,
    ads: { facebook: 5200, instagram: 0, google: 1300, tiktok: 0, other: 0 },
    other: 900,
  },
  returns: { handedBackPieces: 4, approvedCredit: 2600, waitingCheckValue: 11700 },
  customers: { new: 18, returning: 11 },
  incomplete: [],
  netProfit: 35300,
  ...extra,
});

/* The three dashboards (plan v6 sec 10). Today is Friday 20 November 2026 in Dhaka. */
run("The Business dashboards (plan v6 sec 10)", () => {
  let shop: Shop;
  let store: Awaited<ReturnType<typeof stores.createStore>>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
    await resetDb();
    shop = await setupShop();
    store = await stores.createStore(shop.owner, {
      name: "Extas Retail",
      kind: "ONLINE",
      warehouseId: shop.warehouse.id,
      integrationId: shop.integration.id,
    });
    const put = (date: string, body: unknown) =>
      callShop(shop, summaryRoute, {
        method: "PUT",
        path: `/daily-summaries/${date}`,
        params: { date },
        body,
      });
    await put("2026-11-15", sample("2026-11-15"));
    // The 18th first came without the ads, then again with them.
    const noAds = sample("2026-11-18", { incomplete: ["ads"], netProfit: 41800 });
    delete (noAds.costs as Record<string, unknown>).ads;
    await put("2026-11-18", noAds);
    await put("2026-11-18", sample("2026-11-18"));
    await callShop(shop, fixedRoute, {
      method: "PUT",
      path: "/fixed-costs/2026-11",
      params: { month: "2026-11" },
      body: {
        month: "2026-11",
        costs: { salary: 45000, rent: 20000, utilities: 4500, other: 2000 },
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("reads the period from the address bar, with the same number of days before it", () => {
    expect(dashboards.periodOf(shop.owner, {})).toMatchObject({
      key: "month",
      from: "2026-11-01",
      to: "2026-11-20",
      previous: { from: "2026-10-12", to: "2026-10-31" },
    });
    // The week starts on Saturday.
    expect(dashboards.periodOf(shop.owner, { period: "week" })).toMatchObject({
      from: "2026-11-14",
    });
    expect(dashboards.periodOf(shop.owner, { from: "2026-11-02", to: "2026-11-03" })).toMatchObject(
      { key: "custom", previous: { from: "2026-10-31", to: "2026-11-01" } },
    );
    expect(dashboards.periodOf(shop.owner, { period: "all" }).previous).toBeNull();
    // A wrong value falls back to this month, never an error page.
    expect(dashboards.periodOf(shop.owner, { period: "nonsense" }).key).toBe("month");
  });

  it("works out a store's dashboard from its newest figures less its fixed costs", async () => {
    const d = await dashboards.storeDashboard(shop.owner, store.id);
    // Two days of 35,300 less 5 days (15th to 19th) of 71,500 / 30.
    expect(d).toMatchObject({
      sales: "176800.00",
      profit: "58683.33",
      margin: 33.2,
      ads: { spend: "13000.00", roas: 13.6, perNewCustomer: "361.11" },
      customers: { new: 36, returning: 22, repeatRate: 37.9, perOrder: "2104.76" },
      delivery: { successRate: 88.1, returnRate: 7.1, codPending: "21500.00" },
      previous: { sales: "0.00", profit: "0.00" },
      fixedMissing: [],
      incomplete: [],
    });
    expect(d.costSplit.find((c) => c.line === "fixed")).toMatchObject({ amount: "11916.67" });
    expect(d.erp).toMatchObject({ taken: "0.00", erpProfit: "0.00" });

    const e = await dashboards.ecommercePage(shop.owner);
    expect(e.totals).toMatchObject({ sales: "176800.00", profit: "58683.33", orders: 84 });
    expect(e.stores).toEqual([
      expect.objectContaining({ name: "Extas Retail", sales: "176800.00", margin: 33.2 }),
    ]);
  });

  it("puts both businesses together on the Overview and says why profit changed", async () => {
    const o = await dashboards.overviewPage(shop.owner);
    const card = Object.fromEntries(o.cards.map((c) => [c.key, c]));
    expect(card.retail).toMatchObject({ value: "58683.33", change: "58683.33" });
    expect(card.sales!.value).toBe("176800.00");
    expect(Number(card.profit!.value)).toBeCloseTo(Number(card.erp!.value) + 58683.33, 2);
    expect(o.changes).toEqual([
      expect.objectContaining({
        store: "Extas Retail",
        was: "41800.00",
        now: "35300.00",
        lines: [{ figure: "costs.ads", was: "0.00", now: "6500.00" }],
      }),
    ]);
    expect(o.chart.find((r) => r.bucket === "2026-11-15")).toMatchObject({ retail: 32917 });
    expect(o.missingStores).toEqual([
      expect.objectContaining({ days: ["2026-11-16", "2026-11-17", "2026-11-19"] }),
    ]);
  });
});
