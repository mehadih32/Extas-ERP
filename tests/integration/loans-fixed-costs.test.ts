import { beforeEach, describe, expect, it } from "vitest";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { rawBalance } from "@/modules/accounts/balances";
import * as bank from "@/modules/accounts/bank.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as loans from "@/modules/accounts/loans.service";
import * as moneyInOut from "@/modules/accounts/money-in-out.service";
import { addMonths } from "@/modules/accounts/periods";
import * as reports from "@/modules/accounts/reports.service";
import { setPin } from "@/modules/ai/settings.service";
import * as expenses from "@/modules/expenses/expense.service";
import * as fixedCosts from "@/modules/expenses/recurring.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PIN = "2468";

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** Extas with the owner (PIN set), Accounts and a sales executive; 30,00,000 of own capital in the City Bank. */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  const owner = await member("SUPER_ADMIN", "owner");
  const accounts = await member("ACCOUNTS", "accounts");
  const sales = await member("SALES_EXECUTIVE", "sales");
  await setPin(owner.ctx, { pin: PIN });
  const acc = await ensureControlAccounts(company.id);
  const city = await bank.createBankAccount(owner.ctx, {
    bankName: "City Bank",
    accountName: "Extas Ltd",
    accountNumber: "1234-5678",
  });
  await moneyInOut.addFund(owner.ctx, {
    ownerName: "Mehadi Hasan",
    accountId: city.ledgerAccountId,
    amount: 3000000,
  });
  const balance = (accountId: string) =>
    rawBalance(company.id, accountId).then((b) => b.toFixed(2));
  return { company, acc, city, owner, accounts, sales, balance };
}

type Env = Awaited<ReturnType<typeof setup>>;
const today = (env: Env) => localDay(new Date(), env.company.timezone);

