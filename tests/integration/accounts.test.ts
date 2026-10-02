import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as assets from "@/modules/accounts/asset.service";
import * as bank from "@/modules/accounts/bank.service";
import * as capital from "@/modules/accounts/capital.service";
import * as chart from "@/modules/accounts/chart.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { financialYearStart } from "@/modules/accounts/periods";
import * as reports from "@/modules/accounts/reports.service";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import * as vouchers from "@/modules/accounts/voucher.service";
import type { CompanyContext } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as costs from "@/modules/production/cost.service";
import * as projects from "@/modules/production/project.service";
import { DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/** A calendar day `n` days from today in company time, e.g. "2026-10-12". */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A company with one user per role (Super Admin, Accounts, Sales Executive,
 * Production Manager, Employee) and its control accounts.
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
  const acc = await ensureControlAccounts(company.id);
  const party = async (name: string, kind: "SUPPLIER" | "BUYER" = "SUPPLIER") =>
    (await parties.createParty(admin, { kind, name })).party;
  return { company, admin, accounts, sales, production, employee, acc, party };
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

/** An account's balance in its normal direction, e.g. "1500.00". */
async function balance(ctx: CompanyContext, accountId: string) {
  return (await chart.getAccount(ctx, accountId)).balance;
}

async function expectBooksOk(ctx: CompanyContext) {
  const check = await reports.getBooksCheck(ctx);
  expect(check.checks.filter((c) => !c.ok)).toEqual([]);
  expect(check.ok).toBe(true);
}

async function billState(id: string) {
  const b = await prisma.supplierBill.findUniqueOrThrow({ where: { id } });
  return [b.status, b.paidAmount.toFixed(2), b.dueAmount.toFixed(2)];
}

run("default roles and money", () => {
  it("keeps the books and money with Accounts and Super Admin", () => {
    const money = [
      "accounts.view",
      "accounts.manage",
      "accounts.receipts.record",
      "accounts.payments.record",
    ] as const;
    for (const role of [
      "SALES_EXECUTIVE",
      "PRODUCTION_MANAGER",
      "WAREHOUSE_TEAM",
      "EMPLOYEE",
    ] as const) {
      expect(
        DEFAULT_ROLE_PERMISSIONS[role].filter((p) => (money as readonly string[]).includes(p)),
      ).toEqual([]);
    }
    expect(DEFAULT_ROLE_PERMISSIONS.ACCOUNTS).toEqual(expect.arrayContaining([...money]));
  });
});

run("chart of accounts, journal vouchers and transfers", () => {
  beforeEach(resetDb);

  it("lists the chart, adds accounts and brings balances forward", async () => {
    const env = await setup();
    const { items } = await chart.listAccounts(env.accounts);
    expect(items.map((a) => a.code)).toEqual(
      expect.arrayContaining([
        "1000",
        "1050",
        "1100",
        "1200",
        "1300",
        "1350",
        "1500",
        "1590",
        "2100",
        "2150",
        "3100",
        "3900",
        "4000",
        "4200",
        "5000",
        "5100",
        "6000",
        "6200",
        "6700",
        "6800",
        "6850",
        "6900",
        "7000",
      ]),
    );
    expect(items.find((a) => a.code === "1000")).toMatchObject({
      name: "Cash in Hand",
      isCash: true,
      manualPosting: true,
      balance: "0.00",
    });
    expect(items.find((a) => a.code === "1300")).toMatchObject({ manualPosting: false });

    const petty = await chart.createAccount(env.accounts, {
      name: "Petty Cash - Factory",
      subType: "CASH",
    });
    expect(petty).toMatchObject({ code: "1001", type: "ASSET", isCash: true });
    const interest = await chart.createAccount(env.accounts, {
      name: "Bank Interest Received",
      subType: "OTHER_INCOME",
      code: "4300",
    });
    expect(interest).toMatchObject({ code: "4300", type: "INCOME" });
    await expectAppError(
      chart.createAccount(env.accounts, { name: "Wrong block", subType: "CASH", code: "2500" }),
      "VALIDATION",
    );
    await expectAppError(
      chart.createAccount(env.accounts, { name: "petty cash - factory", subType: "CASH" }),
      "CONFLICT",
    );
    await expectAppError(
      chart.createAccount(env.accounts, { name: "Another", subType: "CASH", code: "1001" }),
      "CONFLICT",
    );
    await expectAppError(
      chart.createAccount(env.sales, { name: "Sales petty cash", subType: "CASH" }),
      "FORBIDDEN",
    );

    // Cash in hand on the go-live day; setting it again replaces the entry.
    await chart.setAccountOpeningBalance(env.accounts, env.acc.CASH, {
      amount: 50000,
      asOf: "2026-06-30",
    });
    const cash = await chart.setAccountOpeningBalance(env.accounts, env.acc.CASH, {
      amount: 60000,
      asOf: "2026-06-30",
    });
    expect(cash).toMatchObject({ balance: "60000.00", openingBalance: "60000.00" });
    expect(
      await prisma.journalEntry.count({
        where: { companyId: env.company.id, sourceType: "OPENING_BALANCE", sourceId: env.acc.CASH },
      }),
    ).toBe(1);
    expect(await balance(env.accounts, env.acc.OPENING_EQUITY)).toBe("60000.00");
    await expectAppError(
      chart.setAccountOpeningBalance(env.accounts, env.acc.RECEIVABLE, { amount: 100 }),
      "VALIDATION",
    );
    await expectAppError(
      chart.setAccountOpeningBalance(env.accounts, env.acc.INVENTORY, { amount: 100 }),
      "VALIDATION",
    );

    // Accounts in use stay active.
    await expectAppError(
      chart.updateAccount(env.accounts, env.acc.CASH, { isActive: false }),
      "CONFLICT",
    );
    await chart.setAccountOpeningBalance(env.accounts, petty.id, { amount: 2000 });
    await expectAppError(
      chart.updateAccount(env.accounts, petty.id, { isActive: false }),
      "CONFLICT",
    );
    await chart.setAccountOpeningBalance(env.accounts, petty.id, { amount: 0 });
    expect(await chart.updateAccount(env.accounts, petty.id, { isActive: false })).toMatchObject({
      isActive: false,
      balance: "0.00",
    });
  });

  it("posts journal vouchers and transfers, and reverses them", async () => {
    const env = await setup();
    await chart.setAccountOpeningBalance(env.accounts, env.acc.CASH, {
      amount: 60000,
      asOf: "2026-06-30",
    });
    const supplier = await env.party("Gazipur Knit Factory");

    const charges = await vouchers.createJournalVoucher(env.accounts, {
      date: "2026-07-02",
      description: "Bank charges for June",
      lines: [
        { accountId: env.acc.FINANCE_COST, debit: 500 },
        { accountId: env.acc.CASH, credit: 500 },
      ],
    });
    expect(charges).toMatchObject({
      number: expect.stringMatching(/^JV-/),
      sourceType: "MANUAL",
      total: "500.00",
    });
    expect(await balance(env.accounts, env.acc.CASH)).toBe("59500.00");

    const voucher = (lines: unknown[]) =>
      vouchers.createJournalVoucher(env.accounts, { description: "Adjustment", lines });
    // Production and sales never post to the books.
    await expectAppError(
      vouchers.createJournalVoucher(env.production, {
        description: "Adjustment",
        lines: [
          { accountId: env.acc.FINANCE_COST, debit: 10 },
          { accountId: env.acc.CASH, credit: 10 },
        ],
      }),
      "FORBIDDEN",
    );
    await expectAppError(
      voucher([
        { accountId: env.acc.FINANCE_COST, debit: 100 },
        { accountId: env.acc.CASH, credit: 90 },
      ]),
      "VALIDATION",
    );
    await expectAppError(
      voucher([
        { accountId: env.acc.INVENTORY, debit: 100 },
        { accountId: env.acc.CASH, credit: 100 },
      ]),
      "VALIDATION",
    );
    await expectAppError(
      voucher([
        { accountId: env.acc.CASH, debit: 100 },
        { accountId: env.acc.PAYABLE, credit: 100 },
      ]),
      "VALIDATION",
    );
    await expectAppError(
      voucher([
        { accountId: env.acc.FINANCE_COST, debit: 100, partyId: supplier.id },
        { accountId: env.acc.CASH, credit: 100 },
      ]),
      "VALIDATION",
    );
    await expect(
      voucher([
        { accountId: env.acc.FINANCE_COST, debit: 100, credit: 100 },
        { accountId: env.acc.CASH, credit: 100 },
      ]),
    ).rejects.toThrow(ZodError);

    const reversal = await vouchers.reverseJournalVoucher(env.accounts, charges.id, {
      reason: "The bank refunded the charges",
      date: "2026-07-03",
    });
    expect(reversal).toMatchObject({
      reversalOf: { id: charges.id },
      total: "500.00",
      lines: [
        expect.objectContaining({ debit: "0.00", credit: "500.00" }),
        expect.objectContaining({ debit: "500.00", credit: "0.00" }),
      ],
    });
    expect(await balance(env.accounts, env.acc.CASH)).toBe("60000.00");
    await expectAppError(
      vouchers.reverseJournalVoucher(env.accounts, charges.id, { reason: "Again please" }),
      "CONFLICT",
    );
    await expectAppError(
      vouchers.reverseJournalVoucher(env.accounts, reversal.id, { reason: "Undo the undo" }),
      "CONFLICT",
    );
    const opening = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId: env.company.id, sourceType: "OPENING_BALANCE" },
    });
    await expectAppError(
      vouchers.reverseJournalVoucher(env.accounts, opening.id, { reason: "Not a voucher" }),
      "CONFLICT",
    );

    // Transfers move money between cash, bank and wallets (Accounts only).
    const transfer = await vouchers.createTransfer(env.accounts, {
      fromAccountId: env.acc.CASH,
      toAccountId: env.acc.MOBILE_WALLET,
      amount: 10000,
      date: "2026-07-05",
      reference: "bKash agent deposit",
    });
    expect(transfer).toMatchObject({ sourceType: "TRANSFER", total: "10000.00" });
    expect(await balance(env.accounts, env.acc.CASH)).toBe("50000.00");
    expect(await balance(env.accounts, env.acc.MOBILE_WALLET)).toBe("10000.00");
    await expectAppError(
      vouchers.createTransfer(env.sales, {
        fromAccountId: env.acc.CASH,
        toAccountId: env.acc.MOBILE_WALLET,
        amount: 10,
      }),
      "FORBIDDEN",
    );
    await expectAppError(
      vouchers.createTransfer(env.accounts, {
        fromAccountId: env.acc.RECEIVABLE,
        toAccountId: env.acc.CASH,
        amount: 10,
      }),
      "VALIDATION",
    );
    await expect(
      vouchers.createTransfer(env.accounts, {
        fromAccountId: env.acc.CASH,
        toAccountId: env.acc.CASH,
        amount: 10,
      }),
    ).rejects.toThrow(ZodError);
    await vouchers.reverseJournalVoucher(env.accounts, transfer.id, {
      reason: "Deposit failed at the agent",
      date: "2026-07-06",
    });

    const cashLedger = await chart.getAccountLedger(env.accounts, env.acc.CASH, {
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(cashLedger.account.balance).toBe("60000.00");
    expect(cashLedger.summary).toEqual({
      openingBalance: "60000.00",
      totalDebit: "10500.00",
      totalCredit: "10500.00",
      closingBalance: "60000.00",
      transactionCount: 4,
    });
    expect(cashLedger.lines.map((l) => l.balance)).toEqual([
      "59500.00",
      "60000.00",
      "50000.00",
      "60000.00",
    ]);
    expect(cashLedger.lines[2]).toMatchObject({
      sourceType: "TRANSFER",
      particulars: "Mobile Wallets (bKash / Nagad / Rocket)",
      isReversed: true,
    });
    await expectBooksOk(env.accounts);
  });
});

