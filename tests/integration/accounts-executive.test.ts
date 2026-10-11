import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as executive from "@/modules/accounts/executive.service";
import { addDays, addMonths, monthStart } from "@/modules/accounts/periods";
import * as reports from "@/modules/accounts/reports.service";
import * as screens from "@/modules/accounts/screens.service";
import * as vouchers from "@/modules/accounts/voucher.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as costs from "@/modules/production/cost.service";
import * as projects from "@/modules/production/project.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
const today = () => localDay(new Date(), TZ);

/**
 * A company with polos (Tops, 10 pcs each of Navy M and L at 500) and trousers
 * (Bottoms, 10 pcs each at 300), and these balances:
 *   Rahim Traders     bought 4 polos at 900 (3,600), nothing paid
 *   Karim Fashion     bought 2 trousers at 700 (1,400), paid 1,000
 *   Nadia Boutique    paid a 2,000 advance (a buyer we owe goods, not money)
 *   Gazipur Knit      we owe 5,000
 *   a walk-in sale of 2 polos at 1,450, paid at the counter
 *   a project with 8,000 of fabric due to Gazipur Knit, not in stock yet
 */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const ctx = await member("SUPER_ADMIN", "owner");
  const accountsCtx = await member("ACCOUNTS", "accounts");
  const pmCtx = await member("PRODUCTION_MANAGER", "production");

  const sizes = [
    await catalog.createSize(ctx, { name: "M" }),
    await catalog.createSize(ctx, { name: "L" }),
  ];
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const menswear = await catalog.createCategory(ctx, { name: "Menswear" });
  const tops = await catalog.createCategory(ctx, { name: "Tops", parentId: menswear.id });
  const bottoms = await catalog.createCategory(ctx, { name: "Bottoms" });
  const style = async (code: string, name: string, categoryId: string, price: number) => {
    const s = await styles.createStyle(ctx, {
      code,
      name,
      categoryId,
      retailPrice: 1450,
      wholesalePrice: price,
    });
    await matrix.generateMatrix(ctx, s.id, {
      colorIds: [navy.id],
      sizeIds: sizes.map((z) => z.id),
    });
    return s;
  };
  const polo = await style("EX-PL-001", "Classic Polo", tops.id, 900);
  const trouser = await style("EX-TR-001", "Chino Trouser", bottoms.id, 700);
  const variants = await prisma.productVariant.findMany({
    where: { companyId: company.id },
    include: { size: true },
  });
  const sku = (styleId: string, size: string) =>
    variants.find((v) => v.styleId === styleId && v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(ctx, {
      variantId: v.id,
      quantity: 10,
      type: "OPENING",
      unitCost: v.styleId === polo.id ? 500 : 300,
    });
  }

  const party = async (kind: "BUYER" | "SUPPLIER", name: string) =>
    (await parties.createParty(ctx, { kind, name })).party;
  const rahim = await party("BUYER", "Rahim Traders");
  const karim = await party("BUYER", "Karim Fashion");
  const nadia = await party("BUYER", "Nadia Boutique");
  const gazipur = await party("SUPPLIER", "Gazipur Knit");

  await orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: rahim.id,
    matrix: [{ styleId: polo.id, quantities: { [sku(polo.id, "M")]: 4 } }],
  });
  await orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: karim.id,
    matrix: [{ styleId: trouser.id, quantities: { [sku(trouser.id, "L")]: 2 } }],
  });
  await payments.receivePayment(accountsCtx, { partyId: karim.id, amount: 1000, method: "CASH" });
  await orders.createOrder(ctx, {
    channel: "POS",
    customerName: "Walk-in",
    lines: [{ variantId: sku(polo.id, "L"), quantity: 2 }],
    payment: { amount: 2900, method: "CASH" },
  });
  await ledger.setOpeningBalance(ctx, nadia.id, { amount: -2000 });
  await ledger.setOpeningBalance(ctx, gazipur.id, { amount: -5000 });

  const heads = Object.fromEntries(
    (await costs.listCostHeads(ctx)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;
  const project = await projects.createProject(pmCtx, {
    name: "Winter polos",
    styleId: polo.id,
    factoryId: gazipur.id,
    targetDate: addDays(today(), 30),
    targetQuantity: 100,
  });
  await costs.addProjectCost(pmCtx, project.id, {
    expenseHeadId: heads.Fabric!,
    amount: 8000,
    paymentType: "DUE",
    supplierId: gazipur.id,
    allowDuplicate: true,
  });

  return {
    ctx,
    accountsCtx,
    company,
    tops,
    bottoms,
    rahim,
    karim,
    gazipur,
    project,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Finished stock per category straight from the stock: pieces and value at average cost. */
async function stockByCategory(env: Env) {
  const balances = await prisma.stockBalance.findMany({
    where: { companyId: env.company.id },
    include: { variant: { include: { style: true } } },
  });
  const out = new Map<string, { pieces: number; value: Prisma.Decimal }>();
  for (const b of balances) {
    const key = b.variant.style.categoryId;
    const cost = b.grade === "B_GRADE" ? b.variant.bGradeAvgCost : b.variant.avgCost;
    const row = out.get(key) ?? { pieces: 0, value: new Prisma.Decimal(0) };
    row.pieces += b.quantity;
    row.value = row.value.plus(cost.times(b.quantity));
    out.set(key, row);
  }
  return out;
}

run("Accounts executive cards", () => {
  beforeEach(resetDb);

  it("lists who owes us and whom we owe, net of advances, and the cards add up", async () => {
    const env = await setup();
    const market = await executive.getMarketBalances(env.accountsCtx);
    expect(market.due.rows.map((r) => [r.name, r.amount])).toEqual([
      ["Rahim Traders", "3600.00"],
      ["Karim Fashion", "400.00"],
    ]);
    expect(market.due).toMatchObject({ total: "4000.00", count: 2 });
    // The fabric bill (8,000) and the opening 5,000 are both owed to Gazipur Knit.
    expect(market.payable.rows.map((r) => [r.name, r.amount])).toEqual([
      ["Gazipur Knit", "13000.00"],
    ]);
    expect(market.payable).toMatchObject({ total: "13000.00", count: 1 });
    // Accounts may not open Buyers & suppliers profiles unless their role does.
    expect(market.can.openParty).toBe(env.accountsCtx.can("parties.view"));

    const o = await screens.getOverviewScreen(env.accountsCtx);
    expect(o.cards.due).toEqual({ total: "4000.00", count: 2 });
    expect(o.cards.payable).toEqual({ total: "13000.00", count: 1 });
    expect(o.cards.cash.total).toBe(o.cash.total);
    expect(
      new Prisma.Decimal(o.cards.cash.byKind.CASH)
        .plus(o.cards.cash.byKind.BANK)
        .plus(o.cards.cash.byKind.MOBILE_WALLET)
        .toFixed(2),
    ).toBe(o.cash.total);
    // The walk-in sale and Karim's payment are cash in hand.
    expect(o.cards.cash.byKind.CASH).toBe("3900.00");
    // The old overview figures are all still there.
    expect(o).toMatchObject({
      receivables: expect.any(String),
      payables: expect.any(String),
      stockValue: expect.any(String),
      netProfit: { thisMonth: expect.any(String), thisFinancialYear: expect.any(String) },
    });
  });

  it("splits inventory into stock by category, raw materials and each project's WIP", async () => {
    const env = await setup();
    const h = await executive.getHoldingsBreakdown(env.accountsCtx);
    const expected = await stockByCategory(env);
    expect(h.readyStock.categories.map((c) => [c.name, c.pieces, c.value])).toEqual(
      [
        [env.tops.id, "Menswear › Tops"],
        [env.bottoms.id, "Bottoms"],
      ]
        .map(([id, name]) => [name, expected.get(id!)!.pieces, expected.get(id!)!.value.toFixed(2)])
        .sort((a, b) => Number(b[2]) - Number(a[2])),
    );
    expect(h.readyStock.total).toBe((await reports.stockValuation(env.company.id)).toFixed(2));
    expect(h.production.projects).toEqual([
      expect.objectContaining({ code: env.project.code, name: "Winter polos", wip: "8000.00" }),
    ]);
    expect(h.production).toMatchObject({ total: "8000.00", other: null });
    expect(h.rawMaterials.total).toBe("0.00");
    expect(h.total).toBe(
      new Prisma.Decimal(h.readyStock.total).plus(h.production.total).toFixed(2),
    );
    // Accounts sees projects but not the products screens by default.
    expect(h.can).toEqual({
      openCategory: env.accountsCtx.can("inventory.view"),
      openMaterials: env.accountsCtx.can("materials.view"),
      openProject: true,
    });

    const o = await screens.getOverviewScreen(env.accountsCtx);
    expect(o.cards.holdings).toEqual({
      total: h.total,
      readyStock: h.readyStock.total,
      rawMaterials: h.rawMaterials.total,
      workInProgress: h.production.total,
    });
  });

  it("matches Profit & loss and compares with the same days of the period before", async () => {
    const env = await setup();
    const acc = await ensureControlAccounts(env.company.id);
    // 1,000 of other income on the first day of last month: the period before.
    const lastMonth = addMonths(monthStart(today()), -1);
    await vouchers.createJournalVoucher(env.accountsCtx, {
      date: lastMonth,
      description: "Sold old cartons",
      lines: [
        { accountId: acc.CASH, debit: 1000 },
        { accountId: acc.OTHER_INCOME, credit: 1000 },
      ],
    });

    const month = await executive.getProfitCard(env.accountsCtx, "MONTH");
    const pl = await reports.getProfitAndLoss(env.accountsCtx, { period: "THIS_MONTH" });
    expect(month).toMatchObject({
      period: "MONTH",
      from: monthStart(today()),
      to: today(),
      sales: pl.revenue.total,
      gross: pl.grossProfit,
      net: pl.netProfit,
      previous: { from: lastMonth, to: addMonths(today(), -1), net: "1000.00" },
    });
    // Sales: 3,600 + 1,400 + 2,900; the goods cost 6 x 500 + 2 x 300.
    expect(month.sales).toBe("7900.00");
    expect(month.growth).toEqual(
      executive.growth(new Prisma.Decimal(month.net), new Prisma.Decimal(1000)),
    );

    const day = await executive.getProfitCard(env.accountsCtx, "TODAY");
    expect(day).toMatchObject({ from: today(), net: month.net, previous: { net: "0.00" } });
    expect(day.growth).toEqual({ direction: "UP", percent: null });

    const lifetime = await executive.getProfitCard(env.accountsCtx, "LIFETIME");
    expect(lifetime).toMatchObject({ from: null, previous: null, growth: null });
    expect(lifetime.net).toBe(new Prisma.Decimal(month.net).plus(1000).toFixed(2));

    const o = await screens.getOverviewScreen(env.accountsCtx, "LIFETIME");
    expect(o.cards.profit).toEqual(lifetime);
  });

  it("names the most profitable categories and buyers, leaving walk-in sales to categories", async () => {
    const env = await setup();
    const leaders = await executive.getProfitLeaders(env.accountsCtx, "MONTH");
    // Tops: 3,600 + 2,900 of polos that cost 6 x 500. Bottoms: 1,400 that cost 2 x 300.
    expect(
      leaders.categories.map((c) => [c.name, c.pieces, c.sales, c.cost, c.profit, c.margin]),
    ).toEqual([
      ["Menswear › Tops", 6, "6500.00", "3000.00", "3500.00", "53.8"],
      ["Bottoms", 2, "1400.00", "600.00", "800.00", "57.1"],
    ]);
    expect(leaders.buyers.map((b) => [b.name, b.sales, b.profit])).toEqual([
      ["Rahim Traders", "3600.00", "1600.00"],
      ["Karim Fashion", "1400.00", "800.00"],
    ]);
    expect(leaders.buyers[0]).toMatchObject({ id: env.rahim.id, kind: "BUYER" });

    // Everything was sold today, so today's leaders are the same.
    const todays = await executive.getProfitLeaders(env.accountsCtx, "TODAY");
    expect(todays.categories.map((c) => c.profit)).toEqual(["3500.00", "800.00"]);
    expect(todays).toMatchObject({ period: "TODAY", from: today(), to: today() });
  });
});