run("Loans & capital page and monthly fixed costs", () => {
  let env: Env;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("splits a bank loan's interest from its installment, and pays installments by themselves", async () => {
    const t = today(env);
    // BRAC: 10,00,000 repaid as 12 x 1,00,000, kept in capital.
    await expectAppError(
      loans.addLoan(env.owner.ctx, {
        lenderKind: "BANK",
        lenderName: "BRAC Bank",
        amount: 1000000,
        takenOn: t,
        method: "BANK_TRANSFER",
        accountId: env.city.ledgerAccountId,
        keepInCapital: true,
        installmentAmount: 100000,
        installmentsLeft: 12,
        nextDueDate: t,
        autoPay: true,
      }),
      "VALIDATION",
    );
    await expectAppError(
      loans.addLoan(env.sales.ctx, {
        lenderKind: "BANK",
        lenderName: "BRAC Bank",
        amount: 1000000,
        takenOn: t,
        installmentAmount: 100000,
        installmentsLeft: 12,
        nextDueDate: t,
      }),
      "FORBIDDEN",
    );
    // Too small to cover the loan.
    await expectAppError(
      loans.addLoan(env.owner.ctx, {
        lenderKind: "BANK",
        lenderName: "BRAC Bank",
        amount: 1000000,
        takenOn: t,
        installmentAmount: 50000,
        installmentsLeft: 12,
        nextDueDate: t,
      }),
      "VALIDATION",
    );
    const brac = await loans.addLoan(env.owner.ctx, {
      lenderKind: "BANK",
      lenderName: "BRAC Bank",
      amount: 1000000,
      takenOn: t,
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
      keepInCapital: true,
      installmentAmount: 100000,
      installmentsLeft: 12,
      nextDueDate: t,
      autoPay: true,
      pin: PIN,
    });
    expect(await env.balance(env.city.ledgerAccountId)).toBe("4000000.00");

    let profile = await loans.getLenderProfile(env.owner.ctx, brac.lenderId);
    expect(profile.loans).toHaveLength(1);
    const loan = profile.loans[0]!;
    expect(loan.left.count).toBe(12);
    expect(loan.next).toMatchObject({
      amount: "100000.00",
      principal: "83333.34",
      interest: "16666.66",
    });
    expect(loan.left.amount).toBe("1200000.00");

    // The first installment is due today: the nightly clock pays it.
    expect(await loans.payDueInstallments(new Date())).toBe(1);
    expect(await loans.payDueInstallments(new Date())).toBe(0);
    expect(await env.balance(env.city.ledgerAccountId)).toBe("3900000.00");
    profile = await loans.getLenderProfile(env.owner.ctx, brac.lenderId);
    expect(profile.loans[0]!.paid).toMatchObject({
      count: 1,
      principal: "83333.34",
      interest: "16666.66",
    });
    expect(profile.loans[0]!.installments[0]!.paidFrom).toContain("City Bank");
    expect(profile.loans[0]!.owedNow).toBe("916666.66");

    // Capital: 30 lakh own + 10 lakh kept for ever; the bank is still owed the rest.
    const page = await loans.getLoansPage(env.owner.ctx);
    expect(page.capital).toMatchObject({
      own: "3000000.00",
      kept: "1000000.00",
      keptStillOwed: "916666.66",
      otherLoans: "0.00",
      working: "4000000.00",
    });

    // Profit and loss: interest is a cost; the principal comes out of profit below net profit.
    const pl = await reports.getProfitAndLoss(env.owner.ctx, { from: t, to: t });
    expect(pl.netProfit).toBe("-16666.66");
    expect(pl.keptLoans).toEqual({
      lines: [{ name: "BRAC Bank", amount: "83333.34" }],
      total: "83333.34",
      leftAfter: "-100000.00",
    });
  });

  it("stops paying by itself when the person who switched it on can no longer pay money", async () => {
    const t = today(env);
    const ngo = await loans.addLoan(env.accounts.ctx, {
      lenderKind: "NGO",
      lenderName: "ASA",
      amount: 200000,
      takenOn: t,
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
      installmentAmount: 20000,
      installmentsLeft: 12,
      nextDueDate: t,
    });
    const page = await loans.getLoansPage(env.owner.ctx);
    const sourceId = (
      await prisma.capitalSource.findFirstOrThrow({ where: { lenderId: ngo.lenderId } })
    ).id;
    expect(page.dueSoon[0]).toMatchObject({ name: "ASA", amount: "20000.00", autoPay: false });
    await expectAppError(loans.setAutoPay(env.accounts.ctx, sourceId, { on: true }), "VALIDATION");
    await loans.setAutoPay(env.accounts.ctx, sourceId, {
      on: true,
      accountId: env.city.ledgerAccountId,
      method: "BANK_TRANSFER",
      pin: PIN,
    });
    // Accounts leaves the company.
    await prisma.companyMembership.updateMany({
      where: { userId: env.accounts.user.id },
      data: { isActive: false },
    });
    expect(await loans.payDueInstallments(new Date())).toBe(0);
    const source = await prisma.capitalSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.autoPay).toBe(false);
    const profile = await loans.getLenderProfile(env.owner.ctx, ngo.lenderId);
    expect(profile.loans[0]!.paid.count).toBe(0);
  });

  it("renews, partly returns and returns a person's term, and keeps the closed term", async () => {
    const t = today(env);
    const first = await loans.addLoan(env.owner.ctx, {
      lenderKind: "PERSON",
      lenderName: "Shishir",
      amount: 1000000,
      takenOn: t,
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
      periodMonths: 3,
      profitPerPeriod: 30000,
    });
    // A second term with the same person, running before the ERP, profit as 3%.
    const second = await loans.addLoan(env.owner.ctx, {
      lenderKind: "PERSON",
      lenderId: first.lenderId,
      amount: 500000,
      takenOn: addMonths(t, -2),
      before: { owedNow: 500000 },
      periodMonths: 3,
      profitPct: 3,
    });
    expect(second.lenderId).toBe(first.lenderId);
    let profile = await loans.getLenderProfile(env.owner.ctx, first.lenderId);
    expect(profile.totals).toMatchObject({
      taken: "1500000.00",
      owedNow: "1500000.00",
      running: 2,
    });
    const running = profile.loans.find((l) => l.taken === "500000.00")!;
    expect(running.next).toMatchObject({
      dueDate: addMonths(addMonths(t, -2), 3),
      amount: "15000.00",
    });

    const firstTerm = profile.loans.find((l) => l.taken === "1000000.00")!;
    expect(firstTerm.next?.dueDate).toBe(addMonths(t, 3));
    await expectAppError(
      loans.termAction(env.sales.ctx, first.id, { action: "RENEW" }),
      "FORBIDDEN",
    );
    await loans.termAction(env.owner.ctx, first.id, {
      action: "RENEW",
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
    });
    await loans.termAction(env.owner.ctx, first.id, {
      action: "RETURN_PART",
      returnAmount: 400000,
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
    });
    profile = await loans.getLenderProfile(env.owner.ctx, first.lenderId);
    let term = profile.loans.find((l) => l.taken === "1000000.00")!;
    expect(term).toMatchObject({ state: "RENEWED", renewals: 2, owedNow: "600000.00" });
    expect(term.next).toMatchObject({ dueDate: addMonths(t, 9), amount: "18000.00" });
    expect(term.paid).toMatchObject({ count: 2, interest: "60000.00", principal: "400000.00" });

    await loans.termAction(env.owner.ctx, first.id, {
      action: "RETURN",
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
    });
    profile = await loans.getLenderProfile(env.owner.ctx, first.lenderId);
    term = profile.loans.find((l) => l.taken === "1000000.00")!;
    expect(term).toMatchObject({ state: "CLOSED", owedNow: "0.00", next: null });
    expect(term.paid).toMatchObject({ count: 3, interest: "78000.00", principal: "1000000.00" });
    expect(profile.totals).toMatchObject({ running: 1, closed: 1, interestPaid: "78000.00" });
    // A person's term not kept in capital: the money working in the business went down with it.
    const page = await loans.getLoansPage(env.owner.ctx);
    expect(page.capital).toMatchObject({ otherLoans: "500000.00", working: "3500000.00" });
    expect(page.lenders.find((l) => l.name === "Shishir")).toMatchObject({ running: 1, closed: 1 });
  });

  it("records a monthly fixed cost once a month on its day, and stops", async () => {
    await expenses.ensureGeneralExpenseHeads(env.company.id);
    const head = (await expenses.listExpenseHeads(env.owner.ctx)).find(
      (h: { name: string }) => h.name === "Office Rent",
    ) as { id: string } | undefined;
    expect(head).toBeDefined();
    const cost = {
      name: "Office rent",
      headId: head!.id,
      amount: 25000,
      dayOfMonth: 31,
      method: "BANK_TRANSFER" as const,
      accountId: env.city.ledgerAccountId,
    };
    await expectAppError(fixedCosts.createFixedCost(env.owner.ctx, cost), "VALIDATION");
    await expectAppError(
      fixedCosts.createFixedCost(env.sales.ctx, { ...cost, pin: PIN }),
      "FORBIDDEN",
    );
    const { id } = await fixedCosts.createFixedCost(env.owner.ctx, { ...cost, pin: PIN });
    // As if it was set up at the start of 2026.
    await prisma.recurringExpense.update({ where: { id }, data: { startMonth: "2026-01" } });

    // January and February have come (the 31st is February's 28th); March not yet.
    const march1 = new Date("2026-03-01T06:00:00Z");
    expect(await fixedCosts.recordDueFixedCosts(march1)).toBe(2);
    expect(await fixedCosts.recordDueFixedCosts(march1)).toBe(0);
    const rows = await prisma.expense.findMany({
      where: { companyId: env.company.id, headId: head!.id },
      orderBy: { date: "asc" },
    });
    expect(rows.map((r) => localDay(r.date, env.company.timezone))).toEqual([
      "2026-01-31",
      "2026-02-28",
    ]);
    expect(rows.every((r) => r.journalEntryId)).toBe(true);

    await expectAppError(
      fixedCosts.updateFixedCost(env.owner.ctx, id, { amount: 30000 }),
      "VALIDATION",
    );
    await fixedCosts.updateFixedCost(env.owner.ctx, id, { amount: 30000, pin: PIN });
    expect(await fixedCosts.recordDueFixedCosts(new Date("2026-04-01T06:00:00Z"))).toBe(1);
    const march = await prisma.expense.findFirstOrThrow({
      where: { companyId: env.company.id, headId: head!.id },
      orderBy: { date: "desc" },
    });
    expect(march.amount.toFixed(2)).toBe("30000.00");

    await fixedCosts.updateFixedCost(env.owner.ctx, id, { stop: true });
    expect(await fixedCosts.recordDueFixedCosts(new Date("2026-06-01T06:00:00Z"))).toBe(0);
    const screen = await fixedCosts.getFixedCostsScreen(env.owner.ctx);
    expect(screen.items[0]).toMatchObject({ isActive: false, lastPostedMonth: "2026-03" });
  });

  it("days in a month and months due", () => {
    expect(fixedCosts.dayInMonth("2028-02", 31)).toBe("2028-02-29");
    expect(fixedCosts.dayInMonth("2026-04", 15)).toBe("2026-04-15");
    expect(
      fixedCosts.monthsDue(
        { startMonth: "2026-11", lastPostedMonth: null, dayOfMonth: 5 },
        "2026-11-04",
      ),
    ).toEqual([]);
    expect(
      fixedCosts.monthsDue(
        { startMonth: "2026-11", lastPostedMonth: "2026-11", dayOfMonth: 5 },
        "2027-01-05",
      ),
    ).toEqual(["2026-12", "2027-01"]);
  });
});