run("bank accounts and statements", () => {
  beforeEach(resetDb);

  it("keeps one ledger per bank account and prints its statement", async () => {
    const env = await setup();
    await chart.setAccountOpeningBalance(env.accounts, env.acc.CASH, {
      amount: 50000,
      asOf: "2026-06-30",
    });
    const brac = await bank.createBankAccount(env.accounts, {
      bankName: "BRAC Bank",
      branch: "Gulshan",
      accountName: "Extras Fashion Ltd",
      accountNumber: "1501203456789001",
      openingBalance: 100000,
      openingDate: "2026-06-30",
    });
    // The first bank account takes over the general Bank account.
    expect(brac).toMatchObject({
      balance: "100000.00",
      ledgerAccount: { id: env.acc.BANK, code: "1100", name: "BRAC Bank 1501203456789001" },
    });
    const dbbl = await bank.createBankAccount(env.accounts, {
      bankName: "Dutch-Bangla Bank",
      accountName: "Extras Fashion Ltd",
      accountNumber: "1234567890",
    });
    expect(dbbl).toMatchObject({ balance: "0.00", ledgerAccount: { code: "1101" } });
    await expectAppError(
      bank.createBankAccount(env.accounts, {
        bankName: "BRAC Bank",
        accountName: "Extras",
        accountNumber: "1501203456789001",
      }),
      "CONFLICT",
    );
    await expectAppError(
      bank.createBankAccount(env.sales, {
        bankName: "City Bank",
        accountName: "Extras",
        accountNumber: "9999000011",
      }),
      "FORBIDDEN",
    );

    await vouchers.createTransfer(env.accounts, {
      fromAccountId: env.acc.CASH,
      toAccountId: env.acc.BANK,
      amount: 20000,
      date: "2026-07-10",
      reference: "Deposit slip 4471",
    });
    await vouchers.createJournalVoucher(env.accounts, {
      date: "2026-07-31",
      description: "SMS and account maintenance fee",
      lines: [
        { accountId: env.acc.FINANCE_COST, debit: 115 },
        { accountId: env.acc.BANK, credit: 115 },
      ],
    });
    const mill = await env.party("Narayanganj Fabrics");
    await supplierPayments.paySupplier(env.accounts, {
      supplierId: mill.id,
      amount: 30000,
      method: "BANK_TRANSFER",
      paymentDate: "2026-08-05",
      reference: "EFT 88120",
    });

    const statement = await bank.getBankStatement(env.accounts, brac.id, {
      from: "2026-07-01",
      to: "2026-08-31",
    });
    expect(statement).toMatchObject({
      title: "Bank Statement",
      bank: { bankName: "BRAC Bank", branch: "Gulshan", accountNumber: "1501203456789001" },
      period: { from: "2026-07-01", to: "2026-08-31" },
      summary: {
        openingBalance: "100000.00",
        totalDeposits: "20000.00",
        depositCount: 1,
        totalWithdrawals: "30115.00",
        withdrawalCount: 2,
        closingBalance: "89885.00",
        // Average of the 62 end-of-day balances.
        averageBalance: "103972.90",
      },
    });
    expect(statement.months).toEqual([
      {
        month: "2026-07",
        openingBalance: "100000.00",
        deposits: "20000.00",
        withdrawals: "115.00",
        transactionCount: 2,
        closingBalance: "119885.00",
        averageBalance: "114189.84",
      },
      {
        month: "2026-08",
        openingBalance: "119885.00",
        deposits: "0.00",
        withdrawals: "30000.00",
        transactionCount: 1,
        closingBalance: "89885.00",
        averageBalance: "93755.97",
      },
    ]);
    expect(statement.transactions.map((t) => [t.deposit, t.withdrawal, t.balance])).toEqual([
      ["20000.00", "0.00", "120000.00"],
      ["0.00", "115.00", "119885.00"],
      ["0.00", "30000.00", "89885.00"],
    ]);
    expect(statement.transactions[2]!.particulars).toContain("Narayanganj Fabrics");

    // A bank account with money in it cannot be closed.
    await expectAppError(
      bank.updateBankAccount(env.accounts, brac.id, { isActive: false }),
      "CONFLICT",
    );
    await bank.updateBankAccount(env.accounts, dbbl.id, { isActive: false });
    expect(await bank.listBankAccounts(env.accounts)).toEqual([
      expect.objectContaining({ id: brac.id, balance: "89885.00" }),
    ]);
    expect(await bank.listBankAccounts(env.accounts, { includeInactive: "true" })).toHaveLength(2);
    expect((await chart.getAccount(env.accounts, dbbl.ledgerAccountId)).isActive).toBe(false);
  });
});

