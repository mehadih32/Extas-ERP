import { beforeEach, describe, expect, it } from "vitest";

import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { rawBalance } from "@/modules/accounts/balances";
import * as reconcile from "@/modules/accounts/bank-reconcile.service";
import * as bank from "@/modules/accounts/bank.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as moneyInOut from "@/modules/accounts/money-in-out.service";
import * as vouchers from "@/modules/accounts/voucher.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Extas with an owner, Accounts and a sales executive, 100,000 in cash and a
 * City Bank account that has had, oldest first: a 50,000 deposit, an 8,000
 * withdrawal, a 12,000 deposit, and a 3,000 deposit that was then reversed.
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
  const sales = await member("SALES_EXECUTIVE", "sales");
  const acc = await ensureControlAccounts(company.id);
  const city = await bank.createBankAccount(owner.ctx, {
    bankName: "City Bank",
    accountName: "Extas Ltd",
    accountNumber: "1234-5678",
  });
  await moneyInOut.addFund(accounts.ctx, {
    ownerName: "Mehadi Hasan",
    accountId: acc.CASH,
    amount: 100000,
  });
  const today = localDay(new Date(), company.timezone);
  const move = (from: string, to: string, amount: number, daysAgo: number) =>
    vouchers.createTransfer(accounts.ctx, {
      fromAccountId: from,
      toAccountId: to,
      amount,
      date: addDays(today, -daysAgo),
    });
  const t1 = await move(acc.CASH, city.ledgerAccountId, 50000, 40);
  const t2 = await move(city.ledgerAccountId, acc.CASH, 8000, 25);
  const t3 = await move(acc.CASH, city.ledgerAccountId, 12000, 9);
  const t4 = await move(acc.CASH, city.ledgerAccountId, 3000, 8);
  await vouchers.reverseJournalVoucher(accounts.ctx, t4.id, { reason: "Entered twice" });
  const bankLine = (entryId: string) =>
    prisma.journalLine.findFirstOrThrow({
      where: { entryId, accountId: city.ledgerAccountId },
      select: { id: true },
    });
  const lines = {
    t1: (await bankLine(t1.id)).id,
    t2: (await bankLine(t2.id)).id,
    t3: (await bankLine(t3.id)).id,
    t4: (await bankLine(t4.id)).id,
  };
  const cashLine = await prisma.journalLine.findFirstOrThrow({
    where: { entryId: t1.id, accountId: acc.CASH },
    select: { id: true },
  });
  return { company, acc, city, today, owner, accounts, sales, entries: { t3 }, lines, cashLine };
}

type Env = Awaited<ReturnType<typeof setup>>;

