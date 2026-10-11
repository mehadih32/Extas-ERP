import { beforeEach, describe, expect, it } from "vitest";

import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import * as assetScreens from "@/modules/accounts/asset-screens.service";
import * as assets from "@/modules/accounts/asset.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as breakdown from "@/modules/accounts/expense-breakdown.service";
import { addDays, addMonths, monthStart } from "@/modules/accounts/periods";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import * as expenses from "@/modules/expenses/expense.service";
import * as employees from "@/modules/hr/employee.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
const today = () => localDay(new Date(), TZ);
/** Last month: its first day, a day in it, and its "?costs=" value. */
const lastMonth = () => monthStart(addMonths(monthStart(today()), -1));
const dayOfLastMonth = (n: number) => addDays(lastMonth(), n - 1);
const lastMonthParam = () => lastMonth().slice(0, 7);

/**
 * Extas with, all last month unless noted:
 *   payroll   Rahim (30,000 + a 500 bonus, paid) and Karim (20,000, not paid)
 *   salary    a 1,200 QC bill paid to Karim, 700 under the same head to nobody
 *   running   rent 45,000 and 5,000, electricity 12,400; marketing 6,000
 *             voided; rent 1,000 this month
 *   assets    a laptop paid 85,000, an AC on credit 60,000 from Cool Air,
 *             and a machine owned since 2020
 *   paid      Gazipur Knit 20,000 and 10,000, Padma Trims 15,000 and 3,000
 *             (voided), Gazipur 1,000 this month
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
  const salesCtx = await member("SALES_EXECUTIVE", "sales");
  await ensureControlAccounts(company.id);

  const hire = (name: string, salary: number) =>
    employees.createEmployee(ctx, { name, joinDate: "2025-01-01", salary });
  const rahim = await hire("Rahim Uddin", 30000);
  const karim = await hire("Karim Mia", 20000);
  const run = await payroll.createPayrollRun(ctx, { month: lastMonthParam() });
  await payroll.setPayrollBonus(ctx, run.id, { amount: 500, employeeIds: [rahim.id] });
  await payroll.approvePayrollRun(ctx, run.id);
  const rahimItem = await prisma.payrollItem.findFirstOrThrow({
    where: { runId: run.id, employeeId: rahim.id },
  });
  await payroll.payPayrollRun(accountsCtx, run.id, { itemIds: [rahimItem.id], method: "CASH" });

  await expenses.ensureGeneralExpenseHeads(company.id);
  const heads = Object.fromEntries(
    (await expenses.listExpenseHeads(ctx)).map((h: { name: string; id: string }) => [h.name, h.id]),
  ) as Record<string, string>;
  const qc = await expenses.createExpenseHead(ctx, { name: "QC Bill", category: "SALARY" });
  const spend = (headId: string, amount: number, date: string, employeeId?: string) =>
    expenses.createExpense(accountsCtx, {
      headId,
      amount,
      date,
      paymentType: "CASH_BANK",
      method: "CASH",
      employeeId,
    });
  await spend(qc.id, 1200, dayOfLastMonth(10), karim.id);
  await spend(qc.id, 700, dayOfLastMonth(11));
  await spend(heads["Office Rent"]!, 45000, dayOfLastMonth(2));
  await spend(heads["Office Rent"]!, 5000, dayOfLastMonth(20));
  await spend(heads["Electricity, Water & Gas"]!, 12400, dayOfLastMonth(5));
  const marketing = await spend(heads["Marketing & Ads"]!, 6000, dayOfLastMonth(6));
  await expenses.voidExpense(ctx, marketing.id, { reason: "Entered twice" });
  await spend(heads["Office Rent"]!, 1000, today());

  const party = async (name: string) =>
    (await parties.createParty(ctx, { kind: "SUPPLIER", name })).party;
  const gazipur = await party("Gazipur Knit");
  const padma = await party("Padma Trims");
  const coolAir = await party("Cool Air");
  await ledger.setOpeningBalance(ctx, gazipur.id, { amount: -50000 });
  const pay = (supplierId: string, amount: number, paymentDate: string) =>
    supplierPayments.paySupplier(accountsCtx, { supplierId, amount, paymentDate, method: "CASH" });
  await pay(gazipur.id, 20000, dayOfLastMonth(5));
  await pay(gazipur.id, 10000, dayOfLastMonth(20));
  await pay(padma.id, 15000, dayOfLastMonth(8));
  const mistake = await pay(padma.id, 3000, dayOfLastMonth(9));
  await supplierPayments.voidSupplierPayment(accountsCtx, mistake.id, { reason: "Wrong supplier" });
  await pay(gazipur.id, 1000, today());

  const laptop = await assets.createFixedAsset(ctx, {
    name: "Dell laptop",
    category: "Computers & IT",
    purchaseDate: dayOfLastMonth(12),
    purchaseCost: 85000,
    depreciationRate: 20,
    acquisition: { kind: "PAID", method: "CASH" },
  });
  const ac = await assets.createFixedAsset(ctx, {
    name: "Office AC",
    category: "Air conditioners",
    purchaseDate: dayOfLastMonth(15),
    purchaseCost: 60000,
    depreciationRate: 10,
    acquisition: { kind: "CREDIT", supplierId: coolAir.id },
  });
  const machine = await assets.createFixedAsset(ctx, {
    name: "Juki machine",
    category: "Machinery",
    purchaseDate: "2020-01-15",
    purchaseCost: 120000,
    acquisition: { kind: "OPENING", accumulatedDepreciation: 20000 },
  });
  return {
    company,
    ctx,
    accountsCtx,
    salesCtx,
    rahim,
    karim,
    run,
    qc,
    gazipur,
    padma,
    coolAir,
    laptop,
    ac,
    machine,
  };
}

run("accounts: the expense breakdown and the fixed asset screens", () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("splits a month into salaries, running costs, assets bought and suppliers paid", async () => {
    const b = await breakdown.getExpenseBreakdown(env.accountsCtx, lastMonthParam());
    expect(b.period).toMatchObject({
      year: Number(lastMonth().slice(0, 4)),
      month: Number(lastMonth().slice(5, 7)),
      from: lastMonth(),
    });
    expect(b.period.years[0]).toBe(Number(today().slice(0, 4)));

    // Salaries: net pay by the payroll's month, what is paid, and the QC bills.
    expect(b.salaries).toMatchObject({
      netPay: "50500.00",
      paid: "30500.00",
      unpaid: "20000.00",
      otherPay: "1900.00",
      total: "52400.00",
      unnamed: "700.00",
    });
    expect(b.salaries.employees.map((e) => [e.name, e.total, e.unpaid, e.otherPay])).toEqual([
      ["Rahim Uddin", "30500.00", "0.00", "0.00"],
      ["Karim Mia", "21200.00", "20000.00", "1200.00"],
    ]);

    // Running costs per head: posted only (the voided marketing is out), salaries apart.
    expect(b.adminCosts.total).toBe("62400.00");
    expect(b.adminCosts.count).toBe(3);
    expect(b.adminCosts.heads.map((h) => [h.name, h.amount, h.count])).toEqual([
      ["Office Rent", "50000.00", 2],
      ["Electricity, Water & Gas", "12400.00", 1],
    ]);

    // Assets bought in the month, newest first; the 2020 machine is not one of them.
    expect(b.assets.total).toBe("145000.00");
    expect(b.assets.assets.map((a) => [a.name, a.cost, a.boughtOn])).toEqual([
      ["Office AC", "60000.00", dayOfLastMonth(15)],
      ["Dell laptop", "85000.00", dayOfLastMonth(12)],
    ]);

    // Suppliers by money paid; the voided payment does not count.
    expect(b.vendors.total).toBe("45000.00");
    expect(b.vendors.suppliers.map((s) => [s.name, s.amount, s.payments])).toEqual([
      ["Gazipur Knit", "30000.00", 2],
      ["Padma Trims", "15000.00", 1],
    ]);
    expect(b.can).toEqual({ recordAsset: true, openParty: true });
  });

  it("covers this month by default and a whole year on request", async () => {
    const now = await breakdown.getExpenseBreakdown(env.accountsCtx);
    expect(now.period.month).toBe(Number(today().slice(5, 7)));
    expect(now.salaries.employees).toEqual([]);
    expect(now.adminCosts.heads.map((h) => [h.name, h.amount])).toEqual([
      ["Office Rent", "1000.00"],
    ]);
    expect(now.vendors.suppliers.map((s) => [s.name, s.amount])).toEqual([
      ["Gazipur Knit", "1000.00"],
    ]);

    const year = lastMonth().slice(0, 4);
    const sameYear = today().startsWith(year);
    const whole = await breakdown.getExpenseBreakdown(env.accountsCtx, year);
    expect(whole.period).toMatchObject({ month: null, from: `${year}-01-01`, to: `${year}-12-31` });
    expect(whole.adminCosts.total).toBe(sameYear ? "63400.00" : "62400.00");
    expect(whole.vendors.total).toBe(sameYear ? "46000.00" : "45000.00");
    expect(whole.salaries.total).toBe("52400.00");

    await expect(breakdown.getExpenseBreakdown(env.accountsCtx, "2026-13")).rejects.toThrow(
      /month or a year/,
    );
  });

  it("shows one employee's pay month by month, with the QC bill in its own column", async () => {
    const year = String(lastMonth().slice(0, 4));
    const month = Number(lastMonth().slice(5, 7));
    const karim = await breakdown.getEmployeePay(env.accountsCtx, env.karim.id, year);
    expect(karim.heads.map((h) => h.name)).toEqual(["QC Bill"]);
    expect(karim.months).toHaveLength(1);
    expect(karim.months[0]).toMatchObject({
      month,
      payroll: {
        runId: env.run.id,
        basic: "20000.00",
        bonus: "0.00",
        deductions: "0.00",
        netPay: "20000.00",
        paidOn: null,
      },
      other: ["1200.00"],
      total: "21200.00",
    });
    expect(karim.totals).toMatchObject({
      netPay: "20000.00",
      unpaid: "20000.00",
      otherPay: "1200.00",
      total: "21200.00",
    });

    const rahim = await breakdown.getEmployeePay(env.accountsCtx, env.rahim.id, year);
    expect(rahim.heads).toEqual([]);
    expect(rahim.months[0]!.payroll).toMatchObject({
      basic: "30000.00",
      bonus: "500.00",
      netPay: "30500.00",
      paidOn: today(),
    });
    expect(rahim.totals.unpaid).toBe("0.00");

    // Another year has nothing; someone who does not see salaries is refused.
    const before = await breakdown.getEmployeePay(env.accountsCtx, env.rahim.id, "2021");
    expect(before.months).toEqual([]);
    await expect(breakdown.getEmployeePay(env.salesCtx, env.rahim.id)).rejects.toThrow(
      /permission to see salaries/,
    );
    await expect(breakdown.getEmployeePay(env.accountsCtx, "missing")).rejects.toThrow(
      /not found/i,
    );
  });

  it("lists the register, records depreciation and tells how each asset was bought", async () => {
    const register = await assetScreens.getAssetRegister(env.accountsCtx);
    expect(register.summary).toMatchObject({
      count: 3,
      cost: "265000.00",
      accumulatedDepreciation: "20000.00",
      bookValue: "245000.00",
    });
    expect(register.assets.map((a) => a.name)).toEqual([
      "Office AC",
      "Dell laptop",
      "Juki machine",
    ]);
    expect(register.can).toEqual({ record: true, depreciate: true });
    // Up to the end of last month the laptop and the AC lose value; the machine has no rate.
    expect(register.depreciation.assets.map((a) => a.name).sort()).toEqual([
      "Dell laptop",
      "Office AC",
    ]);

    const laptop = await assetScreens.getAssetScreen(env.accountsCtx, env.laptop.id);
    expect(laptop.acquired).toMatchObject({ kind: "PAID", supplier: null });
    expect(laptop.asset).toMatchObject({ cost: "85000.00", bookValue: "85000.00" });
    expect(laptop.entries).toHaveLength(1);
    expect(laptop.can).toMatchObject({ edit: true, dispose: true, sell: true, remove: true });
    const ac = await assetScreens.getAssetScreen(env.accountsCtx, env.ac.id);
    expect(ac.acquired).toMatchObject({
      kind: "CREDIT",
      supplier: { id: env.coolAir.id, name: "Cool Air" },
    });
    const machine = await assetScreens.getAssetScreen(env.accountsCtx, env.machine.id);
    expect(machine.acquired.kind).toBe("OPENING");

    await assets.runDepreciation(env.accountsCtx, { through: register.depreciation.through });
    const after = await assetScreens.getAssetRegister(env.accountsCtx);
    expect(after.depreciation.assets).toEqual([]);
    expect(after.summary.accumulatedDepreciation).toBe(
      (20000 + Number(register.depreciation.total)).toFixed(2),
    );
    const posted = await assetScreens.getAssetScreen(env.accountsCtx, env.laptop.id);
    expect(posted.entries.map((e) => e.kind)).toEqual(["FIXED_ASSET", "DEPRECIATION"]);
    expect(posted.asset.depreciatedUntil).toBe(register.depreciation.through);

    const form = await assetScreens.getAssetForm(env.accountsCtx);
    expect(form.categories).toEqual(expect.arrayContaining(["Air conditioners", "Machinery"]));
    expect(form.can.payNow).toBe(true);
    expect(form.accounts.length).toBeGreaterThan(0);
    const edit = await assetScreens.getAssetForm(env.accountsCtx, env.ac.id);
    expect(edit.asset).toMatchObject({ name: "Office AC", depreciationRate: "10.00" });
    await expect(assetScreens.getAssetForm(env.salesCtx)).rejects.toThrow(/Only Accounts/);
  });
});