run("fixed assets and depreciation", () => {
  beforeEach(resetDb);

  async function register(env: Env) {
    const dealer = await env.party("Dhaka Electronics");
    const juki = await assets.createFixedAsset(env.accounts, {
      name: "Juki sewing machine",
      category: "Machinery",
      purchaseDate: "2026-01-16",
      purchaseCost: 120000,
      depreciationRate: 10,
      acquisition: { kind: "PAID", method: "CASH" },
    });
    const ac = await assets.createFixedAsset(env.accounts, {
      name: "Office AC",
      category: "Office equipment",
      purchaseDate: "2026-03-01",
      purchaseCost: 60000,
      depreciationRate: 20,
      depreciationMethod: "REDUCING_BALANCE",
      acquisition: { kind: "CREDIT", supplierId: dealer.id, supplierRef: "INV-2231" },
    });
    const van = await assets.createFixedAsset(env.accounts, {
      name: "Delivery van",
      category: "Vehicles",
      purchaseDate: "2023-01-01",
      purchaseCost: 1500000,
      depreciationRate: 20,
      acquisition: { kind: "OPENING", accumulatedDepreciation: 300000, asOf: "2026-01-01" },
    });
    return { dealer, juki, ac, van };
  }

  it("registers assets bought for cash, on credit or owned at go-live", async () => {
    const env = await setup();
    const { dealer, juki, ac, van } = await register(env);
    expect(juki).toMatchObject({
      status: "IN_USE",
      bookValue: "120000.00",
      accumulatedDepreciation: "0.00",
      monthlyDepreciation: "1000.00",
      depreciatedUntil: null,
      purchaseDay: "2026-01-16",
    });
    expect(juki.history).toHaveLength(1);
    expect(juki.history[0]!.lines).toEqual([
      {
        account: { code: "1500", name: "Fixed Assets (at cost)" },
        debit: "120000.00",
        credit: "0.00",
      },
      { account: { code: "1000", name: "Cash in Hand" }, debit: "0.00", credit: "120000.00" },
    ]);
    expect(ac.history[0]!.lines.map((l) => l.account.code)).toEqual(["1500", "2100"]);
    expect((await ledger.getPartyBalance(env.accounts, dealer.id)).toFixed(2)).toBe("-60000.00");
    expect(van).toMatchObject({
      bookValue: "1200000.00",
      accumulatedDepreciation: "300000.00",
      depreciatedUntil: "2025-12-31",
    });
    expect(van.history[0]!.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ["1500", "1500000.00", "0.00"],
      ["1590", "0.00", "300000.00"],
      ["3900", "0.00", "1200000.00"],
    ]);

    const asset = {
      name: "Generator",
      purchaseDate: "2026-02-01",
      purchaseCost: 50000,
      acquisition: { kind: "PAID", method: "CASH" },
    };
    await expectAppError(assets.createFixedAsset(env.sales, asset), "FORBIDDEN");
    await expectAppError(assets.createFixedAsset(env.production, asset), "FORBIDDEN");
    await expectAppError(
      assets.createFixedAsset(env.accounts, { ...asset, salvageValue: 60000 }),
      "VALIDATION",
    );
    await expectAppError(
      assets.createFixedAsset(env.accounts, {
        ...asset,
        acquisition: { kind: "OPENING", accumulatedDepreciation: 60000 },
      }),
      "VALIDATION",
    );

    const list = await assets.listFixedAssets(env.accounts);
    expect(list.summary).toMatchObject({
      count: 3,
      cost: "1680000.00",
      accumulatedDepreciation: "300000.00",
      bookValue: "1380000.00",
    });
    await expectBooksOk(env.accounts);
  });

  it("posts depreciation month by month, once, and disposes of or removes assets", async () => {
    const env = await setup();
    const { dealer, juki, ac, van } = await register(env);

    const preview = await assets.previewDepreciation(env.accounts, { through: "2026-06-30" });
    const byName = new Map(preview.items.map((i) => [i.name, i]));
    // 16 days of January, then five full months at 1,000.
    expect(byName.get("Juki sewing machine")).toMatchObject({
      from: "2026-01-16",
      amount: "5516.13",
      bookValueAfter: "114483.87",
    });
    expect(byName.get("Juki sewing machine")!.months[0]).toMatchObject({
      month: "2026-01",
      days: 16,
      amount: "516.13",
    });
    expect(byName.get("Delivery van")).toMatchObject({ from: "2026-01-01", amount: "150000.00" });
    // Reducing balance: 20% a year off the book value, four months of it.
    const acCharge = Number(byName.get("Office AC")!.amount);
    expect(Math.abs(acCharge - 60000 * (1 - Math.pow(0.8, 4 / 12)))).toBeLessThan(0.05);

    await expectAppError(assets.runDepreciation(env.sales, { through: "2026-06-30" }), "FORBIDDEN");
    await expectAppError(
      assets.runDepreciation(env.accounts, { through: dayFromToday(1) }),
      "VALIDATION",
    );
    const posted = await assets.runDepreciation(env.accounts, { through: "2026-06-30" });
    expect(posted.items).toHaveLength(3);
    expect(posted.total).toBe(preview.total);
    // Running it again for the same month posts nothing.
    expect(await assets.runDepreciation(env.accounts, { through: "2026-06-30" })).toMatchObject({
      items: [],
      total: "0.00",
    });
    expect(await assets.getFixedAsset(env.accounts, juki.id)).toMatchObject({
      bookValue: "114483.87",
      accumulatedDepreciation: "5516.13",
      depreciatedUntil: "2026-06-30",
    });
    expect(await balance(env.accounts, env.acc.DEPRECIATION)).toBe(preview.total);
    await expectBooksOk(env.accounts);

    // Sold in August at a loss: depreciation to the 14th first.
    const sold = await assets.disposeFixedAsset(env.accounts, van.id, {
      date: "2026-08-15",
      proceeds: 1000000,
      method: "BANK_TRANSFER",
      reason: "Sold to Karim Motors",
    });
    expect(sold).toMatchObject({
      status: "DISPOSED",
      bookValue: "1013709.68",
      gainOnDisposal: "-13709.68",
      monthlyDepreciation: "0.00",
    });
    expect(sold.history.at(-2)).toMatchObject({
      description: expect.stringContaining("2026-07 to 2026-08"),
    });
    expect(sold.history.at(-1)!.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([
      ["1100", "1000000.00", "0.00"],
      ["1590", "486290.32", "0.00"],
      ["1500", "0.00", "1500000.00"],
      ["6850", "13709.68", "0.00"],
    ]);
    await expectAppError(
      assets.disposeFixedAsset(env.accounts, van.id, { reason: "Sold it twice" }),
      "CONFLICT",
    );
    await expectAppError(
      assets.disposeFixedAsset(env.sales, juki.id, { reason: "Scrap it now" }),
      "FORBIDDEN",
    );
    await expectAppError(
      assets.voidFixedAsset(env.accounts, van.id, { reason: "Wrong asset" }),
      "CONFLICT",
    );

    // Entered by mistake: its purchase and depreciation are reversed and it leaves the register.
    expect(
      await assets.voidFixedAsset(env.accounts, ac.id, { reason: "Entered twice by mistake" }),
    ).toEqual({ id: ac.id, removed: true, reversedEntries: 2 });
    await expectAppError(assets.getFixedAsset(env.accounts, ac.id), "NOT_FOUND");
    expect((await ledger.getPartyBalance(env.accounts, dealer.id)).toFixed(2)).toBe("0.00");

    const list = await assets.listFixedAssets(env.accounts);
    expect(list.items.map((a) => [a.name, a.status])).toEqual([
      ["Juki sewing machine", "IN_USE"],
      ["Delivery van", "DISPOSED"],
    ]);
    expect(list.summary).toMatchObject({ count: 1, cost: "120000.00", bookValue: "114483.87" });
    await expectBooksOk(env.accounts);
  });
});