run("Bank reconcile", () => {
  let env: Env;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  const screen = (show?: string) =>
    reconcile.getReconcileScreen(env.accounts.ctx, env.city.id, { show });

  /** The books always equal the cleared balance and what has not cleared yet. */
  const holdsTogether = (s: Awaited<ReturnType<typeof screen>>["summary"]) =>
    expect(
      (Number(s.cleared) + Number(s.depositsOpen) - Number(s.withdrawalsOpen)).toFixed(2),
    ).toBe(s.books);

  it("starts with every line waiting, the reversed pair left out", async () => {
    const s = await screen();
    expect(s.show).toBe("open");
    expect(s.summary).toEqual({
      books: "54000.00",
      cleared: "0.00",
      depositsOpen: "62000.00",
      depositCount: 2,
      withdrawalsOpen: "8000.00",
      withdrawalCount: 1,
      openCount: 3,
      tickedCount: 0,
    });
    holdsTogether(s.summary);
    expect(s.lines.map((l) => l.id)).toEqual([env.lines.t1, env.lines.t2, env.lines.t3]);
    expect(s.lines.map((l) => [l.deposit, l.withdrawal, l.cleared])).toEqual([
      ["50000.00", "0.00", false],
      ["0.00", "8000.00", false],
      ["12000.00", "0.00", false],
    ]);
    expect(s.lines[0]!.details).toContain("Cash in Hand");
    expect(s.hiddenCount).toBe(0);
    expect(s.can.tick).toBe(true);
    expect((await screen("ticked")).lines).toEqual([]);
  });

  it("ticks a line as cleared and unticks it, recording who and when", async () => {
    const tick = (lineIds: string[], cleared: boolean) =>
      reconcile.setBankLinesCleared(env.accounts.ctx, env.city.id, { lineIds, cleared });

    expect(await tick([env.lines.t1], true)).toEqual({ changed: 1 });
    let s = await screen();
    expect(s.summary).toMatchObject({
      cleared: "50000.00",
      depositsOpen: "12000.00",
      depositCount: 1,
      openCount: 2,
      tickedCount: 1,
    });
    holdsTogether(s.summary);
    expect(s.lines.map((l) => l.id)).toEqual([env.lines.t2, env.lines.t3]);

    const ticked = await screen("ticked");
    expect(ticked.lines).toHaveLength(1);
    expect(ticked.lines[0]).toMatchObject({
      id: env.lines.t1,
      cleared: true,
      clearedOn: env.today,
      clearedBy: env.accounts.user.name,
    });

    // Ticking it again changes nothing; the withdrawal clears too.
    expect(await tick([env.lines.t1, env.lines.t2], true)).toEqual({ changed: 1 });
    s = await screen();
    expect(s.summary.cleared).toBe("42000.00");
    holdsTogether(s.summary);

    expect(await tick([env.lines.t1], false)).toEqual({ changed: 1 });
    s = await screen();
    expect(s.summary).toMatchObject({ cleared: "-8000.00", openCount: 2, tickedCount: 1 });
    holdsTogether(s.summary);
    const line = await prisma.journalLine.findUniqueOrThrow({ where: { id: env.lines.t1 } });
    expect(line.clearedAt).toBeNull();
    expect(line.clearedById).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { companyId: env.company.id, entityType: "BankAccount", entityId: env.city.id },
      orderBy: { createdAt: "asc" },
      select: { summary: true },
    });
    expect(audits.map((a) => a.summary)).toEqual(
      expect.arrayContaining([
        "Ticked 1 line of City Bank 1234-5678 as cleared by the bank",
        "Unticked 1 line of City Bank 1234-5678 as not cleared yet",
      ]),
    );
  });

  it("never changes an amount or a balance", async () => {
    const before = await rawBalance(env.company.id, env.city.ledgerAccountId);
    const amounts = () =>
      prisma.journalLine.findMany({
        where: { accountId: env.city.ledgerAccountId },
        select: { id: true, debit: true, credit: true, entryId: true },
        orderBy: { id: "asc" },
      });
    const linesBefore = await amounts();
    await reconcile.setBankLinesCleared(env.accounts.ctx, env.city.id, {
      lineIds: [env.lines.t1, env.lines.t2],
      cleared: true,
    });
    await reconcile.tickBankLinesUpTo(env.accounts.ctx, env.city.id, { upTo: env.today });
    expect((await rawBalance(env.company.id, env.city.ledgerAccountId)).toFixed(2)).toBe(
      before.toFixed(2),
    );
    expect(await amounts()).toEqual(linesBefore);
  });

  it("ticks everything up to a day and leaves later lines waiting", async () => {
    const upTo = addDays(env.today, -20);
    expect(await reconcile.tickBankLinesUpTo(env.accounts.ctx, env.city.id, { upTo })).toEqual({
      changed: 2,
    });
    const s = await screen();
    expect(s.lines.map((l) => l.id)).toEqual([env.lines.t3]);
    expect(s.summary).toMatchObject({ cleared: "42000.00", openCount: 1, tickedCount: 2 });
    holdsTogether(s.summary);
    // Again: nothing more is waiting up to that day.
    expect(await reconcile.tickBankLinesUpTo(env.accounts.ctx, env.city.id, { upTo })).toEqual({
      changed: 0,
    });

    await expect(
      reconcile.tickBankLinesUpTo(env.accounts.ctx, env.city.id, { upTo: "2999-01-01" }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { upTo: [expect.any(String)] } });
    await expect(
      reconcile.tickBankLinesUpTo(env.accounts.ctx, env.city.id, { upTo: "last week" }),
    ).rejects.toThrow();
  });

  it("keeps the figures right when a ticked entry is reversed afterwards", async () => {
    await reconcile.setBankLinesCleared(env.accounts.ctx, env.city.id, {
      lineIds: [env.lines.t1, env.lines.t3],
      cleared: true,
    });
    await vouchers.reverseJournalVoucher(env.accounts.ctx, env.entries.t3.id, {
      reason: "Wrong account",
    });
    const s = await screen();
    expect(s.summary).toMatchObject({
      books: "42000.00",
      cleared: "50000.00",
      depositsOpen: "0.00",
      withdrawalsOpen: "8000.00",
      openCount: 1,
      tickedCount: 1,
    });
    holdsTogether(s.summary);
    expect((await screen("ticked")).lines.map((l) => l.id)).toEqual([env.lines.t1]);
  });

  it("only lets Accounts tick, and only this bank account's waiting lines", async () => {
    await expect(reconcile.getReconcileScreen(env.sales.ctx, env.city.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      reconcile.setBankLinesCleared(env.sales.ctx, env.city.id, {
        lineIds: [env.lines.t1],
        cleared: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reconcile.tickBankLinesUpTo(env.sales.ctx, env.city.id, { upTo: env.today }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The cash side of a transfer, or a line of a reversed pair, is not on the list.
    for (const lineIds of [[env.cashLine.id], [env.lines.t1, env.lines.t4]]) {
      await expect(
        reconcile.setBankLinesCleared(env.accounts.ctx, env.city.id, { lineIds, cleared: true }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await prisma.journalLine.count({ where: { clearedAt: { not: null } } })).toBe(0);
    await expect(
      reconcile.setBankLinesCleared(env.accounts.ctx, env.city.id, { lineIds: [], cleared: true }),
    ).rejects.toThrow();

    // Another company's bank account is not found.
    const other = await makeCompany("Other");
    const otherOwner = await makeUser("owner@other.test");
    await addToCompany(otherOwner.id, other.company.id, other.roles.SUPER_ADMIN);
    const otherBank = await bank.createBankAccount(
      await contextFor(otherOwner.id, other.company.id),
      { bankName: "Dutch-Bangla", accountName: "Other Ltd", accountNumber: "9999-0001" },
    );
    await expect(
      reconcile.getReconcileScreen(env.accounts.ctx, otherBank.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      reconcile.setBankLinesCleared(env.accounts.ctx, otherBank.id, {
        lineIds: [env.lines.t1],
        cleared: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets the owner tick too", async () => {
    const s = await reconcile.getReconcileScreen(env.owner.ctx, env.city.id);
    expect(s.can.tick).toBe(true);
    await reconcile.setBankLinesCleared(env.owner.ctx, env.city.id, {
      lineIds: [env.lines.t3],
      cleared: true,
    });
    expect((await screen("ticked")).lines[0]?.clearedBy).toBe(env.owner.user.name);
  });
});
