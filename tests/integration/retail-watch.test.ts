import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT as summaryRoute } from "@/app/api/v1/ecommerce/daily-summaries/[date]/route";
import { prisma } from "@/lib/prisma";
import { standInForClaude } from "@/modules/ai/claude";
import { setAiSwitch, setApiKey } from "@/modules/ai/settings.service";
import * as stores from "@/modules/retail/stores.service";
import * as watch from "@/modules/retail/watch.service";

import { claudeMessage } from "../fixtures/claude";
import { callShop, type Shop, setupShop } from "./ecommerce-helpers";
import { resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const day = (date: string, net: number, returned: number, ads: number) => ({
  date,
  orders: { count: 40, pieces: 60 },
  sales: { gross: net, discounts: 0, customerReturns: 0, net },
  income: { deliveryCharges: 0 },
  deliveries: { delivered: 40 - returned, failed: 0, returned, codPending: 0 },
  costs: {
    goods: 0,
    returnLosses: 0,
    packaging: 0,
    delivery: 0,
    paymentFees: 0,
    accessories: 0,
    ads: { facebook: ads, instagram: 0, google: 0, tiktok: 0, other: 0 },
    other: 0,
  },
  returns: { handedBackPieces: 0, approvedCredit: 0, waitingCheckValue: 0 },
  customers: { new: 10, returning: 5 },
  incomplete: [],
  netProfit: net - ads,
});

/* The night summary, its alerts and the AI's advice (plan v6 sec 13). Saturday 21 November 2026. */
run("The retail night watch (plan v6 sec 13)", () => {
  let shop: Shop;
  let store: Awaited<ReturnType<typeof stores.createStore>>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T06:00:00Z"));
    vi.stubEnv("AI_API_KEY", "");
    await resetDb();
    shop = await setupShop();
    await prisma.user.update({ where: { id: shop.owner.user.id }, data: { isSuperAdmin: true } });
    store = await stores.createStore(shop.owner, {
      name: "Extas Retail",
      kind: "ONLINE",
      warehouseId: shop.warehouse.id,
      integrationId: shop.integration.id,
    });
    // A steady week, then a bad Friday: sales halved, many parcels back, ads brought little.
    for (let d = 13; d <= 19; d++) {
      const date = `2026-11-${d}`;
      await callShop(shop, summaryRoute, {
        method: "PUT",
        path: `/daily-summaries/${date}`,
        params: { date },
        body: day(date, 80000, 2, 4000),
      });
    }
    await callShop(shop, summaryRoute, {
      method: "PUT",
      path: "/daily-summaries/2026-11-20",
      params: { date: "2026-11-20" },
      body: day("2026-11-20", 30000, 8, 6000),
    });
  });
  afterEach(() => {
    standInForClaude(null);
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("sends the night summary once at 22:00 with its alerts, even with the AI off", async () => {
    expect(await watch.retailWatch(new Date("2026-11-21T15:00:00Z"))).toBe(0); // 21:00 in Dhaka
    expect(await watch.retailWatch(new Date("2026-11-21T16:05:00Z"))).toBe(1);
    expect(await watch.retailWatch(new Date("2026-11-21T16:30:00Z"))).toBe(0);
    const kinds = (await prisma.retailAlert.findMany()).map((a) => a.kind).sort();
    expect(kinds).toEqual(["NIGHT", "RETURNS_UP", "ROAS_FELL", "SALES_FELL"]);
    const [note] = await prisma.notificationLog.findMany({
      where: { subject: "Retail tonight" },
    });
    expect(note!.body).toContain("Extas Retail, 2026-11-20: net sales");
    expect(note!.body).toContain("sales fell");
    // The AI is off: no weekly advice, and the button says so.
    await expect(watch.storeAnalysis(shop.owner, store.id)).rejects.toThrow("The AI is off");
  });

  it("gives the AI's advice on the button and on Saturday night while the AI is on", async () => {
    await setAiSwitch(shop.owner, true);
    await setApiKey(shop.owner, { key: "sk-ant-api03-test0123456789abcdWXYZ" });
    const asked: string[] = [];
    standInForClaude(async ({ body }) => {
      asked.push(JSON.stringify(body.messages));
      return claudeMessage(
        [{ type: "text", text: "1. Buy EX-PL-001 again.", citations: null }],
        body.model,
      );
    });
    const advice = await watch.storeAnalysis(shop.owner, store.id, { period: "7d" });
    expect(advice.text).toBe("1. Buy EX-PL-001 again.");
    expect(asked[0]).toContain("roas");

    await watch.retailWatch(new Date("2026-11-21T16:05:00Z"));
    expect(await prisma.retailAlert.findFirst({ where: { kind: "WEEKLY" } })).toMatchObject({
      text: "1. Buy EX-PL-001 again.",
    });
    // Advice only: no record was changed by it.
    expect(await prisma.auditLog.count({ where: { byAi: true } })).toBe(0);
  });
});
