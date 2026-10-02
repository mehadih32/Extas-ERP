import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as assets from "@/modules/accounts/asset.service";
import * as capital from "@/modules/accounts/capital.service";
import { addDays } from "@/modules/accounts/periods";
import * as accountReports from "@/modules/accounts/reports.service";
import type { CompanyContext } from "@/modules/auth/context";
import { getMetricCards } from "@/modules/dashboard/cards.service";
import { getDashboardInsights } from "@/modules/dashboard/insights.service";
import {
  getDashboardPreferences,
  updateDashboardPreferences,
} from "@/modules/dashboard/preferences.service";
import { salesByBucket, salesTotals, topSellers } from "@/modules/dashboard/sales-figures";
import * as files from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as reports from "@/modules/reports/export.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
const DAY_MS = 24 * 60 * 60 * 1000;
const META = { ipAddress: "203.0.113.7", userAgent: "vitest" };

/**
 * A company with one person per built-in role, a polo style (Navy / White x
 * S M L XL, retail 1450, wholesale 900) and a tee style (Black x M L). No stock:
 * each test stocks what it needs.
 */
async function setup(companyName = "Extras") {
  const { company, roles } = await makeCompany(companyName);
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const admin = await member("SUPER_ADMIN", "admin");
  const accounts = await member("ACCOUNTS", "accounts");
  const sales = await member("SALES_EXECUTIVE", "sales");
  const production = await member("PRODUCTION_MANAGER", "production");
  const employee = await member("EMPLOYEE", "employee");

  const sizes = [];
  for (const name of ["S", "M", "L", "XL"]) sizes.push(await catalog.createSize(admin, { name }));
  const navy = await catalog.createColor(admin, { name: "Navy", hexCode: "#1F2A44" });
  const white = await catalog.createColor(admin, { name: "White", hexCode: "#FFFFFF" });
  const black = await catalog.createColor(admin, { name: "Black", hexCode: "#000000" });
  const tops = await catalog.createCategory(admin, { name: "Tops" });
  const polo = await styles.createStyle(admin, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(admin, polo.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const tee = await styles.createStyle(admin, {
    code: "EX-TS-002",
    name: "Basic Tee",
    categoryId: tops.id,
    retailPrice: 600,
    wholesalePrice: 400,
  });
  await matrix.generateMatrix(admin, tee.id, {
    colorIds: [black.id],
    sizeIds: [sizes[1]!.id, sizes[2]!.id],
  });
  const variants = await prisma.productVariant.findMany({ where: { companyId: company.id } });
  /** Variant id of a SKU code, e.g. id("EX-PL-001-NAVY-M"). */
  const id = (sku: string) => variants.find((v) => v.sku === sku)!.id;
  return { company, admin, accounts, sales, production, employee, polo, tee, id };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/** Opening stock, optionally dated `daysAgo` days back (as if it had been held that long). */
async function stockUp(
  env: Env,
  sku: string,
  quantity: number,
  opts: { unitCost?: number; daysAgo?: number; grade?: "A_GRADE" | "B_GRADE" } = {},
) {
  const variantId = env.id(sku);
  const before = new Date();
  await stock.adjustStock(env.admin, {
    variantId,
    quantity,
    type: "OPENING",
    unitCost: opts.unitCost ?? 500,
    grade: opts.grade ?? "A_GRADE",
  });
  if (opts.daysAgo) {
    await prisma.stockMovement.updateMany({
      where: { variantId, createdAt: { gte: before } },
      data: { createdAt: new Date(Date.now() - opts.daysAgo * DAY_MS) },
    });
  }
}

type Line = [sku: string, quantity: number, unitPrice?: number];

/** A shop sale, invoiced now or at `issueDate`. */
async function sell(
  env: Env,
  lines: Line[],
  opts: { discount?: number; issueDate?: Date; channel?: "POS" | "WEBSITE" } = {},
) {
  const order = await orders.createOrder(env.admin, {
    channel: opts.channel ?? "POS",
    lines: lines.map(([sku, quantity, unitPrice]) => ({
      variantId: env.id(sku),
      quantity,
      unitPrice,
    })),
    discount: opts.discount,
    documents: { invoice: false },
  });
  const invoice = await documents.issueInvoice(
    env.admin,
    order.id,
    opts.issueDate ? { issueDate: opts.issueDate } : {},
  );
  return { order, invoice };
}

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);
const today = () => localDay(new Date(), TZ);
const todayRange = () => ({
  start: startOfDayInZone(today(), TZ),
  end: startOfDayInZone(addDays(today(), 1), TZ),
});

/** What the books show in the Sales account between two instants. */
async function ledgerSales(companyId: string, range: { start: Date; end: Date }) {
  const [row] = await prisma.$queryRaw<Array<{ amount: string | null }>>`
    SELECT (SUM(jl.credit) - SUM(jl.debit))::text AS amount
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${companyId} AND la."subType" = 'SALES'
      AND je.date >= ${range.start} AND je.date < ${range.end}`;
  return row?.amount ?? "0.00";
}

run("sales figures", () => {
  beforeEach(resetDb);

  it("shares order discounts across lines to the paisa, adding up to the books", async () => {
    const env = await setup();
    for (const sku of ["EX-PL-001-NAVY-S", "EX-PL-001-NAVY-M", "EX-PL-001-NAVY-L"]) {
      await stockUp(env, sku, 10);
    }
    await stockUp(env, "EX-PL-001-WHITE-S", 10);
    await stockUp(env, "EX-PL-001-WHITE-M", 10);
    // 3 x 1000 less 100: 2,900 shared three ways (966.67 + 966.67 + 966.66).
    await sell(
      env,
      [
        ["EX-PL-001-NAVY-S", 1, 1000],
        ["EX-PL-001-NAVY-M", 1, 1000],
        ["EX-PL-001-NAVY-L", 1, 1000],
      ],
      { discount: 100 },
    );
    // 666.66 + 0.05 less 0.07: the leftover paisa goes to the largest remainder.
    await sell(
      env,
      [
        ["EX-PL-001-WHITE-S", 2, 333.33],
        ["EX-PL-001-WHITE-M", 1, 0.05],
      ],
      { discount: 0.07 },
    );

    const top = await topSellers(env.company.id, todayRange(), {
      groupBy: "SKU",
      sortBy: "REVENUE",
      limit: 10,
    });
    const net = Object.fromEntries(top.items.map((r) => [r.sku, r.net.toFixed(2)]));
    expect(
      ["EX-PL-001-NAVY-S", "EX-PL-001-NAVY-M", "EX-PL-001-NAVY-L"].map((s) => net[s]).sort(),
    ).toEqual(["966.66", "966.67", "966.67"]);
    expect(net["EX-PL-001-WHITE-S"]).toBe("666.59");
    expect(net["EX-PL-001-WHITE-M"]).toBe("0.05");
    expect(top.totals.net.toFixed(2)).toBe("3566.64");
    expect(top.totals).toMatchObject({ groups: 5, pieces: 6 });

    const totals = await salesTotals(env.company.id, todayRange());
    expect(totals).toMatchObject({ orders: 2, pieces: 6 });
    expect(totals.net.toFixed(2)).toBe("3566.64");
    expect(await ledgerSales(env.company.id, todayRange())).toBe("3566.64");
  });

  it("ranks top sellers by pieces or value, per SKU or style", async () => {
    const env = await setup();
    await stockUp(env, "EX-PL-001-NAVY-M", 20);
    await stockUp(env, "EX-PL-001-WHITE-S", 20);
    await stockUp(env, "EX-TS-002-BLACK-M", 20, { unitCost: 300 });
    await sell(env, [["EX-PL-001-NAVY-M", 5, 900]]);
    await sell(env, [
      ["EX-PL-001-WHITE-S", 3, 2000],
      ["EX-TS-002-BLACK-M", 4, 500],
    ]);

    const range = todayRange();
    const byPieces = await topSellers(env.company.id, range, {
      groupBy: "SKU",
      sortBy: "QUANTITY",
      limit: 10,
    });
    expect(byPieces.items.map((r) => [r.sku, r.pieces, r.net.toFixed(2), r.available])).toEqual([
      ["EX-PL-001-NAVY-M", 5, "4500.00", 15],
      ["EX-TS-002-BLACK-M", 4, "2000.00", 16],
      ["EX-PL-001-WHITE-S", 3, "6000.00", 17],
    ]);
    expect(byPieces.items[0]!.cost.toFixed(2)).toBe("2500.00");

    const byValue = await topSellers(env.company.id, range, {
      groupBy: "SKU",
      sortBy: "REVENUE",
      limit: 2,
    });
    expect(byValue.items.map((r) => r.sku)).toEqual(["EX-PL-001-WHITE-S", "EX-PL-001-NAVY-M"]);
    // Totals cover everything sold, not only the rows returned.
    expect(byValue.totals).toMatchObject({ groups: 3, pieces: 12 });
    expect(byValue.totals.net.toFixed(2)).toBe("12500.00");
    expect(byValue.totals.cost.toFixed(2)).toBe("5200.00");

    const byStyle = await topSellers(env.company.id, range, {
      groupBy: "STYLE",
      sortBy: "QUANTITY",
      limit: 10,
    });
    expect(
      byStyle.items.map((r) => [r.styleCode, r.sku, r.pieces, r.skus, r.orders, r.net.toFixed(2)]),
    ).toEqual([
      ["EX-PL-001", null, 8, 2, 2, "10500.00"],
      ["EX-TS-002", null, 4, 1, 1, "2000.00"],
    ]);
    expect(byStyle.items[0]).toMatchObject({ id: env.polo.id, available: 32 });
  });

  it("shows top sellers with money only to people who may see it", async () => {
    const env = await setup();
    await stockUp(env, "EX-PL-001-NAVY-M", 20);
    await stockUp(env, "EX-PL-001-WHITE-S", 20);
    await sell(env, [["EX-PL-001-NAVY-M", 5, 900]]);
    await sell(env, [["EX-PL-001-WHITE-S", 3, 2000]]);

    const forAccounts = await getDashboardInsights(env.accounts, { period: "TODAY" });
    expect(forAccounts.topSellers.totals).toEqual({
      sold: 2,
      pieces: 8,
      net: "10500.00",
      marginPct: "61.9",
    });
    expect(forAccounts.topSellers.items[0]).toMatchObject({
      rank: 1,
      sku: "EX-PL-001-NAVY-M",
      pieces: 5,
      sharePct: "62.5",
      net: "4500.00",
      avgPrice: "900.00",
      cost: "2500.00",
      marginPct: "44.4",
      available: 15,
    });

    const forSales = await getDashboardInsights(env.sales, { period: "TODAY", sortBy: "REVENUE" });
    expect(forSales.topSellers.items[0]).toMatchObject({
      sku: "EX-PL-001-WHITE-S",
      net: "6000.00",
      cost: null,
      marginPct: null,
    });
    expect(forSales.topSellers.totals.marginPct).toBeNull();

    const forProduction = await getDashboardInsights(env.production, { period: "TODAY" });
    expect(forProduction.topSellers.items[0]).toMatchObject({
      sku: "EX-PL-001-NAVY-M",
      pieces: 5,
      net: null,
      avgPrice: null,
      cost: null,
      marginPct: null,
    });
    expect(forProduction.topSellers.totals.net).toBeNull();
    await expectAppError(
      getDashboardInsights(env.production, { period: "TODAY", sortBy: "REVENUE" }),
      "FORBIDDEN",
    );
    await expectAppError(getDashboardInsights(env.employee, {}), "FORBIDDEN");
  });

  it("leaves out void invoices and cancelled orders, and counts sales on the company's day", async () => {
    const env = await setup();
    await stockUp(env, "EX-PL-001-NAVY-M", 20);
    await sell(env, [["EX-PL-001-NAVY-M", 2, 1000]]);
    const voided = await sell(env, [["EX-PL-001-NAVY-M", 1, 1000]]);
    await documents.voidInvoice(env.admin, voided.invoice.id, { reason: "Wrong customer" });
    const cancelled = await sell(env, [["EX-PL-001-NAVY-M", 1, 1000]]);
    await orders.cancelOrder(env.admin, cancelled.order.id, { reason: "Customer changed mind" });

    const totals = await salesTotals(env.company.id, todayRange());
    expect(totals).toMatchObject({ orders: 1, pieces: 2 });
    expect(totals.net.toFixed(2)).toBe("2000.00");
    expect(await ledgerSales(env.company.id, todayRange())).toBe("2000.00");

    // One minute either side of midnight in Dhaka (18:00 the day before in UTC).
    const midnight = startOfDayInZone(today(), TZ);
    await sell(env, [["EX-PL-001-NAVY-M", 1, 300]], {
      issueDate: new Date(midnight.getTime() - 60_000),
    });
    await sell(env, [["EX-PL-001-NAVY-M", 1, 400]], {
      issueDate: new Date(midnight.getTime() + 60_000),
    });
    const yesterday = addDays(today(), -1);
    const buckets = await salesByBucket(
      env.company.id,
      { start: startOfDayInZone(yesterday, TZ), end: todayRange().end },
      TZ,
      "day",
    );
    expect(buckets.map((b) => [b.bucket, b.orders, b.net.toFixed(2)])).toEqual([
      [yesterday, 1, "300.00"],
      [today(), 2, "2400.00"],
    ]);
  });
});

run("stock alerts", () => {
  beforeEach(resetDb);

  /**
   * Held 100 days: Navy S (never sells), Navy M (sells slowly), Navy L (sells well),
   * White S and White M (nearly / fully sold). New today: Navy XL and White XL.
   * White L was never stocked. Sales were invoiced 20 days ago.
   */
  async function stockedShop(env: Env) {
    for (const sku of ["EX-PL-001-NAVY-S", "EX-PL-001-NAVY-M", "EX-PL-001-NAVY-L"]) {
      await stockUp(env, sku, 40, { daysAgo: 100 });
    }
    await stockUp(env, "EX-PL-001-WHITE-S", 10, { daysAgo: 100 });
    await stockUp(env, "EX-PL-001-WHITE-M", 5, { daysAgo: 100 });
    await stockUp(env, "EX-PL-001-NAVY-XL", 60);
    await stockUp(env, "EX-PL-001-WHITE-XL", 3);
    const issueDate = daysAgo(20);
    await sell(env, [["EX-PL-001-NAVY-M", 6, 1000]], { issueDate });
    await sell(env, [["EX-PL-001-NAVY-L", 30, 1000]], { issueDate });
    await sell(env, [["EX-PL-001-WHITE-S", 8, 1000]], { issueDate });
    await sell(env, [["EX-PL-001-WHITE-M", 5, 1000]], { issueDate });
  }

  it("finds low, dead and slow stock and the SKUs holding the most", async () => {
    const env = await setup();
    await stockedShop(env);
    const view = await getDashboardInsights(env.accounts, {});

    // Out of stock first, then the SKUs selling fastest. Never-stocked SKUs are not "low".
    expect(view.lowStock).toMatchObject({ threshold: 5, total: 3, outOfStock: 1 });
    expect(view.lowStock.items.map((r) => [r.sku, r.available, r.soldRecently])).toEqual([
      ["EX-PL-001-WHITE-M", 0, 5],
      ["EX-PL-001-WHITE-S", 2, 8],
      ["EX-PL-001-WHITE-XL", 3, 0],
    ]);

    // Navy S sold nothing in 90 days: dead. Navy M's 34 pieces last 510 days at its pace:
    // slow. Navy L (30 days of cover) is fine, and Navy XL only just arrived.
    expect(view.deadAndSlow).toMatchObject({
      slowDays: 90,
      coverDays: 180,
      dead: { skus: 1, pieces: 40, value: "20000.00" },
      slow: { skus: 1, pieces: 34, value: "17000.00" },
    });
    expect(
      view.deadAndSlow.items.map((r) => [r.sku, r.movement, r.available, r.daysOfCover]),
    ).toEqual([
      ["EX-PL-001-NAVY-S", "DEAD", 40, null],
      ["EX-PL-001-NAVY-M", "SLOW", 34, 510],
    ]);
    expect(view.deadAndSlow.items[1]).toMatchObject({
      soldInWindow: 6,
      lastSoldOn: localDay(daysAgo(20), TZ),
      value: "17000.00",
    });

    // On hand counts pieces held for orders too.
    expect(view.highestStock.map((r) => [r.sku, r.onHand, r.available])).toEqual([
      ["EX-PL-001-NAVY-XL", 60, 60],
      ["EX-PL-001-NAVY-L", 40, 10],
      ["EX-PL-001-NAVY-M", 40, 34],
      ["EX-PL-001-NAVY-S", 40, 40],
      ["EX-PL-001-WHITE-S", 10, 2],
      ["EX-PL-001-WHITE-M", 5, 0],
      ["EX-PL-001-WHITE-XL", 3, 3],
    ]);

    // The same lists without money for the Production Manager.
    const forProduction = await getDashboardInsights(env.production, {});
    expect(forProduction.deadAndSlow.dead).toEqual({ skus: 1, pieces: 40, value: null });
    expect(forProduction.deadAndSlow.items.map((r) => r.value)).toEqual([null, null]);
  });

  it("judges stock over the window the owner picks", async () => {
    const env = await setup();
    await stockedShop(env);
    // Over 14 days nothing sold, so everything held then is dead.
    const short = await getDashboardInsights(env.accounts, { slowDays: 14 });
    expect(short.deadAndSlow.items.map((r) => [r.sku, r.movement])).toEqual([
      ["EX-PL-001-NAVY-S", "DEAD"],
      ["EX-PL-001-NAVY-M", "DEAD"],
      ["EX-PL-001-NAVY-L", "DEAD"],
      ["EX-PL-001-WHITE-S", "DEAD"],
    ]);
    // Accepting two years of cover, Navy M is no longer slow.
    const patient = await getDashboardInsights(env.accounts, { coverDays: 730 });
    expect(patient.deadAndSlow.items.map((r) => r.sku)).toEqual(["EX-PL-001-NAVY-S"]);
    expect(patient.deadAndSlow.slow).toEqual({ skus: 0, pieces: 0, value: "0.00" });
    await expect(getDashboardInsights(env.accounts, { slowDays: 7 })).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});

run("metric cards", () => {
  beforeEach(resetDb);

  it("agree with the books and the Accounts overview", async () => {
    const env = await setup();
    await stockUp(env, "EX-PL-001-NAVY-M", 20);
    await stockUp(env, "EX-PL-001-NAVY-L", 4, { grade: "B_GRADE" });
    await assets.createFixedAsset(env.accounts, {
      name: "Juki sewing machine",
      category: "Machinery",
      purchaseDate: addDays(today(), -10),
      purchaseCost: 120000,
      depreciationRate: 10,
      acquisition: { kind: "PAID", method: "CASH" },
    });
    await capital.createCapitalSource(env.accounts, {
      kind: "BANK_LOAN",
      name: "BRAC Bank SME Loan",
      interestRate: 12,
      startDate: addDays(today(), -5),
      received: { amount: 300000, method: "BANK_TRANSFER" },
    });
    await capital.createCapitalSource(env.accounts, {
      kind: "INVESTOR",
      name: "Karim Ahmed",
      startDate: addDays(today(), -5),
      received: { amount: 200000, method: "BANK_TRANSFER" },
    });
    await sell(env, [["EX-PL-001-NAVY-M", 1, 1000]], { issueDate: daysAgo(1) });
    await orders.createOrder(env.admin, {
      channel: "POS",
      lines: [{ variantId: env.id("EX-PL-001-NAVY-M"), quantity: 2, discount: 100 }],
    });

    const { cards, currency, asOf } = await getMetricCards(env.accounts);
    expect({ currency, asOf }).toEqual({ currency: "BDT", asOf: today() });
    const card = Object.fromEntries(cards.map((c) => [c.key, c]));
    expect(cards.map((c) => c.key)).toEqual([
      "STOCK_VALUE",
      "FIXED_ASSETS",
      "LIABILITIES",
      "TODAY_SALES",
      "NET_PROFIT",
    ]);
    expect(card.STOCK_VALUE).toMatchObject({
      value: "12000.00",
      details: {
        aGrade: { pieces: 20, value: "10000.00" },
        bGrade: { pieces: 4, value: "2000.00" },
        rawMaterials: "0.00",
        workInProgress: "0.00",
        allStock: "12000.00",
      },
    });
    expect(card.FIXED_ASSETS).toMatchObject({
      value: "120000.00",
      details: { cost: "120000.00", accumulatedDepreciation: "0.00", assetCount: 1 },
    });
    expect(card.LIABILITIES).toMatchObject({
      value: "500000.00",
      details: { loans: "300000.00", investors: "200000.00" },
    });
    expect(card.TODAY_SALES).toMatchObject({
      value: "2800.00",
      details: { invoices: 1, pieces: 2, yesterday: "1000.00", changePct: "180.0" },
    });

    const overview = await accountReports.getAccountsOverview(env.accounts);
    expect(card.STOCK_VALUE!.value).toBe(overview.stockValue);
    expect(card.FIXED_ASSETS!.value).toBe(overview.fixedAssets);
    expect(card.LIABILITIES!.value).toBe(overview.liabilities.total);
    expect(card.TODAY_SALES!.value).toBe(overview.todaySales);
    expect(card.NET_PROFIT!.value).toBe(overview.netProfit.thisMonth);
    expect(card.NET_PROFIT!.details).toMatchObject({
      thisFinancialYear: overview.netProfit.thisFinancialYear,
      financialYearFrom: overview.netProfit.financialYearFrom,
    });
  });

  it("are for people who see the financials; hiding a card is each person's choice", async () => {
    const env = await setup();
    await expectAppError(getMetricCards(env.sales), "FORBIDDEN");
    await expectAppError(getMetricCards(env.production), "FORBIDDEN");

    expect(
      await updateDashboardPreferences(env.accounts, { metric: "NET_PROFIT", hidden: true }),
    ).toEqual({ hiddenMetrics: ["NET_PROFIT"] });
    const cards = await getMetricCards(env.accounts);
    expect(cards.hiddenMetrics).toEqual(["NET_PROFIT"]);
    // Hidden cards still carry their figures; the screen shows dots instead.
    expect(cards.cards.find((c) => c.key === "NET_PROFIT")).toMatchObject({
      hidden: true,
      value: "0.00",
    });
    expect(cards.cards.filter((c) => c.hidden)).toHaveLength(1);

    // A whole list comes back in the cards' order; showing a card takes it off.
    await updateDashboardPreferences(env.accounts, {
      hiddenMetrics: ["LIABILITIES", "STOCK_VALUE"],
    });
    expect(
      await updateDashboardPreferences(env.accounts, { metric: "STOCK_VALUE", hidden: false }),
    ).toEqual({ hiddenMetrics: ["LIABILITIES"] });
    // Two tabs hiding different cards at once both stick.
    await Promise.all([
      updateDashboardPreferences(env.accounts, { metric: "FIXED_ASSETS", hidden: true }),
      updateDashboardPreferences(env.accounts, { metric: "TODAY_SALES", hidden: true }),
    ]);
    expect(await getDashboardPreferences(env.accounts)).toEqual({
      hiddenMetrics: ["FIXED_ASSETS", "LIABILITIES", "TODAY_SALES"],
    });
    expect(await getDashboardPreferences(env.admin)).toEqual({ hiddenMetrics: [] });
  });
});

run("report builder", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-reports-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(uploads, { recursive: true, force: true });
  });

  /** Stock and two sales today: 5 Navy M at 900, 3 White S at 2000 (cost 500 each). */
  async function trade(env: Env) {
    await stockUp(env, "EX-PL-001-NAVY-M", 20);
    await stockUp(env, "EX-PL-001-WHITE-S", 20);
    await sell(env, [["EX-PL-001-NAVY-M", 5, 900]]);
    await sell(env, [["EX-PL-001-WHITE-S", 3, 2000]]);
  }

  const table = (
    doc: Awaited<ReturnType<typeof reports.previewReport>>,
    section: string,
    title: string,
  ) => {
    const found = doc.sections
      .find((s) => s.key === section)
      ?.tables.find((t) => t.title.startsWith(title));
    expect(found, `${section} / ${title}`).toBeDefined();
    return found!;
  };

  it("builds a report from the same figures as the dashboard and the books", async () => {
    const env = await setup();
    await trade(env);
    const doc = await reports.previewReport(env.accounts, { period: "TODAY" });
    expect(doc.sections.map((s) => s.key)).toEqual([
      "SUMMARY",
      "SALES",
      "PROFIT_AND_LOSS",
      "TOP_SELLERS",
      "STOCK_ALERTS",
    ]);
    expect(doc).toMatchObject({
      title: "Business report",
      period: { period: "TODAY", from: today(), to: today() },
      generatedBy: "accounts",
      company: { name: "Extras", currency: "BDT" },
    });
    const sales = doc.sections.find((s) => s.key === "SALES")!;
    expect(sales.figures.find((f) => f.label === "Net sales")?.value).toBe("10500.00");
    const byDay = table(doc, "SALES", "Sales by day");
    expect(byDay.rows).toEqual([
      { cells: [today(), 2, 8, "10500.00"] },
      { cells: ["Total", 2, 8, "10500.00"], style: "total" },
    ]);

    // Net profit agrees with the Profit and Loss statement.
    const pnl = await accountReports.getProfitAndLoss(env.accounts, { period: "TODAY" });
    const pnlRows = table(doc, "PROFIT_AND_LOSS", "Profit and loss").rows;
    expect(pnlRows.find((r) => r.cells[0] === "Net profit")?.cells[1]).toBe(pnl.netProfit);

    const topSkus = table(doc, "TOP_SELLERS", "Top 20 SKUs");
    expect(topSkus.columns.map((c) => c.label)).toEqual([
      "#",
      "SKU",
      "Product",
      "Color",
      "Size",
      "Pieces",
      "Share",
      "Net sales (BDT)",
      "Avg price",
      "Margin",
      "In stock",
    ]);
    expect(topSkus.rows[0]!.cells).toEqual([
      1,
      "EX-PL-001-NAVY-M",
      "Classic Polo",
      "Navy",
      "M",
      5,
      "62.5",
      "4500.00",
      "900.00",
      "44.4",
      15,
    ]);
  });

  it("leaves out what the reader may not see, and refuses figures beyond their role", async () => {
    const env = await setup();
    await trade(env);
    const doc = await reports.previewReport(env.production, {});
    expect(doc.sections.map((s) => s.key)).toEqual(["TOP_SELLERS", "STOCK_ALERTS"]);
    expect(table(doc, "TOP_SELLERS", "Top 20 SKUs").columns.map((c) => c.label)).toEqual([
      "#",
      "SKU",
      "Product",
      "Color",
      "Size",
      "Pieces",
      "Share",
      "In stock",
    ]);
    expect(table(doc, "STOCK_ALERTS", "Highest stock").columns.map((c) => c.label)).not.toContain(
      "Value (BDT)",
    );
    const refused = await expectAppError(
      reports.previewReport(env.production, { metrics: "SALES,PROFIT_AND_LOSS" }),
      "FORBIDDEN",
    );
    expect(refused.message).toBe("Your role cannot include Sales, Profit and loss in a report.");
    // Sales Executives hold no reports.export by default.
    await expectAppError(reports.previewReport(env.sales, {}), "FORBIDDEN");
    await expectAppError(
      reports.previewReport(env.accounts, { from: "2026-09-30", to: "2026-09-01" }),
      "VALIDATION",
    );
  });

  it("shows long periods month by month", async () => {
    const env = await setup();
    const doc = await reports.previewReport(env.accounts, {
      from: "2025-01-01",
      to: "2025-03-31",
      metrics: "SALES",
    });
    expect(doc.period).toMatchObject({ period: "CUSTOM", from: "2025-01-01", to: "2025-03-31" });
    expect(table(doc, "SALES", "Sales by month").rows.map((r) => r.cells)).toEqual([
      ["2025-01", 0, 0, "0.00"],
      ["2025-02", 0, 0, "0.00"],
      ["2025-03", 0, 0, "0.00"],
      ["Total", 0, 0, "0.00"],
    ]);
  });

  it("makes PDF and Excel files, keeps them and logs every download", async () => {
    const env = await setup();
    await trade(env);
    const pdf = await reports.generateReport(
      env.accounts,
      { format: "PDF", period: "TODAY" },
      META,
    );
    expect(pdf).toMatchObject({
      title: "Business report",
      format: "PDF",
      status: "SUCCEEDED",
      period: "TODAY",
      from: today(),
      to: today(),
      metrics: ["SUMMARY", "SALES", "PROFIT_AND_LOSS", "TOP_SELLERS", "STOCK_ALERTS"],
      options: { topLimit: 20, alertLimit: 50, slowDays: 90, coverDays: 180 },
      downloadable: true,
      fileName: `Extras - Business report - ${today()}.pdf`,
      error: null,
      requestedBy: { name: "accounts" },
    });
    const file = await reports.downloadReportExport(env.accounts, pdf.id, META);
    expect(file.mimeType).toBe("application/pdf");
    expect(file.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.sizeBytes).toBe(file.bytes.length);

    // Stored under the company's reports folder, with a checksum; it opens through its report only.
    const row = await prisma.reportExport.findUniqueOrThrow({
      where: { id: pdf.id },
      include: { file: true },
    });
    expect(row.file).toMatchObject({
      uploadedById: null,
      mimeType: "application/pdf",
      checksum: createHash("sha256").update(file.bytes).digest("hex"),
    });
    expect(row.file!.storagePath.startsWith(`${env.company.id}/reports/`)).toBe(true);
    await expectAppError(files.getFileForDownload(env.accounts, row.file!.id), "FORBIDDEN");

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "ReportExport", entityId: pdf.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(audit.map((a) => [a.action, a.userId, a.ipAddress])).toEqual([
      ["EXPORT", env.accounts.user.id, META.ipAddress],
      ["EXPORT", env.accounts.user.id, META.ipAddress],
    ]);
    expect(audit[0]!.summary).toContain('Made report "Business report" (PDF');
    expect(audit[1]!.summary).toContain('Downloaded report "Business report" (PDF');

    // The Production Manager's Excel file: quantities, no money columns.
    const excel = await reports.generateReport(env.production, {
      format: "EXCEL",
      title: "Stock check",
    });
    expect(excel).toMatchObject({
      status: "SUCCEEDED",
      metrics: ["TOP_SELLERS", "STOCK_ALERTS"],
      period: "THIS_MONTH",
    });
    expect(excel.fileName).toMatch(
      /^Extras - Stock check - \d{4}-\d{2}-01 to \d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    const workbook = await reports.downloadReportExport(env.production, excel.id);
    expect(workbook.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const parts = unzipSync(workbook.bytes);
    const book = strFromU8(parts["xl/workbook.xml"]!);
    expect(book).toContain('name="Top SKUs"');
    const topSheet = Object.keys(parts)
      .filter((p) => p.startsWith("xl/worksheets/"))
      .map((p) => strFromU8(parts[p]!))
      .find((xml) => xml.includes("Top 20 SKUs by pieces sold"))!;
    const header = (label: string) => `<t xml:space="preserve">${label}</t>`;
    expect(topSheet).toContain(header("In stock"));
    expect(topSheet).not.toContain(header("Net sales (BDT)"));
    expect(topSheet).not.toContain(header("Margin"));
  });

  it("shows saved reports only to people who may see everything in them", async () => {
    const env = await setup();
    await trade(env);
    const owners = await reports.generateReport(env.accounts, {
      format: "PDF",
      metrics: "TOP_SELLERS",
    });
    const stockCheck = await reports.generateReport(env.production, { format: "EXCEL" });

    const ids = async (ctx: CompanyContext, query: Record<string, unknown> = {}) =>
      (await reports.listReportExports(ctx, query)).items.map((r) => r.id);
    // The Production Manager cannot see the sales values and margins in Accounts' report.
    expect(await ids(env.production)).toEqual([stockCheck.id]);
    expect(await ids(env.accounts)).toEqual([stockCheck.id, owners.id]);
    expect(await ids(env.admin)).toEqual([stockCheck.id, owners.id]);
    expect(await ids(env.accounts, { mine: "true" })).toEqual([owners.id]);
    const page = await reports.listReportExports(env.admin, { take: 1 });
    expect(page.items.map((r) => r.id)).toEqual([stockCheck.id]);
    expect(await ids(env.admin, { take: 1, cursor: page.nextCursor })).toEqual([owners.id]);

    await expectAppError(reports.getReportExport(env.production, owners.id), "FORBIDDEN");
    await expectAppError(reports.downloadReportExport(env.production, owners.id), "FORBIDDEN");
    expect((await reports.getReportExport(env.accounts, stockCheck.id)).id).toBe(stockCheck.id);
    await expectAppError(reports.listReportExports(env.sales, {}), "FORBIDDEN");

    // Only the person who made a report, or a Super Admin, deletes it.
    await expectAppError(reports.deleteReportExport(env.production, owners.id), "FORBIDDEN");
    await expectAppError(reports.deleteReportExport(env.accounts, stockCheck.id), "FORBIDDEN");
    const stored = await prisma.reportExport.findUniqueOrThrow({
      where: { id: stockCheck.id },
      include: { file: true },
    });
    expect(await reports.deleteReportExport(env.admin, stockCheck.id, META)).toEqual({
      id: stockCheck.id,
      deleted: true,
    });
    await expect(stat(path.join(uploads, stored.file!.storagePath))).rejects.toThrow();
    expect(await prisma.fileAsset.count({ where: { id: stored.fileId! } })).toBe(0);
    await expectAppError(reports.getReportExport(env.admin, stockCheck.id), "NOT_FOUND");
    expect(
      await prisma.auditLog.count({ where: { action: "DELETE", entityId: stockCheck.id } }),
    ).toBe(1);
    await reports.deleteReportExport(env.accounts, owners.id);
    expect(await prisma.reportExport.count()).toBe(0);
  });

  it("keeps a failed report with its error and leaves no file behind", async () => {
    const env = await setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Storage that cannot be written: a file where the folder should be.
    const blocker = path.join(uploads, "blocker");
    await writeFile(blocker, "not a folder");
    vi.stubEnv("UPLOAD_DIR", path.join(blocker, "uploads"));

    const error = await expectAppError(
      reports.generateReport(env.accounts, { format: "PDF" }),
      "INTERNAL",
    );
    expect(error.message).toMatch(/Error Code: ERR-[A-Z0-9_-]+\./);
    const [failed] = (await reports.listReportExports(env.accounts, {})).items;
    expect(failed).toMatchObject({ status: "FAILED", downloadable: false, error: error.message });
    await expectAppError(reports.downloadReportExport(env.accounts, failed!.id), "NOT_FOUND");
    expect(await prisma.fileAsset.count()).toBe(0);
    expect(await readdir(uploads)).toEqual(["blocker"]);
  });

  it("limits how many reports a person makes in a minute", async () => {
    const env = await setup();
    for (let i = 0; i < 10; i++) {
      await expect(reports.generateReport(env.accounts, {})).rejects.toBeInstanceOf(ZodError);
    }
    await expectAppError(reports.generateReport(env.accounts, { format: "PDF" }), "RATE_LIMITED");
    // Someone else can still make theirs.
    expect((await reports.generateReport(env.admin, { format: "EXCEL" })).status).toBe("SUCCEEDED");
  });

  it("keeps each company's reports to itself", async () => {
    const env = await setup();
    const mine = await reports.generateReport(env.accounts, { format: "PDF" });
    const other = await setup("Other Co");
    expect((await reports.listReportExports(other.accounts, {})).items).toEqual([]);
    await expectAppError(reports.getReportExport(other.accounts, mine.id), "NOT_FOUND");
    await expectAppError(reports.downloadReportExport(other.accounts, mine.id), "NOT_FOUND");
    await expectAppError(reports.deleteReportExport(other.admin, mine.id), "NOT_FOUND");
    expect((await reports.getReportExport(env.accounts, mine.id)).status).toBe("SUCCEEDED");
  });

  it("tells the Report Builder what this person may pick", async () => {
    const env = await setup();
    const options = reports.reportBuilderOptions(env.production);
    expect(options.metrics.filter((m) => m.available).map((m) => m.key)).toEqual([
      "TOP_SELLERS",
      "STOCK_ALERTS",
    ]);
    expect(options.defaults).toMatchObject({
      title: "Business report",
      period: "THIS_MONTH",
      metrics: ["TOP_SELLERS", "STOCK_ALERTS"],
      topLimit: 20,
    });
    expect(options.periods.map((p) => p.key)).toContain("CUSTOM");
    expect(options.formats).toEqual(["PDF", "EXCEL"]);
    expect(() => reports.reportBuilderOptions(env.employee)).toThrow(AppError);
  });
});