run("capital, investors and loans", () => {
  beforeEach(resetDb);

  it("keeps a ledger per source and runs a loan's EMI schedule", async () => {
    const env = await setup();
    const owner = await capital.createCapitalSource(env.accounts, {
      kind: "OWNER_CAPITAL",
      name: "Mehadi Hasan",
      startDate: dayFromToday(-60),
      received: { amount: 500000, method: "BANK_TRANSFER" },
    });
    expect(owner).toMatchObject({
      status: "ACTIVE",
      isLiability: false,
      principal: "500000.00",
      outstanding: "500000.00",
    });
    expect(await chart.getAccount(env.accounts, owner.ledgerAccountId!)).toMatchObject({
      code: "3000",
      name: "Capital — Mehadi Hasan",
      type: "EQUITY",
      balance: "500000.00",
      manualPosting: false,
    });
    const source = {
      kind: "BANK_LOAN",
      name: "BRAC Bank SME Loan",
      interestRate: 12,
      startDate: dayFromToday(-45),
      received: { amount: 1200000, method: "BANK_TRANSFER" },
    };
    await expectAppError(capital.createCapitalSource(env.sales, source), "FORBIDDEN");
    await expectAppError(capital.createCapitalSource(env.production, source), "FORBIDDEN");
    const loan = await capital.createCapitalSource(env.accounts, source);
    expect(loan).toMatchObject({ isLiability: true, outstanding: "1200000.00" });
    expect((await chart.getAccount(env.accounts, loan.ledgerAccountId!)).code).toBe("2300");
    expect(await balance(env.accounts, env.acc.BANK)).toBe("1700000.00");

    // 12 monthly EMIs at 1% a month, the first two already past due.
    const plan = { plan: "EMI", count: 12, firstDueDate: dayFromToday(-40) };
    const preview = await capital.previewSchedule(env.accounts, loan.id, plan);
    expect(preview.installments[0]).toMatchObject({
      amount: "106618.55",
      interest: "12000.00",
      principal: "94618.55",
    });
    expect(preview.totals.principal).toBe("1200000.00");
    let current = await capital.scheduleInstallments(env.accounts, loan.id, plan);
    expect(current.installments).toHaveLength(12);
    expect(current.installments.slice(0, 3).map((i) => i.status)).toEqual([
      "OVERDUE",
      "OVERDUE",
      "SCHEDULED",
    ]);
    expect(current.totals.overdue.count).toBe(2);
    await expectAppError(capital.scheduleInstallments(env.accounts, loan.id, plan), "CONFLICT");
    expect((await capital.listInstallments(env.accounts, { overdue: "true" })).items).toHaveLength(
      2,
    );

    const first = current.installments[0]!;
    await expectAppError(
      capital.payInstallment(env.sales, first.id, { method: "BANK_TRANSFER" }),
      "FORBIDDEN",
    );
    current = await capital.payInstallment(env.accounts, first.id, { method: "BANK_TRANSFER" });
    expect(current).toMatchObject({
      outstanding: "1105381.45",
      totals: { returnsPaid: "12000.00", overdue: { count: 1 } },
    });
    expect(current.installments[0]).toMatchObject({ status: "PAID", principalPart: "94618.55" });
    expect(await balance(env.accounts, env.acc.FINANCE_COST)).toBe("12000.00");
    await expectAppError(
      capital.payInstallment(env.accounts, first.id, { method: "BANK_TRANSFER" }),
      "CONFLICT",
    );

    // Paid off early: the rest of the schedule is no longer needed.
    current = await capital.repayCapital(env.accounts, loan.id, {
      principal: 1105381.45,
      method: "BANK_TRANSFER",
      notes: "Early settlement",
    });
    expect(current).toMatchObject({ status: "SETTLED", outstanding: "0.00" });
    expect(current.installments.filter((i) => i.status === "SKIPPED")).toHaveLength(11);
    await expectAppError(
      capital.repayCapital(env.accounts, loan.id, { principal: 1, method: "CASH" }),
      "VALIDATION",
    );

    // Recorded by mistake: reversing it brings the loan and its schedule back.
    const settlement = current.ledger!.lines.find((l) => l.debit === "1105381.45")!;
    current = await capital.reverseCapitalEntry(env.accounts, loan.id, settlement.entryId, {
      reason: "The bank did not take the payment",
    });
    expect(current).toMatchObject({ status: "ACTIVE", outstanding: "1105381.45" });
    expect(current.installments.map((i) => i.status)).toEqual([
      "PAID",
      "OVERDUE",
      ...Array(10).fill("SCHEDULED"),
    ]);
    await expectBooksOk(env.accounts);
  });

  it("handles investors, owners' drawings and sources added by mistake", async () => {
    const env = await setup();
    const owner = await capital.createCapitalSource(env.accounts, {
      kind: "OWNER_CAPITAL",
      name: "Mehadi Hasan",
      received: { amount: 500000, method: "CASH" },
    });
    const investor = await capital.createCapitalSource(env.accounts, {
      kind: "INVESTOR",
      name: "Rahim Uddin",
      profitSharePct: 10,
      interestRate: 15,
      opening: { amount: 300000, asOf: dayFromToday(-90) },
    });
    expect(investor).toMatchObject({ outstanding: "300000.00", isLiability: true });
    expect((await chart.getAccount(env.accounts, investor.ledgerAccountId!)).code).toBe("2400");
    expect(await balance(env.accounts, env.acc.OPENING_EQUITY)).toBe("-300000.00");
    await expectAppError(
      capital.scheduleInstallments(env.accounts, owner.id, {
        plan: "EMI",
        count: 3,
        firstDueDate: dayFromToday(10),
      }),
      "VALIDATION",
    );
    await capital.addInstallment(env.accounts, investor.id, {
      dueDate: dayFromToday(-3),
      interestPart: 3750,
      note: "Quarterly return",
    });
    const overdue = await capital.listInstallments(env.accounts, { overdue: "true" });
    expect(overdue.items).toEqual([
      expect.objectContaining({
        status: "OVERDUE",
        amount: "3750.00",
        source: expect.objectContaining({ name: "Rahim Uddin" }),
      }),
    ]);

    // Owners take drawings (equity), not interest; and can withdraw capital.
    await capital.repayCapital(env.accounts, owner.id, { interest: 20000, method: "CASH" });
    await capital.repayCapital(env.accounts, owner.id, { principal: 50000, method: "CASH" });
    expect(await balance(env.accounts, env.acc.DRAWINGS)).toBe("-20000.00");
    expect(await balance(env.accounts, env.acc.FINANCE_COST)).toBe("0.00");
    expect((await capital.getCapitalSource(env.accounts, owner.id)).outstanding).toBe("450000.00");

    // A loan repaid in full cannot lose its receipt (it would be overpaid).
    const karim = await capital.createCapitalSource(env.accounts, {
      kind: "PRIVATE_LOAN",
      name: "Karim Bhai",
      received: { amount: 50000, method: "CASH" },
    });
    const repaid = await capital.repayCapital(env.accounts, karim.id, {
      principal: 50000,
      method: "CASH",
    });
    expect(repaid.status).toBe("SETTLED");
    const receipt = repaid.ledger!.lines.find((l) => l.credit === "50000.00")!;
    await expectAppError(
      capital.reverseCapitalEntry(env.accounts, karim.id, receipt.entryId, {
        reason: "Wrong lender",
      }),
      "CONFLICT",
    );
    expect(
      await capital.voidCapitalSource(env.accounts, karim.id, { reason: "Wrong lender entirely" }),
    ).toEqual({ id: karim.id, removed: true, reversedEntries: 2 });
    const archived = await chart.getAccount(env.accounts, karim.ledgerAccountId!);
    expect(archived).toMatchObject({ isActive: false, balance: "0.00" });
    expect(archived.name).toContain("(void)");

    expect((await capital.listCapitalSources(env.accounts)).summary).toEqual({
      ownerCapital: "450000.00",
      investors: "300000.00",
      loans: "0.00",
      liabilities: "300000.00",
      overdueInstallments: 1,
    });
    const overview = await reports.getAccountsOverview(env.accounts);
    expect(overview).toMatchObject({
      cash: { total: "430000.00" },
      liabilities: { loans: "0.00", investors: "300000.00", total: "300000.00" },
      installments: { overdue: { count: 1, amount: "3750.00" } },
    });
    await expectBooksOk(env.accounts);
  });
});