run("Loans: the reviewer's cases", () => {
  let env: Env;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("never leaves the last installment with less than nothing in interest", async () => {
    const { planFromInstallment } = await import("@/modules/accounts/installments");
    const { Prisma } = await import("@prisma/client");
    const plan = planFromInstallment({
      principal: new Prisma.Decimal(1000000),
      amount: new Prisma.Decimal("8333.34"),
      count: 120,
      firstDueDate: "2027-01-05",
      everyMonths: 1,
    })!;
    expect(plan.every((i) => i.interest.gte(0))).toBe(true);
    expect(plan.reduce((t, i) => t.plus(i.principal), new Prisma.Decimal(0)).toFixed(2)).toBe(
      "1000000.00",
    );
  });

  it("refuses auto-pay over late installments, and a second renew with the same press", async () => {
    const t = today(env);
    const past = addMonths(t, -1);
    // A loan from before the ERP with its next installment already past: never paid again by itself.
    await expectAppError(
      loans.addLoan(env.owner.ctx, {
        lenderKind: "NGO",
        lenderName: "ASA",
        amount: 500000,
        takenOn: addMonths(t, -6),
        before: { owedNow: 300000 },
        installmentAmount: 55000,
        installmentsLeft: 6,
        nextDueDate: past,
        autoPay: true,
        pin: PIN,
        method: "BANK_TRANSFER",
        accountId: env.city.ledgerAccountId,
      }),
      "VALIDATION",
    );
    const asa = await loans.addLoan(env.owner.ctx, {
      lenderKind: "NGO",
      lenderName: "ASA",
      amount: 500000,
      takenOn: addMonths(t, -6),
      before: { owedNow: 300000 },
      installmentAmount: 55000,
      installmentsLeft: 6,
      nextDueDate: past,
    });
    await expectAppError(
      loans.setAutoPay(env.owner.ctx, asa.id, {
        on: true,
        pin: PIN,
        method: "BANK_TRANSFER",
        accountId: env.city.ledgerAccountId,
      }),
      "VALIDATION",
    );

    const shishir = await loans.addLoan(env.owner.ctx, {
      lenderKind: "PERSON",
      lenderName: "Shishir",
      amount: 1000000,
      takenOn: addMonths(t, -3),
      before: { owedNow: 1000000 },
      periodMonths: 3,
      profitPerPeriod: 30000,
      nextDueDate: t,
    });
    const due = (await loans.getLenderProfile(env.owner.ctx, shishir.lenderId)).loans[0]!.next!;
    const press = {
      action: "RENEW",
      installmentId: due.id,
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
    };
    await loans.termAction(env.owner.ctx, shishir.id, press);
    await expectAppError(loans.termAction(env.owner.ctx, shishir.id, press), "CONFLICT");
    const term = (await loans.getLenderProfile(env.owner.ctx, shishir.lenderId)).loans[0]!;
    expect(term.paid).toMatchObject({ count: 1, interest: "30000.00" });
    // The next profit is 3 months after the one just paid.
    expect(term.next?.dueDate).toBe(addMonths(t, 3));
  });

  it("keeps a loan in capital from the day it is chosen, and past months stay as reported", async () => {
    const t = today(env);
    const city = await loans.addLoan(env.owner.ctx, {
      lenderKind: "BANK",
      lenderName: "City Bank",
      amount: 1200000,
      takenOn: t,
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
      installmentAmount: 110000,
      installmentsLeft: 12,
      nextDueDate: t,
    });
    const first = (await loans.getLenderProfile(env.owner.ctx, city.lenderId)).loans[0]!.next!;
    const { payInstallment } = await import("@/modules/accounts/capital.service");
    await payInstallment(env.owner.ctx, first.id, {
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
    });
    // Chosen after that installment: it was not repaid out of profit.
    await loans.setKeepInCapital(env.owner.ctx, city.id, { keepInCapital: true });
    const pl = await reports.getProfitAndLoss(env.owner.ctx, { from: t, to: t });
    expect(pl.keptLoans.lines).toEqual([]);
    // Nothing repaid while kept yet: it can still be taken out again.
    await loans.setKeepInCapital(env.owner.ctx, city.id, { keepInCapital: false });
    await loans.setKeepInCapital(env.owner.ctx, city.id, { keepInCapital: true });
    const second = (await loans.getLenderProfile(env.owner.ctx, city.lenderId)).loans[0]!.next!;
    await payInstallment(env.owner.ctx, second.id, {
      method: "BANK_TRANSFER",
      accountId: env.city.ledgerAccountId,
    });
    await expectAppError(
      loans.setKeepInCapital(env.owner.ctx, city.id, { keepInCapital: false }),
      "CONFLICT",
    );
  });

  it("never starts a fixed cost in a month whose day has passed, and asks for the right to record expenses", async () => {
    await expenses.ensureGeneralExpenseHeads(env.company.id);
    const head = (await expenses.listExpenseHeads(env.owner.ctx)).find(
      (h: { name: string }) => h.name === "Office Rent",
    ) as { id: string };
    const t = today(env);
    const month = t.slice(0, 7);
    const day = Number(t.slice(8, 10));
    const cost = { name: "Office rent", headId: head.id, amount: 45000, pin: PIN };
    if (day > 1) {
      await expectAppError(
        fixedCosts.createFixedCost(env.owner.ctx, { ...cost, dayOfMonth: 1, startMonth: month }),
        "VALIDATION",
      );
    }
    await expectAppError(
      fixedCosts.createFixedCost(env.owner.ctx, {
        ...cost,
        dayOfMonth: 28,
        startMonth: addMonths(`${month}-01`, -2).slice(0, 7),
      }),
      "VALIDATION",
    );
    // Left empty: the first month whose day is still to come.
    const made = await fixedCosts.createFixedCost(env.owner.ctx, { ...cost, dayOfMonth: 1 });
    const row = await prisma.recurringExpense.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.startMonth).toBe(day > 1 ? addMonths(`${month}-01`, 1).slice(0, 7) : month);
  });
});
