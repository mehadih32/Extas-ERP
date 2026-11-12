import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { ensureAccountsSetup } from "@/modules/accounts/setup";
import * as b2b from "@/modules/business/b2b.service";
import * as expenses from "@/modules/expenses/expense.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/*
 * Customer acquisition (B2B), 2026-11-12: one expense head with six sub-heads,
 * recorded like any expense through Accounts; Business > B2B shows the month's
 * spend by sub-head, new buyers, cost per new buyer and the budget.
 */
run("Customer acquisition (B2B) and Business > B2B", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function setup(name = "Extas") {
    const { company, roles } = await makeCompany(name);
    const member = async (role: keyof typeof roles, who: string) => {
      const user = await makeUser(`${who}@${company.slug}.test`);
      await addToCompany(user.id, company.id, roles[role]);
      return contextFor(user.id, company.id);
    };
    const owner = await member("SUPER_ADMIN", "owner");
    const accounts = await member("ACCOUNTS", "accounts");
    const sales = await member("SALES_EXECUTIVE", "sales");
    await ensureAccountsSetup(company.id);
    return { company, owner, accounts, sales };
  }

  const headsOf = async (ctx: Awaited<ReturnType<typeof setup>>["owner"]) =>
    Object.fromEntries(
      (await expenses.listExpenseHeads(ctx))
        .filter((h) => h.acquisitionLine)
        .map((h) => [h.acquisitionLine!, h]),
    );

  it("gives every company the head and its six sub-heads once, as office costs under one account", async () => {
    const { company, owner } = await setup();
    await b2b.ensureB2bAcquisitionHeads(company.id);
    await Promise.all([
      b2b.ensureB2bAcquisitionHeads(company.id),
      b2b.ensureB2bAcquisitionHeads(company.id),
    ]);
    const heads = await prisma.expenseHead.findMany({
      where: { companyId: company.id, acquisitionLine: { not: null } },
      include: { ledgerAccount: { include: { parent: true } } },
    });
    expect(heads.map((h) => h.name).sort()).toEqual(
      [
        "Customer acquisition (B2B): B2B platforms",
        "Customer acquisition (B2B): Online ads",
        "Customer acquisition (B2B): Other",
        "Customer acquisition (B2B): Samples to new buyers",
        "Customer acquisition (B2B): Trade fairs and exhibitions",
        "Customer acquisition (B2B): Travel and buyer visits",
      ].sort(),
    );
    // Office costs: never production (order) costs; expense accounts under one parent.
    expect(heads.every((h) => !h.isProductionCost)).toBe(true);
    expect(heads.every((h) => h.ledgerAccount?.type === "EXPENSE")).toBe(true);
    expect(new Set(heads.map((h) => h.ledgerAccount?.parent?.name))).toEqual(
      new Set(["Customer acquisition (B2B)"]),
    );
    expect(new Set(heads.map((h) => h.ledgerAccountId)).size).toBe(6);
    // Accounts sees them in the head list like any other.
    expect(Object.keys(await headsOf(owner)).length).toBe(6);
  });

  it("shows the month's spend by sub-head, new buyers, cost per new buyer and the budget", async () => {
    const { company, owner, accounts, sales } = await setup();
    const heads = await headsOf(owner);
    const spend = (line: string, amount: number, date: string) =>
      expenses.createExpense(accounts, {
        headId: heads[line]!.id,
        amount,
        date,
        paymentType: "CASH_BANK",
        method: "CASH",
      });
    await spend("ONLINE_ADS", 6000, "2026-10-05");
    await spend("TRADE_FAIRS", 30000, "2026-10-12");
    await spend("SAMPLES", 4000, "2026-10-20");
    const voided = await spend("TRAVEL", 9000, "2026-10-21");
    await expenses.voidExpense(accounts, voided.id, { reason: "Entered twice" });
    await spend("ONLINE_ADS", 2500, "2026-09-30"); // last month: not counted

    // Buyers: two whose first wholesale order is in October, one older, one retail store.
    const party = (code: string, name: string) =>
      prisma.party.create({ data: { companyId: company.id, code, kind: "BUYER", name } });
    const order = (partyId: string, number: string, day: string, extra = {}) =>
      prisma.salesOrder.create({
        data: {
          companyId: company.id,
          number,
          channel: "WHOLESALE",
          partyId,
          orderDate: new Date(`${day}T06:00:00Z`),
          ...extra,
        },
      });
    const mamun = await party("B-1", "Mamun Traders");
    const rafi = await party("B-2", "Rafi Fashion");
    const old = await party("B-3", "Old Buyer");
    const cancelledOnly = await party("B-4", "Cancelled Buyer");
    await order(mamun.id, "SO-1", "2026-10-03");
    await order(mamun.id, "SO-2", "2026-10-25");
    await order(rafi.id, "SO-3", "2026-10-28");
    await order(old.id, "SO-4", "2026-08-01");
    await order(old.id, "SO-5", "2026-10-02");
    await order(cancelledOnly.id, "SO-6", "2026-10-09", { status: "CANCELLED" });

    await b2b.setB2bBudget(owner, {
      month: "2026-10",
      ONLINE_ADS: 7000,
      TRADE_FAIRS: 25000,
      SAMPLES: "",
    });
    const page = await b2b.b2bPage(owner, { month: "2026-10" });
    expect(page.total).toBe("40000.00");
    const line = (l: string) => page.lines.find((x) => x.line === l)!;
    expect(line("ONLINE_ADS")).toMatchObject({
      spent: "6000.00",
      budget: "7000.00",
      state: "YELLOW",
      percent: 86,
    });
    expect(line("TRADE_FAIRS")).toMatchObject({
      spent: "30000.00",
      budget: "25000.00",
      state: "RED",
    });
    expect(line("SAMPLES")).toMatchObject({ spent: "4000.00", budget: null, state: "NONE" });
    expect(line("TRAVEL")).toMatchObject({ spent: "0.00" });
    expect(page.newBuyers.map((b) => b.name)).toEqual(["Mamun Traders", "Rafi Fashion"]);
    expect(page.costPerNewBuyer).toBe("20000.00");
    expect(page.budgetTotal).toBe("32000.00");
    expect(page.totalState).toBe("RED");

    // Taking a budget off keeps the row (0 = no budget), never deletes it.
    await b2b.setB2bBudget(owner, { month: "2026-10", ONLINE_ADS: "" });
    const after = await b2b.b2bPage(owner, { month: "2026-10" });
    expect(after.lines.find((x) => x.line === "ONLINE_ADS")).toMatchObject({ budget: null });
    expect(await prisma.b2bAcquisitionBudget.count({ where: { line: "ONLINE_ADS" } })).toBe(1);

    // The same as Business > Overview: only who sees the financials.
    await expect(b2b.b2bPage(sales, { month: "2026-10" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(b2b.setB2bBudget(sales, { month: "2026-10", OTHER: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(b2b.b2bPage(owner, { month: "2026-13" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("keeps each company's spend and budget to itself", async () => {
    const a = await setup("Extas");
    const other = await setup("Other Co");
    const heads = await headsOf(a.owner);
    await expenses.createExpense(a.accounts, {
      headId: heads.ONLINE_ADS!.id,
      amount: 1000,
      date: "2026-10-05",
      paymentType: "CASH_BANK",
      method: "CASH",
    });
    await b2b.setB2bBudget(a.owner, { month: "2026-10", ONLINE_ADS: 500 });
    const theirs = await b2b.b2bPage(other.owner, { month: "2026-10" });
    expect(theirs.total).toBe("0.00");
    expect(theirs.lines.every((l) => l.budget === null)).toBe(true);
    // A head of one company cannot be used by another.
    await expect(
      expenses.createExpense(other.accounts, {
        headId: heads.ONLINE_ADS!.id,
        amount: 1,
        date: "2026-10-05",
        paymentType: "CASH_BANK",
        method: "CASH",
      }),
    ).rejects.toThrow();
  });
});