run("supplier payments", () => {
  beforeEach(resetDb);

  it("settles a supplier's oldest dues first and keeps bills in step with the ledger", async () => {
    const env = await setup();
    const mill = await env.party("Narayanganj Fabrics");
    // Owed from before go-live: the oldest due.
    await ledger.setOpeningBalance(env.admin, mill.id, { amount: -20000, asOf: "2026-06-30" });
    const project = await projects.createProject(env.production, {
      name: "Basics run",
      factoryName: "Own sewing floor",
      targetDate: dayFromToday(30),
      targetQuantity: 100,
    });
    const fabric = (await costs.listCostHeads(env.production)).find((h) => h.name === "Fabric")!;
    const bill = async (amount: number, billDate?: string) =>
      costs.createBill(env.production, {
        supplierId: mill.id,
        paymentType: "DUE",
        ...(billDate ? { billDate } : {}),
        allocations: [{ projectId: project.id, expenseHeadId: fabric.id, amount }],
      });
    const b1 = await bill(30000, "2026-07-05");
    const b2 = await bill(15000, "2026-07-20");

    const pay = (amount: number, paymentDate: string, method = "CASH") =>
      supplierPayments.paySupplier(env.accounts, {
        supplierId: mill.id,
        amount,
        paymentDate,
        method,
      });
    await expectAppError(
      supplierPayments.paySupplier(env.sales, { supplierId: mill.id, amount: 100 }),
      "FORBIDDEN",
    );
    await expectAppError(
      supplierPayments.paySupplier(env.production, { supplierId: mill.id, amount: 100 }),
      "FORBIDDEN",
    );
    const buyer = await env.party("Rahim Traders", "BUYER");
    await expectAppError(
      supplierPayments.paySupplier(env.accounts, { supplierId: buyer.id, amount: 100 }),
      "VALIDATION",
    );

    // 35,000: the opening 20,000, then 15,000 of the first bill.
    const p1 = await pay(35000, "2026-07-25");
    expect(p1).toMatchObject({
      number: expect.stringMatching(/^PV-/),
      bill: null,
      appliedTo: [
        { number: b1.number, amount: "15000.00", dueAfter: "15000.00", status: "PARTIALLY_PAID" },
      ],
      advanceLeft: "0.00",
      supplierNow: { payable: "30000.00" },
    });
    // 40,000: both bills, 10,000 left over as an advance.
    const p2 = await pay(40000, "2026-07-28", "BANK_TRANSFER");
    expect(p2.appliedTo.map((a) => [a.number, a.amount, a.status])).toEqual([
      [b1.number, "15000.00", "PAID"],
      [b2.number, "15000.00", "PAID"],
    ]);
    expect(p2).toMatchObject({
      advanceLeft: "10000.00",
      supplierNow: { payable: "-10000.00", openBills: [] },
    });
    // A new Due bill is settled by the advance straight away.
    const b3 = await bill(8000);
    expect(await billState(b3.id)).toEqual(["PAID", "8000.00", "0.00"]);

    // The first payment bounced: the bills are settled again without it.
    const voided = await supplierPayments.voidSupplierPayment(env.accounts, p1.id, {
      reason: "Cheque bounced",
    });
    expect(voided).toMatchObject({ isVoid: true, supplierNow: { payable: "33000.00" } });
    expect(await billState(b1.id)).toEqual(["PARTIALLY_PAID", "20000.00", "10000.00"]);
    expect(await billState(b2.id)).toEqual(["UNPAID", "0.00", "15000.00"]);
    expect(await billState(b3.id)).toEqual(["UNPAID", "0.00", "8000.00"]);
    await expectAppError(
      supplierPayments.voidSupplierPayment(env.accounts, p1.id, { reason: "Bounced twice" }),
      "CONFLICT",
    );
    await expectBooksOk(env.accounts);

    // Paid against one bill, then that supplier's other bill turns out to be a duplicate.
    await costs.payBill(env.accounts, b2.id, { amount: 5000, method: "CASH" });
    expect(await billState(b2.id)).toEqual(["PARTIALLY_PAID", "5000.00", "10000.00"]);
    await costs.voidBill(env.production, b1.id, { reason: "Duplicate of an earlier bill" });
    expect(await billState(b1.id)).toEqual(["VOID", "0.00", "0.00"]);
    expect(await billState(b2.id)).toEqual(["PAID", "15000.00", "0.00"]);
    expect(await billState(b3.id)).toEqual(["PAID", "8000.00", "0.00"]);
    expect((await ledger.getPartyBalance(env.accounts, mill.id)).toFixed(2)).toBe("2000.00");

    // A Due expense to the same supplier uses up the advance too.
    const office = (await expenses.listExpenseHeads(env.accounts)).find(
      (h) => h.name === "Office Supplies",
    )!;
    await expenses.createExpense(env.accounts, {
      headId: office.id,
      amount: 1500,
      paymentType: "DUE",
      supplierId: mill.id,
    });
    // A bill dated before the others is the oldest due, so it is paid first.
    const b4 = await bill(5000, "2026-07-01");
    expect(await billState(b4.id)).toEqual(["PAID", "5000.00", "0.00"]);
    expect(await billState(b3.id)).toEqual(["PARTIALLY_PAID", "5000.00", "3000.00"]);
    const now = await supplierPayments.getSupplierPayment(env.accounts, p2.id);
    expect(now.supplierNow).toMatchObject({
      payable: "4500.00",
      openBills: [expect.objectContaining({ number: b3.number, dueAmount: "3000.00" })],
    });
    expect(
      (
        await supplierPayments.listSupplierPayments(env.accounts, { supplierId: mill.id })
      ).items.map((p) => [p.number, p.isVoid]),
    ).toEqual([
      [expect.any(String), false],
      [p2.number, false],
      [p1.number, true],
    ]);
    await expectBooksOk(env.accounts);
  });

  it("counts a supplier's opening balance once it is set later", async () => {
    const env = await setup();
    const mill = await env.party("Narayanganj Fabrics");
    const project = await projects.createProject(env.production, {
      name: "Tees run",
      factoryName: "Own sewing floor",
      targetDate: dayFromToday(30),
      targetQuantity: 100,
    });
    const fabric = (await costs.listCostHeads(env.production)).find((h) => h.name === "Fabric")!;
    const b1 = await costs.createBill(env.production, {
      supplierId: mill.id,
      paymentType: "DUE",
      billDate: "2026-07-05",
      allocations: [{ projectId: project.id, expenseHeadId: fabric.id, amount: 10000 }],
    });
    await supplierPayments.paySupplier(env.accounts, {
      supplierId: mill.id,
      amount: 10000,
      paymentDate: "2026-07-10",
    });
    expect(await billState(b1.id)).toEqual(["PAID", "10000.00", "0.00"]);
    // The old due from before go-live is entered afterwards: the payment settled it first.
    await ledger.setOpeningBalance(env.admin, mill.id, { amount: -10000, asOf: "2026-06-30" });
    expect(await billState(b1.id)).toEqual(["UNPAID", "0.00", "10000.00"]);
    await expectBooksOk(env.accounts);
  });
});

