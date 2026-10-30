import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT as summaryRoute } from "@/app/api/v1/ecommerce/daily-summaries/[date]/route";
import { GET as summariesRoute } from "@/app/api/v1/ecommerce/daily-summaries/route";
import { PUT as fixedRoute } from "@/app/api/v1/ecommerce/fixed-costs/[month]/route";
import { GET as fixedListRoute } from "@/app/api/v1/ecommerce/fixed-costs/route";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import * as stores from "@/modules/retail/stores.service";
import * as summaries from "@/modules/retail/summaries.service";

import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** The site's sample day (site-changes-v6 sec 2.6): costs 56,800, profit 35,300. */
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

/* A retail store's own books (plan v6 sec 6, 6a and 7). Today is 20 November 2026 in Dhaka. */
run("A retail store's daily summaries, fixed costs, budget and target (plan v6 sec 6)", () => {
  let shop: Shop;
  let store: Awaited<ReturnType<typeof stores.createStore>>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
    await resetDb();
    shop = await setupShop();
    await setPin(shop.owner, { pin: "2468" });
    store = await stores.createStore(shop.owner, {
      name: "Extas Retail",
      kind: "ONLINE",
      warehouseId: shop.warehouse.id,
      integrationId: shop.integration.id,
    });
  });
  afterEach(() => vi.useRealTimers());

  const put = (date: string, body: unknown) =>
    callShop(shop, summaryRoute, {
      method: "PUT",
      path: `/daily-summaries/${date}`,
      params: { date },
      body,
    });

  it("keeps every version of a day, never reads a missing figure as 0, and lists missing days", async () => {
    const first = await put("2026-11-15", sample("2026-11-15"));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ version: 1, profitMatches: true, changed: true });
    // The same body again changes nothing.
    expect((await put("2026-11-15", sample("2026-11-15"))).body).toMatchObject({
      version: 1,
      changed: false,
    });
    // The ads came in later: a second version.
    const noAds = sample("2026-11-18", { incomplete: ["ads"], netProfit: 41800 });
    delete (noAds.costs as Record<string, unknown>).ads;
    expect((await put("2026-11-18", noAds)).body).toMatchObject({
      version: 1,
      incomplete: ["ads"],
      profitMatches: true,
    });
    const withAds = await put("2026-11-18", sample("2026-11-18", { netProfit: 35000 }));
    expect(withAds.body).toMatchObject({ version: 2, profitMatches: false, checkedProfit: 35300 });

    // A figure neither sent nor listed as incomplete is refused; so is today.
    const bare = sample("2026-11-19");
    delete (bare as Record<string, unknown>).customers;
    expect((await put("2026-11-19", bare)).status).toBe(422);
    expect((await put("2026-11-20", sample("2026-11-20"))).status).toBe(422);

    const listed = await callShop(shop, summariesRoute, {
      path: "/daily-summaries?from=2026-11-01&to=2026-11-19",
    });
    expect(listed.body.days.map((d: { date: string }) => d.date)).toEqual([
      "2026-11-15",
      "2026-11-18",
    ]);
    expect(listed.body.missing).toEqual(["2026-11-16", "2026-11-17", "2026-11-19"]);

    const books = await summaries.storeBooks(shop.owner, store.id);
    expect(books.missing).toEqual(["2026-11-16", "2026-11-17", "2026-11-19"]);
    expect(books.days[0]).toMatchObject({
      date: "2026-11-18",
      versions: 2,
      previousProfit: "41800.00",
      profitMatches: false,
    });
    expect(books.fixed).toBeNull();
  });

  it("spreads the month's fixed costs over its days and compares spending with the budget", async () => {
    const fixed = await callShop(shop, fixedRoute, {
      method: "PUT",
      path: "/fixed-costs/2026-11",
      params: { month: "2026-11" },
      body: {
        month: "2026-11",
        costs: { salary: 45000, rent: 20000, utilities: 4500, other: 2000 },
        note: "salary raised from November",
      },
    });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body).toMatchObject({ version: 1, total: 71500 });
    const months = await callShop(shop, fixedListRoute, { path: "/fixed-costs" });
    expect(months.body.months).toHaveLength(1);

    await summaries.setBudget(shop.owner, store.id, {
      month: "2026-11",
      ads: "5000",
      packaging: "2000",
      salary: "",
    });
    await summaries.setTarget(shop.owner, store.id, { month: "2026-11", sales: "200000" });
    await put("2026-11-02", sample("2026-11-02"));

    const books = await summaries.storeBooks(shop.owner, store.id);
    expect(books.fixed).toMatchObject({ total: 71500, perDay: "2383.33" });
    // 19 days so far: 35,300 - 19 x 2,383.33.
    expect(books.monthSoFar).toMatchObject({ netProfit: "35300.00", afterFixed: "-9983.33" });
    expect(Object.fromEntries(books.budget.map((b) => [b.line, b.state]))).toEqual({
      ads: "RED",
      packaging: "YELLOW",
      delivery: "NONE",
      salary: "NONE",
      other: "NONE",
    });
    expect(books.target).toMatchObject({ done: "88400.00", percent: 44 });
    const alarms = await prisma.notificationLog.findMany({
      where: { subject: { contains: "budget passed" } },
    });
    expect(alarms.length).toBeGreaterThan(0);

    // "Copy last month" needs a budget last month.
    await expect(
      summaries.copyLastMonthBudget(shop.owner, store.id, "2026-12"),
    ).resolves.toBeUndefined();
    await expect(summaries.copyLastMonthBudget(shop.owner, store.id, "2026-10")).rejects.toThrow(
      "no budget",
    );
  });

  it("asks the site for missing days from 01:00, hourly, and tells the owner from 09:00", async () => {
    await put("2026-11-17", sample("2026-11-17"));
    // 00:30 in Dhaka: the site's own time to send.
    expect(await summaries.summaryGuards(new Date("2026-11-19T18:30:00Z"))).toBe(0);
    expect(await summaries.summaryGuards(new Date("2026-11-19T20:00:00Z"))).toBe(1);
    expect(await summaries.summaryGuards(new Date("2026-11-19T20:30:00Z"))).toBe(0);
    const asked = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventType: "summary.missing" },
    });
    expect((asked.payload as { data: { dates: string[] } }).data.dates).toEqual([
      "2026-11-18",
      "2026-11-19",
    ]);
    expect(
      await prisma.notificationLog.count({ where: { subject: { contains: "figures missing" } } }),
    ).toBe(0);
    await summaries.summaryGuards(new Date("2026-11-20T03:30:00Z"));
    await summaries.summaryGuards(new Date("2026-11-20T04:30:00Z"));
    const told = await prisma.notificationLog.findMany({
      where: { subject: { contains: "figures missing" } },
    });
    expect(new Set(told.map((t) => t.body)).size).toBe(1);
  });
});
