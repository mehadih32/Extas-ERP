import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { PIN_CHECKED } from "@/modules/ai/settings.service";
import * as stores from "@/modules/retail/stores.service";
import * as summaries from "@/modules/retail/summaries.service";

import { SAMPLE_SHOP } from "./cn005-shop";

/*
 * The retail sample on the demo site (plan v6, part 1): the store "Extas
 * Retail", tied to the sample online shop when it is there, with a rule for
 * each grade and one hand price on a style that has a cost, so Business >
 * Retail stores and the store's page (and their Help pictures) show something;
 * and three weeks of the site's daily figures (one day sent twice), this and
 * last month's fixed costs, a budget and a sales target, so the dashboards,
 * "Why profit changed" and the downloads have figures.
 * Once: when the store is there already it does nothing.
 */

export async function loadRetailStore(ctx: CompanyContext) {
  const there = await prisma.retailStore.findFirst({
    where: { companyId: ctx.company.id, name: stores.FIRST_STORE_NAME },
    select: { id: true },
  });
  if (there) return null;
  const shop = await prisma.salesChannelIntegration.findFirst({
    where: { companyId: ctx.company.id, name: SAMPLE_SHOP },
    select: { id: true, warehouseId: true },
  });
  const store = await stores.createStore(ctx, {
    name: stores.FIRST_STORE_NAME,
    kind: "ONLINE",
    warehouseId: shop?.warehouseId ?? "",
    integrationId: shop?.id ?? "",
    address: "House 12, Road 4, Uttara, Dhaka",
    phone: "01700-000000",
  });
  await stores.setPriceRules(
    ctx,
    store.id,
    { aRule: "PERCENT", aValue: "40", bRule: "FIXED", bValue: "350" },
    undefined,
    PIN_CHECKED,
  );
  const variant = await prisma.productVariant.findFirst({
    where: { companyId: ctx.company.id, avgCost: { gt: 0 } },
    orderBy: { createdAt: "asc" },
    select: { styleId: true, avgCost: true },
  });
  if (variant) {
    await stores.setHandPrice(
      ctx,
      {
        storeId: store.id,
        grade: "A",
        styleId: variant.styleId,
        price: String(Math.ceil(Number(variant.avgCost) * 1.5)),
      },
      undefined,
      PIN_CHECKED,
    );
  }
  await sampleFigures(ctx, { id: store.id, companyId: ctx.company.id, name: store.name });
  return { name: store.name, handPrice: Boolean(variant) };
}

/** A day of the site's figures; `n` varies it so the chart is not flat. */
function sampleDay(date: string, n: number, adsIn = true) {
  const net = 60000 + ((n * 7919) % 35000);
  const ads = 3000 + ((n * 131) % 3000);
  const costs = {
    goods: Math.round(net * 0.47),
    returnLosses: 300 + ((n * 37) % 500),
    packaging: 1200,
    delivery: 3600,
    paymentFees: 450,
    accessories: 300,
    ...(adsIn ? { ads: { facebook: ads, instagram: 0, google: 0, tiktok: 0, other: 0 } } : {}),
    other: 500,
  };
  const spent = Object.values(costs).reduce<number>(
    (t, v) => t + (typeof v === "number" ? v : v.facebook),
    0,
  );
  return {
    date,
    orders: { count: 30 + (n % 15), pieces: 45 + (n % 20) },
    sales: { gross: net + 4000, discounts: 3000, customerReturns: 1000, net },
    income: { deliveryCharges: 2500 },
    deliveries: { delivered: 28 + (n % 10), failed: 1, returned: 2 + (n % 4), codPending: 18000 },
    costs,
    returns: { handedBackPieces: 3, approvedCredit: 1800, waitingCheckValue: 6500 },
    customers: { new: 12 + (n % 9), returning: 8 + (n % 5) },
    incomplete: adsIn ? [] : ["ads"],
    netProfit: net + 2500 - spent,
  };
}

async function sampleFigures(
  ctx: CompanyContext,
  store: { id: string; companyId: string; name: string },
) {
  const today = localDay(new Date(), ctx.company.timezone);
  for (let i = 21; i >= 1; i--) {
    const date = addDays(today, -i);
    // The day before yesterday came first without its ads, then again with them.
    if (i === 2) await summaries.putDailySummary(ctx, store, date, sampleDay(date, i, false));
    await summaries.putDailySummary(ctx, store, date, sampleDay(date, i));
  }
  const month = today.slice(0, 7);
  const last = addDays(`${month}-01`, -1).slice(0, 7);
  for (const m of [last, month]) {
    await summaries.putFixedCosts(ctx, store, m, {
      month: m,
      costs: { salary: 45000, rent: 20000, utilities: 4500, other: 2000 },
    });
  }
  await summaries.setBudget(ctx, store.id, {
    month,
    ads: "150000",
    packaging: "40000",
    delivery: "110000",
    salary: "45000",
    other: "",
  });
  await summaries.setTarget(ctx, store.id, { month, sales: "2500000" });
}