run("expenses and claims", () => {
  beforeEach(resetDb);

  it("lets Accounts pay expenses and turns everyone else's into claims", async () => {
    const env = await setup();
    const heads = new Map((await expenses.listExpenseHeads(env.employee)).map((h) => [h.name, h]));
    expect([...heads.keys()]).toHaveLength(12);
    expect(heads.get("Conveyance")).toMatchObject({
      requiresEmployee: true,
      ledgerAccount: { code: "6700" },
    });
    expect(heads.get("Bank Charges")).toMatchObject({ ledgerAccount: { code: "7000" } });
    const head = (name: string) => heads.get(name)!.id;
    const sabbir = await prisma.employee.create({
      data: {
        companyId: env.company.id,
        code: "EMP-001",
        name: "Sabbir Ahmed",
        joinDate: new Date("2025-01-01"),
        baseSalary: 18000,
      },
    });

    // Accounts pays straight away.
    const rent = await expenses.createExpense(env.accounts, {
      headId: head("Office Rent"),
      amount: 25000,
      method: "BANK_TRANSFER",
      date: "2026-07-01",
      description: "July office rent",
    });
    expect(rent).toMatchObject({
      number: expect.stringMatching(/^EXP-/),
      status: "POSTED",
      paidFrom: { code: "1100" },
      createdBy: expect.objectContaining({ name: "accounts" }),
    });
    expect(await balance(env.accounts, env.acc.BANK)).toBe("-25000.00");

    // Anyone else's cash expense waits for Accounts.
    await expectAppError(
      expenses.createExpense(env.sales, { headId: head("Conveyance"), amount: 350 }),
      "VALIDATION",
    );
    const ride = await expenses.createExpense(env.sales, {
      headId: head("Conveyance"),
      amount: 350,
      employeeId: sabbir.id,
      purpose: "Buyer visit in Uttara",
      fromLocation: "Office",
      toLocation: "Uttara",
    });
    expect(ride).toMatchObject({ status: "PENDING", journalEntry: null, paidFrom: null });
    const courier = await expenses.createExpense(env.sales, {
      headId: head("Courier & Delivery"),
      amount: 800,
    });
    expect(courier.status).toBe("PENDING");
    expect((await reports.getAccountsOverview(env.accounts)).pendingClaims).toEqual({
      count: 2,
      amount: "1150.00",
    });

    // People see their own expenses; Accounts sees everything.
    expect((await expenses.listExpenses(env.sales)).items).toHaveLength(2);
    expect((await expenses.listExpenses(env.production)).items).toHaveLength(0);
    await expectAppError(expenses.getExpense(env.production, courier.id), "NOT_FOUND");
    expect((await expenses.listExpenses(env.accounts)).items).toHaveLength(3);
    expect((await expenses.listExpenses(env.accounts, { status: "PENDING" })).items).toHaveLength(
      2,
    );

    // The claimant can fix their claim until Accounts pays it.
    await expectAppError(expenses.approveExpense(env.sales, courier.id, {}), "FORBIDDEN");
    expect(await expenses.updateExpense(env.sales, courier.id, { amount: 850 })).toMatchObject({
      amount: "850.00",
    });
    await expectAppError(
      expenses.updateExpense(env.production, courier.id, { amount: 900 }),
      "FORBIDDEN",
    );
    const paid = await expenses.approveExpense(env.accounts, courier.id, { method: "BKASH" });
    expect(paid).toMatchObject({ status: "POSTED", paidFrom: { code: "1050" } });
    expect(await balance(env.accounts, env.acc.MOBILE_WALLET)).toBe("-850.00");
    expect(
      (await chart.listAccounts(env.accounts)).items.find((a) => a.code === "6400")?.balance,
    ).toBe("850.00");
    await expectAppError(
      expenses.updateExpense(env.sales, courier.id, { description: "Sundarban" }),
      "FORBIDDEN",
    );
    await expectAppError(
      expenses.updateExpense(env.accounts, courier.id, { amount: 900 }),
      "CONFLICT",
    );
    expect(
      await expenses.updateExpense(env.accounts, courier.id, { description: "Sundarban courier" }),
    ).toMatchObject({ description: "Sundarban courier", amount: "850.00" });

    // Withdrawn by its author; someone else's claim only Accounts can turn down.
    expect(
      await expenses.rejectExpense(env.sales, ride.id, { reason: "Recorded twice by mistake" }),
    ).toMatchObject({ status: "REJECTED" });
    await expectAppError(expenses.approveExpense(env.accounts, ride.id, {}), "CONFLICT");
    const food = await expenses.createExpense(env.employee, {
      headId: head("Food & Refreshments"),
      amount: 200,
      employeeId: sabbir.id,
      purpose: "Late night shipment",
    });
    await expectAppError(
      expenses.rejectExpense(env.production, food.id, { reason: "Not my team's claim" }),
      "FORBIDDEN",
    );
    expect(
      await expenses.rejectExpense(env.accounts, food.id, { reason: "No receipt attached" }),
    ).toMatchObject({ status: "REJECTED", voidReason: "No receipt attached" });

    // Voiding puts the money back; only Accounts can void.
    await expectAppError(
      expenses.voidExpense(env.sales, rent.id, { reason: "Paid by the agent" }),
      "FORBIDDEN",
    );
    expect(
      await expenses.voidExpense(env.accounts, rent.id, { reason: "Paid by the agent" }),
    ).toMatchObject({ status: "VOID", journalEntry: { isReversed: true } });
    expect(await balance(env.accounts, env.acc.BANK)).toBe("0.00");
    await expectAppError(
      expenses.voidExpense(env.accounts, rent.id, { reason: "Paid by the agent" }),
      "CONFLICT",
    );
    await expectAppError(
      expenses.voidExpense(env.accounts, ride.id, { reason: "It was rejected" }),
      "CONFLICT",
    );
    await expect(
      expenses.createExpense(env.accounts, { headId: head("Office Rent"), amount: 0 }),
    ).rejects.toThrow(ZodError);
    expect((await reports.getAccountsOverview(env.accounts)).pendingClaims.count).toBe(0);
    await expectBooksOk(env.accounts);
  });

  it("puts Due expenses on the supplier's account, through Accounts", async () => {
    const env = await setup();
    const heads = new Map(
      (await expenses.listExpenseHeads(env.accounts)).map((h) => [h.name, h.id]),
    );
    const printer = await env.party("Dhaka Print House");
    await expect(
      expenses.createExpense(env.sales, {
        headId: heads.get("Marketing & Ads")!,
        amount: 100,
        paymentType: "DUE",
      }),
    ).rejects.toThrow(ZodError);
    await expect(
      expenses.createExpense(env.sales, {
        headId: heads.get("Marketing & Ads")!,
        amount: 100,
        supplierId: printer.id,
      }),
    ).rejects.toThrow(ZodError);

    const flyers = await expenses.createExpense(env.sales, {
      headId: heads.get("Marketing & Ads")!,
      amount: 12000,
      paymentType: "DUE",
      supplierId: printer.id,
      description: "Eid flyers",
    });
    expect(flyers).toMatchObject({ status: "PENDING", supplier: { id: printer.id } });
    expect((await ledger.getPartyBalance(env.accounts, printer.id)).toFixed(2)).toBe("0.00");
    expect(await expenses.approveExpense(env.accounts, flyers.id, {})).toMatchObject({
      status: "POSTED",
      paidFrom: null,
    });
    expect((await ledger.getPartyBalance(env.accounts, printer.id)).toFixed(2)).toBe("-12000.00");

    const internet = await expenses.createExpense(env.accounts, {
      headId: heads.get("Internet & Phone")!,
      amount: 1500,
      paymentType: "DUE",
      supplierId: printer.id,
    });
    expect(internet.status).toBe("POSTED");
    expect((await ledger.getPartyBalance(env.accounts, printer.id)).toFixed(2)).toBe("-13500.00");
    await expenses.voidExpense(env.accounts, internet.id, { reason: "Billed to the wrong vendor" });
    expect((await ledger.getPartyBalance(env.accounts, printer.id)).toFixed(2)).toBe("-12000.00");

    // Expense heads belong to Accounts.
    await expectAppError(
      expenses.createExpenseHead(env.sales, { name: "Tea", category: "FOOD" }),
      "FORBIDDEN",
    );
    expect(
      await expenses.createExpenseHead(env.accounts, {
        name: "Factory Rent",
        category: "RENT",
      }),
    ).toMatchObject({ name: "Factory Rent", ledgerAccountId: null });
    await expectBooksOk(env.accounts);
  });
});

