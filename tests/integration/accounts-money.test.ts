import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { rawBalance } from "@/modules/accounts/balances";
import * as bank from "@/modules/accounts/bank.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as moneyInOut from "@/modules/accounts/money-in-out.service";
import * as pettyCash from "@/modules/accounts/petty-cash.service";
import * as reports from "@/modules/accounts/reports.service";
import * as screens from "@/modules/accounts/screens.service";
import * as vouchers from "@/modules/accounts/voucher.service";
import * as expenses from "@/modules/expenses/expense.service";
import * as expenseScreens from "@/modules/expenses/screens.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Extas with an owner, Accounts, a production manager (who will keep the
 * factory's petty cash), a sales executive and the store; 100,000 in cash in
 * hand and a City Bank account.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  const owner = await member("SUPER_ADMIN", "owner");
  const accounts = await member("ACCOUNTS", "accounts");
  const production = await member("PRODUCTION_MANAGER", "production");
  const sales = await member("SALES_EXECUTIVE", "sales");
  const store = await member("WAREHOUSE_TEAM", "store");
  const acc = await ensureControlAccounts(company.id);
  const city = await bank.createBankAccount(owner.ctx, {
    bankName: "City Bank",
    accountName: "Extas Ltd",
    accountNumber: "1234-5678",
  });
  // The opening cash, as owner's money.
  await moneyInOut.addFund(accounts.ctx, {
    ownerName: "Mehadi Hasan",
    accountId: acc.CASH,
    amount: 100000,
  });
  await expenses.ensureGeneralExpenseHeads(company.id);
  const heads = Object.fromEntries(
    (await expenses.listExpenseHeads(owner.ctx)).map((h: { name: string; id: string }) => [
      h.name,
      h.id,
    ]),
  ) as Record<string, string>;
  const balance = (accountId: string) =>
    rawBalance(company.id, accountId).then((b) => b.toFixed(2));
  return {
    company,
    acc,
    city,
    heads,
    balance,
    owner,
    accounts,
    production,
    sales,
    store,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

run("Money in/out: add fund, withdraw, bank charge", () => {
  let env: Env;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("puts the owner's money on their capital, opening it the first time", async () => {
    const owner = await prisma.capitalSource.findFirstOrThrow({
      where: { companyId: env.company.id, kind: "OWNER_CAPITAL" },
    });
    expect(owner.name).toBe("Mehadi Hasan");
    expect(owner.outstanding.toFixed(2)).toBe("100000.00");
    expect(await env.balance(env.acc.CASH)).toBe("100000.00");
    expect(await env.balance(owner.ledgerAccountId!)).toBe("-100000.00");

    const result = await moneyInOut.addFund(env.accounts.ctx, {
      ownerId: owner.id,
      accountId: env.city.ledgerAccount.id,
      amount: 25000,
      reference: "Deposit slip 77",
    });
    expect(result).toEqual({ owner: "Mehadi Hasan", account: env.city.ledgerAccount.name });
    const after = await prisma.capitalSource.findUniqueOrThrow({ where: { id: owner.id } });
    expect(after.outstanding.toFixed(2)).toBe("125000.00");
    expect(await env.balance(env.city.ledgerAccount.id)).toBe("25000.00");
    // The same name again finds the same owner rather than opening a second one.
    await moneyInOut.addFund(env.accounts.ctx, {
      ownerName: "mehadi hasan",
      accountId: env.acc.CASH,
      amount: 1000,
    });
    expect(
      await prisma.capitalSource.count({
        where: { companyId: env.company.id, kind: "OWNER_CAPITAL" },
      }),
    ).toBe(1);
  });

  it("takes the owner's withdrawal to Owner's Drawings, leaving their capital as it is", async () => {
    const result = await moneyInOut.withdrawFund(env.accounts.ctx, {
      ownerName: "Mehadi Hasan",
      accountId: env.acc.CASH,
      amount: 8000,
      notes: "Family",
    });
    expect(result.owner).toBe("Mehadi Hasan");
    expect(await env.balance(env.acc.DRAWINGS)).toBe("8000.00");
    expect(await env.balance(env.acc.CASH)).toBe("92000.00");
    const owner = await prisma.capitalSource.findFirstOrThrow({
      where: { companyId: env.company.id, kind: "OWNER_CAPITAL" },
    });
    expect(owner.outstanding.toFixed(2)).toBe("100000.00");

    // A partner new to the books is opened on the way.
    await moneyInOut.withdrawFund(env.accounts.ctx, {
      ownerName: "Second Partner",
      accountId: env.acc.CASH,
      amount: 2000,
    });
    expect(await env.balance(env.acc.DRAWINGS)).toBe("10000.00");
    await expect(
      prisma.capitalSource.findFirstOrThrow({ where: { name: "Second Partner" } }),
    ).resolves.toMatchObject({ kind: "OWNER_CAPITAL" });
  });

  it("records a bank charge as a Bank Charges expense on Finance Costs, from a bank or wallet only", async () => {
    const charge = await moneyInOut.recordBankCharge(env.accounts.ctx, {
      accountId: env.city.ledgerAccount.id,
      amount: 115,
      notes: "SMS alert fee",
    });
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: charge.id },
      include: { head: true },
    });
    expect(expense.head.name).toBe("Bank Charges");
    expect(expense.journalEntryId).not.toBeNull();
    expect(expense.purpose).toBe("SMS alert fee");
    expect(await env.balance(env.acc.FINANCE_COST)).toBe("115.00");
    expect(await env.balance(env.city.ledgerAccount.id)).toBe("-115.00");

    await expect(
      moneyInOut.recordBankCharge(env.accounts.ctx, { accountId: env.acc.CASH, amount: 10 }),
    ).rejects.toThrow(/bank or wallet/);
  });

  it("is Accounts' and the owner's only", async () => {
    const forAccounts = await moneyInOut.getMoneyInOutOptions(env.accounts.ctx);
    expect(forAccounts?.can).toEqual({ addFund: true, withdraw: true, bankCharge: true });
    expect(forAccounts?.owners).toEqual([
      expect.objectContaining({ name: "Mehadi Hasan", invested: "100000.00" }),
    ]);
    expect(await moneyInOut.getMoneyInOutOptions(env.sales.ctx)).toBeNull();
    expect(await moneyInOut.getMoneyInOutOptions(env.production.ctx)).toBeNull();

    const input = { ownerName: "Someone", accountId: env.acc.CASH, amount: 10 };
    await expect(moneyInOut.addFund(env.sales.ctx, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(moneyInOut.withdrawFund(env.production.ctx, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      moneyInOut.recordBankCharge(env.sales.ctx, {
        accountId: env.city.ledgerAccount.id,
        amount: 10,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const cashBank = await screens.getCashBankScreen(env.accounts.ctx);
    expect(cashBank.moneyInOut?.can.addFund).toBe(true);
    const overview = await screens.getOverviewScreen(env.accounts.ctx);
    expect(overview.moneyInOut?.can.bankCharge).toBe(true);
  });

  it("reverses a wrong Add fund or Withdraw from its journal entry, keeping both in the books", async () => {
    const owner = await prisma.capitalSource.findFirstOrThrow({
      where: { companyId: env.company.id, kind: "OWNER_CAPITAL" },
    });
    const latest = () =>
      prisma.journalEntry.findFirstOrThrow({
        where: {
          companyId: env.company.id,
          sourceType: { in: ["CAPITAL", "INSTALLMENT"] },
          reversalOfId: null,
          isReversed: false,
        },
        orderBy: { createdAt: "desc" },
      });

    // 25,000 put in by mistake: the entry's screen offers "Reverse" to Accounts.
    await moneyInOut.addFund(env.accounts.ctx, {
      ownerId: owner.id,
      accountId: env.city.ledgerAccount.id,
      amount: 25000,
    });
    const wrong = await latest();
    const screen = await screens.getJournalEntryScreen(env.accounts.ctx, wrong.id);
    expect(screen.can.reverse).toBe(true);
    expect(screen.notes.reverse).toBeNull();
    await expect(
      vouchers.reverseJournalVoucher(env.production.ctx, wrong.id, { reason: "Not mine" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const reversal = await vouchers.reverseJournalVoucher(env.accounts.ctx, wrong.id, {
      reason: "Wrong owner chosen",
    });
    expect(reversal.reversalOf?.id).toBe(wrong.id);
    expect(await env.balance(env.city.ledgerAccount.id)).toBe("0.00");
    expect(
      (await prisma.capitalSource.findUniqueOrThrow({ where: { id: owner.id } })).outstanding,
    ).toEqual(owner.outstanding);
    expect((await screens.getJournalEntryScreen(env.accounts.ctx, wrong.id)).can.reverse).toBe(
      false,
    );
    await expect(
      vouchers.reverseJournalVoucher(env.accounts.ctx, wrong.id, { reason: "Again please" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // A withdrawal taken by mistake comes back the same way.
    await moneyInOut.withdrawFund(env.accounts.ctx, {
      ownerId: owner.id,
      accountId: env.acc.CASH,
      amount: 8000,
    });
    const drawing = await latest();
    await vouchers.reverseJournalVoucher(env.accounts.ctx, drawing.id, {
      reason: "Recorded twice",
    });
    expect(await env.balance(env.acc.DRAWINGS)).toBe("0.00");
    expect(await env.balance(env.acc.CASH)).toBe("100000.00");
    const books = await reports.getBooksCheck(env.accounts.ctx);
    expect(books.checks.filter((c) => !c.ok)).toEqual([]);
  });
});

run("Petty cash boxes", () => {
  let env: Env;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  const openFactoryBox = (e: Env, topUp = 5000) =>
    pettyCash.createPettyCashBox(e.accounts.ctx, {
      name: "Factory",
      holderId: e.production.user.id,
      float: 5000,
      ...(topUp ? { topUp: { fromAccountId: e.acc.CASH, amount: topUp } } : {}),
    });
  const boxAccount = (boxId: string) =>
    prisma.pettyCashBox.findUniqueOrThrow({ where: { id: boxId } }).then((b) => b.ledgerAccountId);
  const cost = (ctx: Env["owner"]["ctx"], boxId: string, amount: number, headId: string) =>
    expenses.createExpense(ctx, {
      headId,
      amount,
      paymentType: "CASH_BANK",
      pettyCashBoxId: boxId,
      purpose: "Rickshaw to the dyeing house",
    });

  it("opens a box on its own cash account with its first top-up", async () => {
    const box = await openFactoryBox(env);
    const account = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { id: await boxAccount(box.id) },
    });
    expect(account).toMatchObject({ name: "Petty cash — Factory", subType: "CASH" });
    expect(await env.balance(account.id)).toBe("5000.00");
    expect(await env.balance(env.acc.CASH)).toBe("95000.00");

    const rows = await pettyCash.listPettyCashBoxes(env.accounts.ctx);
    expect(rows).toEqual([
      expect.objectContaining({
        name: "Factory",
        balance: "5000.00",
        float: "5000.00",
        isActive: true,
        holder: expect.objectContaining({ id: env.production.user.id }),
      }),
    ]);
    // Cash & bank lists it under Petty cash, not with cash in hand, and counts it in the total.
    const cashBank = await screens.getCashBankScreen(env.accounts.ctx);
    expect(cashBank.pettyCash.map((b) => b.name)).toEqual(["Factory"]);
    expect(cashBank.accounts.some((a) => a.id === account.id)).toBe(false);
    expect(cashBank.moneyAccounts.some((a) => a.id === account.id)).toBe(true);
    expect(cashBank.can.openBox).toBe(true);

    await expect(openFactoryBox(env, 0)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets the holder record a cost straight into the books, never more than is in the box", async () => {
    const box = await openFactoryBox(env);
    const account = await boxAccount(box.id);
    const supplies = env.heads["Office Supplies"]!;

    const spent = await cost(env.production.ctx, box.id, 1200, supplies);
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: spent.id } });
    expect(row.journalEntryId).not.toBeNull();
    expect(row.paidFromAccountId).toBe(account);
    expect(await env.balance(account)).toBe("3800.00");

    await expect(cost(env.production.ctx, box.id, 3800.01, supplies)).rejects.toMatchObject({
      code: "VALIDATION",
      details: { amount: ["At most 3800.00."] },
    });
    // Someone else cannot spend from it; Accounts can.
    await expect(cost(env.sales.ctx, box.id, 100, supplies)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await cost(env.accounts.ctx, box.id, 800, supplies);
    expect(await env.balance(account)).toBe("3000.00");

    // The holder's own claims still wait for Accounts.
    const claim = await expenses.createExpense(env.production.ctx, {
      headId: supplies,
      amount: 300,
      paymentType: "CASH_BANK",
    });
    expect(
      (await prisma.expense.findUniqueOrThrow({ where: { id: claim.id } })).journalEntryId,
    ).toBeNull();

    // Voiding a cost puts the money back in the box.
    await expenses.voidExpense(env.accounts.ctx, spent.id, { reason: "Entered twice" });
    expect(await env.balance(account)).toBe("4200.00");
  });

  it("shows the box to its holder and Accounts, with what each may do", async () => {
    const box = await openFactoryBox(env);
    await cost(env.production.ctx, box.id, 1500, env.heads["Office Supplies"]!);

    const holder = await pettyCash.getPettyCashScreen(env.production.ctx, box.id);
    expect(holder.box).toMatchObject({
      balance: "3500.00",
      putIn: "5000.00",
      spent: "1500.00",
      shortOfFloat: "1500.00",
    });
    expect(holder.lines).toHaveLength(2);
    expect(holder.accounts).toEqual([]);
    expect(holder.can).toMatchObject({
      record: true,
      topUp: false,
      takeBack: false,
      edit: false,
      close: false,
      openEntries: false,
    });

    const forAccounts = await pettyCash.getPettyCashScreen(env.accounts.ctx, box.id);
    expect(forAccounts.can).toMatchObject({
      record: true,
      topUp: true,
      takeBack: true,
      edit: true,
      close: false,
      openEntries: true,
    });
    expect(forAccounts.accounts.map((a) => a.id)).toContain(holder.box.ledgerAccountId);

    await expect(pettyCash.getPettyCashScreen(env.sales.ctx, box.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // The holder's expense form and Expenses page offer the box.
    const form = await expenseScreens.getExpenseForm(env.production.ctx);
    expect(form.boxes.map((b) => b.id)).toEqual([box.id]);
    expect(form.boxId).toBe(box.id);
    const list = await expenseScreens.getExpenseList(env.production.ctx);
    expect(list.boxes).toEqual([expect.objectContaining({ id: box.id, balance: "3500.00" })]);
    expect((await expenseScreens.getExpenseList(env.sales.ctx)).boxes).toEqual([]);
    // Accounts may pick someone else's box by its address.
    const accountsForm = await expenseScreens.getExpenseForm(env.accounts.ctx, undefined, box.id);
    expect(accountsForm.boxId).toBe(box.id);
  });

  it("is topped up and emptied by Accounts only, then closed when empty", async () => {
    const box = await openFactoryBox(env, 2000);
    const account = await boxAccount(box.id);
    const move = (ctx: Env["owner"]["ctx"], from: string, to: string, amount: number) =>
      vouchers.createTransfer(ctx, { fromAccountId: from, toAccountId: to, amount });

    await expect(move(env.production.ctx, env.acc.CASH, account, 500)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await move(env.accounts.ctx, env.acc.CASH, account, 3000);
    expect(await env.balance(account)).toBe("5000.00");

    await expect(pettyCash.closePettyCashBox(env.accounts.ctx, box.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(move(env.accounts.ctx, account, env.acc.CASH, 5000.01)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await move(env.accounts.ctx, account, env.acc.CASH, 5000);
    expect(await env.balance(account)).toBe("0.00");

    await pettyCash.closePettyCashBox(env.accounts.ctx, box.id);
    const closed = await prisma.pettyCashBox.findUniqueOrThrow({
      where: { id: box.id },
      include: { ledgerAccount: true },
    });
    expect(closed.isActive).toBe(false);
    expect(closed.ledgerAccount.isActive).toBe(false);
    await expect(
      cost(env.production.ctx, box.id, 10, env.heads["Office Supplies"]!),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await pettyCash.myPettyCashBoxes(env.production.ctx)).toEqual([]);
  });

  it("is set up by Accounts, held by someone whose role records expenses", async () => {
    await expect(
      pettyCash.createPettyCashBox(env.production.ctx, {
        name: "Factory",
        holderId: env.production.user.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The store's role records no expenses, so it cannot keep a box.
    await expect(
      pettyCash.createPettyCashBox(env.accounts.ctx, {
        name: "Store",
        holderId: env.store.user.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const box = await openFactoryBox(env, 0);
    const form = await pettyCash.getPettyCashForm(env.accounts.ctx);
    expect(form.holders.map((h) => h.id)).not.toContain(env.store.user.id);
    expect(form.can.topUp).toBe(true);

    await pettyCash.updatePettyCashBox(env.accounts.ctx, box.id, {
      name: "Factory floor",
      holderId: env.sales.user.id,
      float: null,
    });
    const changed = await prisma.pettyCashBox.findUniqueOrThrow({
      where: { id: box.id },
      include: { ledgerAccount: true },
    });
    expect(changed).toMatchObject({
      name: "Factory floor",
      holderId: env.sales.user.id,
      float: null,
    });
    expect(changed.ledgerAccount.name).toBe("Petty cash — Factory floor");
    // The chart of accounts sends changes to the box's page.
    const account = await screens.listMoneyAccounts(env.accounts.ctx);
    expect(account.find((a) => a.id === changed.ledgerAccountId)?.pettyCashBoxId).toBe(box.id);
  });
});