run("stock in the books", () => {
  beforeEach(resetDb);

  it("posts opening stock, count corrections and bad stock to the ledger", async () => {
    const env = await setup();
    const size = await catalog.createSize(env.admin, { name: "M" });
    const color = await catalog.createColor(env.admin, { name: "Navy", hexCode: "#1f2a44" });
    const tops = await catalog.createCategory(env.admin, { name: "Tops" });
    const style = await styles.createStyle(env.admin, {
      code: "EX-TS-001",
      name: "Basic Tee",
      categoryId: tops.id,
      retailPrice: 650,
      wholesalePrice: 400,
    });
    await matrix.generateMatrix(env.admin, style.id, { colorIds: [color.id], sizeIds: [size.id] });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { styleId: style.id } });

    await stock.adjustStock(env.admin, {
      variantId: variant.id,
      quantity: 10,
      type: "OPENING",
      unitCost: 50,
    });
    expect(await balance(env.accounts, env.acc.INVENTORY)).toBe("500.00");
    expect(await balance(env.accounts, env.acc.OPENING_EQUITY)).toBe("500.00");
    await stock.adjustStock(env.admin, {
      variantId: variant.id,
      quantity: -2,
      note: "Count short",
    });
    const bad = await stock.moveToBadStock(env.admin, {
      variantId: variant.id,
      quantity: 1,
      reason: "Stained",
    });
    expect(bad.journalEntryId).toEqual(expect.any(String));
    expect(await balance(env.accounts, env.acc.INVENTORY)).toBe("350.00");
    expect(await balance(env.accounts, env.acc.PRODUCTION_LOSS)).toBe("150.00");
    // Found three more on a recount: valued at average cost, the loss comes back.
    await stock.adjustStock(env.admin, { variantId: variant.id, quantity: 3 });
    expect(await balance(env.accounts, env.acc.INVENTORY)).toBe("500.00");
    expect(await balance(env.accounts, env.acc.PRODUCTION_LOSS)).toBe("0.00");
    const check = await reports.getBooksCheck(env.accounts);
    expect(check.checks.find((c) => c.key === "INVENTORY")).toMatchObject({
      ok: true,
      books: "500.00",
      register: "500.00",
    });
    expect(check.ok).toBe(true);
  });
});

run("profit and loss, balance sheet and trial balance", () => {
  beforeEach(resetDb);

  async function july(env: Env) {
    await chart.setAccountOpeningBalance(env.accounts, env.acc.CASH, {
      amount: 100000,
      asOf: "2026-06-30",
    });
    const jv = (date: string, description: string, debit: string, credit: string, amount: number) =>
      vouchers.createJournalVoucher(env.accounts, {
        date,
        description,
        lines: [
          { accountId: debit, debit: amount },
          { accountId: credit, credit: amount },
        ],
      });
    await jv("2026-07-10", "Cash sales", env.acc.CASH, env.acc.SALES, 50000);
    await jv("2026-07-10", "Cost of the goods sold", env.acc.COGS, env.acc.CASH, 30000);
    await jv("2026-07-12", "Scrap fabric sold", env.acc.CASH, env.acc.OTHER_INCOME, 1000);
    const rent = (await expenses.listExpenseHeads(env.accounts)).find(
      (h) => h.name === "Office Rent",
    )!;
    await expenses.createExpense(env.accounts, {
      headId: rent.id,
      amount: 5000,
      method: "CASH",
      date: "2026-07-15",
    });
    await assets.createFixedAsset(env.accounts, {
      name: "Cutting table",
      purchaseDate: "2026-07-01",
      purchaseCost: 12000,
      depreciationRate: 10,
      acquisition: { kind: "PAID", method: "CASH" },
    });
    await assets.runDepreciation(env.accounts, { through: "2026-07-31" });
    await jv("2026-07-31", "Bank charges", env.acc.FINANCE_COST, env.acc.CASH, 200);
    await jv("2026-08-05", "Cash sales", env.acc.CASH, env.acc.SALES, 10000);
  }

  it("works out profit and loss for any period, month by month", async () => {
    const env = await setup();
    await july(env);
    const pl = await reports.getProfitAndLoss(env.accounts, {
      from: "2026-07-01",
      to: "2026-07-31",
      byMonth: true,
    });
    expect(pl).toMatchObject({
      period: { period: "CUSTOM", from: "2026-07-01", to: "2026-07-31" },
      revenue: { total: "50000.00", lines: [expect.objectContaining({ code: "4000" })] },
      costOfSales: { total: "30000.00" },
      grossProfit: "20000.00",
      grossMarginPct: "40.0",
      otherIncome: { total: "1000.00" },
      expenses: { total: "5300.00" },
      netProfit: "15700.00",
      netMarginPct: "31.4",
      months: [
        expect.objectContaining({ month: "2026-07", revenue: "50000.00", netProfit: "15700.00" }),
      ],
    });
    const groups = new Map(pl.expenses.groups.map((g) => [g.key, g]));
    expect(groups.get("OPERATING")).toMatchObject({
      total: "5100.00",
      lines: [
        expect.objectContaining({ code: "6000", amount: "5000.00" }),
        expect.objectContaining({ code: "6800", amount: "100.00" }),
      ],
    });
    expect(groups.get("FINANCE")!.total).toBe("200.00");

    const twoMonths = await reports.getProfitAndLoss(env.accounts, {
      from: "2026-07-01",
      to: "2026-08-31",
      byMonth: "true",
    });
    expect(twoMonths).toMatchObject({ revenue: { total: "60000.00" }, netProfit: "25700.00" });
    expect(twoMonths.months!.map((m) => [m.month, m.netProfit])).toEqual([
      ["2026-07", "15700.00"],
      ["2026-08", "10000.00"],
    ]);
  });

  it("balances the balance sheet and the trial balance", async () => {
    const env = await setup();
    await july(env);
    const sheet = await reports.getBalanceSheet(env.accounts, { asOf: "2026-07-31" });
    expect(sheet).toMatchObject({
      asOf: "2026-07-31",
      assets: {
        current: { total: "103800.00" },
        fixed: { cost: "12000.00", accumulatedDepreciation: "100.00", netBookValue: "11900.00" },
        total: "115700.00",
      },
      liabilities: { total: "0.00" },
      equity: { total: "115700.00" },
      totalLiabilitiesAndEquity: "115700.00",
      balanced: true,
      difference: "0.00",
    });
    expect(sheet.equity.lines.map((l) => [l.name, l.amount])).toEqual([
      ["Opening Balance Equity", "100000.00"],
      ["Profit this financial year (from 2026-07-01)", "15700.00"],
    ]);

    const trial = await reports.getTrialBalance(env.accounts, { asOf: "2026-07-31" });
    expect(trial).toMatchObject({
      totals: { debit: "151100.00", credit: "151100.00" },
      balanced: true,
    });

    // With an August financial year, July's profit is kept from an earlier year.
    await prisma.company.update({
      where: { id: env.company.id },
      data: { fiscalYearStartMonth: 8 },
    });
    const augustYear = await contextFor(env.accounts.user.id, env.company.id);
    const later = await reports.getBalanceSheet(augustYear, { asOf: "2026-08-31" });
    expect(later).toMatchObject({ assets: { total: "125700.00" }, balanced: true });
    expect(later.equity.lines.map((l) => [l.name, l.amount])).toEqual([
      ["Opening Balance Equity", "100000.00"],
      ["Retained earnings (earlier years)", "15700.00"],
      ["Profit this financial year (from 2026-08-01)", "10000.00"],
    ]);
  });

  it("shows the money cards and checks the books", async () => {
    const env = await setup();
    await july(env);
    const overview = await reports.getAccountsOverview(env.accounts);
    expect(overview).toMatchObject({
      cash: { total: "113800.00" },
      stockValue: "0.00",
      fixedAssets: "11900.00",
      liabilities: { total: "0.00" },
      receivables: "0.00",
      payables: "0.00",
      pendingClaims: { count: 0 },
      netProfit: {
        financialYearFrom: financialYearStart(localDay(new Date(), TZ), 7),
      },
    });
    expect(overview.cash.accounts.map((a) => [a.code, a.balance])).toEqual([
      ["1000", "113800.00"],
      ["1050", "0.00"],
      ["1100", "0.00"],
    ]);
    const check = await reports.getBooksCheck(env.accounts);
    expect(check.checks.map((c) => c.key)).toEqual([
      "JOURNAL",
      "ENTRIES",
      "PARTY_LINES",
      "INVENTORY",
      "RAW_MATERIALS",
      "WORK_IN_PROGRESS",
      "FIXED_ASSETS",
      "DEPRECIATION",
      "CAPITAL",
      "SUPPLIER_BILLS",
      "EMPLOYEE_LINES",
      "EMPLOYEE_ADVANCES",
      "SALARIES_PAYABLE",
    ]);
    expect(check.ok).toBe(true);

    // A register that drifts from its ledger is caught.
    await prisma.fixedAsset.updateMany({
      where: { companyId: env.company.id },
      data: { currentValue: 11000 },
    });
    const drifted = await reports.getBooksCheck(env.accounts);
    expect(drifted.ok).toBe(false);
    expect(drifted.checks.find((c) => c.key === "DEPRECIATION")).toMatchObject({
      ok: false,
      books: "100.00",
      register: "1000.00",
    });
  });
});
