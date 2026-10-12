import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The last part of the HR & payroll overhaul: approved staff claims paid with
 * the salary (Basic + approved overtime + claims - absence - advance EMI =
 * take-home), salaries paid in parts, wallet payouts through the payout plug
 * (test mode), the employee's money ledger, company items in staff hands, and
 * leaving in one go: the clearance check, the login switched off and the
 * Experience & Clearance Certificate made in the background.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as chart from "@/modules/accounts/chart.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as reports from "@/modules/accounts/reports.service";
import * as expenses from "@/modules/expenses/expense.service";
import * as assets from "@/modules/hr/asset.service";
import * as claims from "@/modules/hr/claims.service";
import * as employees from "@/modules/hr/employee.service";
import * as exits from "@/modules/hr/exit.service";
import * as ledger from "@/modules/hr/ledger.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as screens from "@/modules/hr/screens.service";
import * as vault from "@/modules/hr/vault.service";
import { runDueJobs } from "@/modules/jobs/worker";
import { createRole } from "@/modules/rbac/role.service";
import { recordHref } from "@/modules/reminders/links";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** A Dhaka wall-clock time; 8 Oct 2026 is a Thursday. */
const at = (time: string, day = "2026-10-08") => new Date(`${day}T${time}:00+06:00`);
const meta = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (Linux; Android 14)" };
const SEP = "2026-09";

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return user;
  };
  const ownerUser = await member(roles.SUPER_ADMIN, "owner");
  const admin = await contextFor(ownerUser.id, company.id);
  const hrRole = await createRole(admin, {
    name: "HR Manager",
    permissions: ["hr.view", "hr.manage", "portal.self"],
  });
  const hrUser = await member(hrRole.id, "hr");
  const accountsUser = await member(roles.ACCOUNTS, "accounts");
  const sumonUser = await member(roles.EMPLOYEE, "sumon");
  const rinaUser = await member(roles.EMPLOYEE, "rina");
  const hire = async (name: string, userId: string | null, over: Record<string, unknown> = {}) => {
    const e = await employees.createEmployee(admin, {
      name,
      joinDate: "2025-01-01",
      salary: 30000,
      ...over,
    });
    if (userId) await employees.grantPortalAccess(admin, e.id, { userId });
    return e;
  };
  const sumon = await hire("Sumon Mia", sumonUser.id, {
    salaryMethod: "BKASH",
    walletNumber: "01711000001",
  });
  // A number no wallet takes.
  const rina = await hire("Rina Begum", rinaUser.id, {
    salaryMethod: "NAGAD",
    walletNumber: "123",
  });
  // Nasrin runs HR and is on the payroll too; Karim keeps the books.
  const nasrin = await hire("Nasrin Akter", hrUser.id);
  const karim = await hire("Karim Uddin", accountsUser.id);
  return {
    company,
    admin,
    hr: await contextFor(hrUser.id, company.id),
    accounts: await contextFor(accountsUser.id, company.id),
    sumonCtx: await contextFor(sumonUser.id, company.id),
    rinaCtx: await contextFor(rinaUser.id, company.id),
    users: { owner: ownerUser, hr: hrUser, accounts: accountsUser, sumon: sumonUser },
    sumon,
    rina,
    nasrin,
    karim,
    acc: await ensureControlAccounts(company.id),
  };
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

const balance = async (env: Env, accountId: string) =>
  (await chart.getAccount(env.accounts, accountId)).balance;
const inbox = (userId: string) =>
  prisma.notificationLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const lineOf = (r: { items: Array<{ employee: { id: string } }> }, employeeId: string) =>
  r.items.find((i) => i.employee.id === employeeId)! as Awaited<
    ReturnType<typeof payroll.getPayrollRun>
  >["items"][number];

async function expectBooksOk(env: Env) {
  const check = await reports.getBooksCheck(env.accounts);
  expect(check.checks.filter((c) => !c.ok)).toEqual([]);
}

/** Sumon's approved trip on a day, ready to be paid back. */
async function approvedTrip(env: Env, date: string, amount: number) {
  const c = await claims.submitClaim(
    env.sumonCtx,
    {
      kind: "CONVEYANCE",
      date,
      amount,
      fromPlace: "Head office",
      toPlace: "Mirpur 10",
      purpose: "Took samples to the buyer",
    },
    meta,
  );
  await claims.decideClaim(env.accounts, c.id, { decision: "APPROVE" }, meta);
  return prisma.staffClaim.findUniqueOrThrow({ where: { id: c.id } });
}

run("HR & payroll: claims with salary, parts, payouts and leaving", () => {
  let env: Env;
  let uploads: string;
  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-exit-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    vi.stubEnv("PAYOUT_PROVIDER", "");
    env = await setup();
    vi.useFakeTimers({ now: at("10:00"), toFake: ["Date"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(uploads, { recursive: true, force: true });
  });

  it("pays approved claims with the salary, once, and unties them on reopening", async () => {
    const september = await approvedTrip(env, "2026-09-20", 150);
    const october = await approvedTrip(env, "2026-10-05", 90);
    // Still waiting for Accounts: not paid with any salary.
    await claims.submitClaim(env.sumonCtx, {
      kind: "CONVEYANCE",
      date: "2026-09-21",
      amount: 60,
      fromPlace: "Head office",
      toPlace: "Gulshan",
      purpose: "Bank papers",
    });
    expect(await balance(env, env.acc.EMPLOYEE_PAYABLE)).toBe("240.00");

    const draft = await payroll.createPayrollRun(env.accounts, { month: SEP });
    const line = lineOf(draft, env.sumon.id);
    expect(line).toMatchObject({
      salary: "30000.00",
      reimbursements: "150.00",
      // Tied to the salary when it is approved.
      claims: [],
      netPay: "30150.00",
      paidAmount: "0.00",
      balance: "30150.00",
    });
    expect(lineOf(draft, env.rina.id)).toMatchObject({
      reimbursements: "0.00",
      netPay: "30000.00",
    });
    expect(draft.totals.reimbursements).toBe("150.00");
    // Before approval it is still owed on its own.
    expect((await claims.getMyClaims(env.sumonCtx)).owed).toEqual({ count: 2, amount: "240.00" });

    const approved = await payroll.approvePayrollRun(env.admin, draft.id, meta);
    expect(lineOf(approved, env.sumon.id).claims).toEqual([september.number]);
    expect(
      await prisma.staffClaim.findUniqueOrThrow({ where: { id: september.id } }),
    ).toMatchObject({ payrollItemId: line.id, paidAt: null });
    // The claim moved from Payable to Staff into the salary owed.
    expect(await balance(env, env.acc.EMPLOYEE_PAYABLE)).toBe("90.00");
    const mine = await claims.getMyClaims(env.sumonCtx);
    expect(mine.claims.find((c) => c.id === september.id)).toMatchObject({
      state: "SALARY",
      salary: "September 2026",
    });
    const ledgerRows = await claims.getClaimsLedger(env.accounts, { month: SEP });
    expect(ledgerRows.rows.find((r) => r.id === september.id)).toMatchObject({
      owed: false,
      salary: { label: "September 2026", runId: draft.id },
    });
    // Its expense can't be voided while the salary pays it back.
    const refused = await expectAppError(
      expenses.voidExpense(env.accounts, september.expenseId!, { reason: "Entered by mistake" }),
      "CONFLICT",
    );
    expect(refused.message).toContain("paid back with the September 2026 salary");
    // Paying back on its own leaves it out.
    expect(
      await claims.payBackClaims(env.accounts, { employeeId: env.sumon.id, method: "CASH" }, meta),
    ).toMatchObject({ count: 1, amount: "90.00" });
    expect(
      (await prisma.staffClaim.findUniqueOrThrow({ where: { id: october.id } })).paidAt,
    ).not.toBeNull();
    expect(
      (await prisma.staffClaim.findUniqueOrThrow({ where: { id: september.id } })).paidAt,
    ).toBeNull();

    // Reopening unties it: owed on its own again, and paid with the salary once approved again.
    await payroll.reopenPayrollRun(env.admin, draft.id, { reason: "Checking the claims" }, meta);
    expect(
      (await prisma.staffClaim.findUniqueOrThrow({ where: { id: september.id } })).payrollItemId,
    ).toBeNull();
    expect(await balance(env, env.acc.EMPLOYEE_PAYABLE)).toBe("150.00");
    expect((await claims.getMyClaims(env.sumonCtx)).owed).toEqual({ count: 1, amount: "150.00" });
    await payroll.recalculatePayrollRun(env.accounts, draft.id);
    await payroll.approvePayrollRun(env.admin, draft.id, meta);
    expect(
      (await prisma.staffClaim.findUniqueOrThrow({ where: { id: september.id } })).payrollItemId,
    ).toBe(line.id);
    await expectBooksOk(env);
  });

  it("pays a salary in parts, shows each part, and voids one", async () => {
    const september = await approvedTrip(env, "2026-09-20", 150);
    const draft = await payroll.createPayrollRun(env.accounts, { month: SEP });
    await payroll.approvePayrollRun(env.admin, draft.id, meta);
    const sumonLine = lineOf(draft, env.sumon.id);

    // HR can't pay; more than is left is refused.
    await expectAppError(
      payroll.payPayrollRun(env.hr, draft.id, {
        parts: [{ itemId: sumonLine.id, amount: 1000 }],
      }),
      "FORBIDDEN",
    );
    await expectAppError(
      payroll.payPayrollRun(env.accounts, draft.id, {
        parts: [{ itemId: sumonLine.id, amount: 30150.01 }],
      }),
      "VALIDATION",
    );
    await expect(
      payroll.payPayrollRun(env.accounts, draft.id, {
        itemIds: [sumonLine.id],
        parts: [{ itemId: sumonLine.id, amount: 1 }],
      }),
    ).rejects.toThrow("Choose lines or amounts, not both.");

    const first = await payroll.payPayrollRun(
      env.accounts,
      draft.id,
      { parts: [{ itemId: sumonLine.id, amount: 10000 }], method: "CASH" },
      meta,
    );
    expect(first.run.status).toBe("APPROVED");
    expect(lineOf(first.run, env.sumon.id)).toMatchObject({
      paid: false,
      paidAmount: "10000.00",
      balance: "20150.00",
    });
    expect(first.run.totals).toMatchObject({ paid: "10000.00" });
    const screen = await screens.getPayrollScreen(env.accounts, draft.id);
    expect(screen.unpaid.find((u) => u.id === sumonLine.id)).toMatchObject({
      paidAmount: "10000.00",
      balance: "20150.00",
    });
    expect(screen.can.pay).toBe(true);
    expect(screen.payouts).toEqual({ on: false, test: false });
    expect(
      (await prisma.staffClaim.findUniqueOrThrow({ where: { id: september.id } })).paidAt,
    ).toBeNull();

    // Sumon sees the part, and what is still to come.
    const slip = await payroll.myPayslip(env.sumonCtx, sumonLine.id);
    expect(slip.payment).toMatchObject({
      status: "PART_PAID",
      paid: "10000.00",
      balance: "20150.00",
    });
    expect(slip.payment.parts).toHaveLength(1);
    expect(slip.earnings.map((e) => e.label)).toContain(`Claims paid back (${september.number})`);
    const money = await ledger.myMoney(env.sumonCtx);
    expect(money.summary).toMatchObject({ salaryOwed: "20150.00", claimsOwed: "0.00" });
    expect(money.months).toHaveLength(1);
    expect(money.months[0]).toMatchObject({
      label: "September 2026",
      netPay: "30150.00",
      paid: "10000.00",
      balance: "20150.00",
      parts: [{ amount: "10000.00", method: "CASH", on: "2026-10-08", payout: null }],
    });
    expect(money.months[0]!.lines).toEqual([
      { label: "Basic salary for the month", amount: "30000.00", sign: "+" },
      { label: `Claims paid back (${september.number})`, amount: "150.00", sign: "+" },
    ]);
    expect((await inbox(env.users.sumon.id)).map((n) => n.subject)).toContain(
      "Part of your September 2026 salary paid",
    );
    expect(recordHref(env.sumonCtx, { type: "MySalary", id: sumonLine.id })).toBe("/me/ledger");

    // The rest for everyone: the payroll is paid, and the claim with it.
    const rest = await payroll.payPayrollRun(env.accounts, draft.id, { method: "CASH" }, meta);
    expect(rest.run.status).toBe("PAID");
    expect(lineOf(rest.run, env.sumon.id)).toMatchObject({
      paid: true,
      paidAmount: "30150.00",
      balance: "0.00",
    });
    expect(
      (await prisma.staffClaim.findUniqueOrThrow({ where: { id: september.id } })).paidAt,
    ).not.toBeNull();
    const paidSlip = await payroll.myPayslip(env.sumonCtx, sumonLine.id);
    expect(paidSlip.payment).toMatchObject({ status: "PAID", number: rest.number });
    expect(paidSlip.payment.parts.map((p) => p.amount)).toEqual(["10000.00", "20150.00"]);
    await expectAppError(
      payroll.payPayrollRun(env.accounts, draft.id, { method: "CASH" }),
      "CONFLICT",
    );

    // Voiding the first part: Sumon is owed it again, the claim is not paid back yet.
    const voided = await payroll.voidPayrollPayment(
      env.accounts,
      first.paymentId,
      { reason: "Paid from the wrong box" },
      meta,
    );
    expect(voided.status).toBe("APPROVED");
    expect(lineOf(voided, env.sumon.id)).toMatchObject({
      paid: false,
      paidAmount: "20150.00",
      balance: "10000.00",
    });
    expect(
      (await prisma.staffClaim.findUniqueOrThrow({ where: { id: september.id } })).paidAt,
    ).toBeNull();
    expect((await ledger.myMoney(env.sumonCtx)).months[0]!.parts).toHaveLength(1);
    const again = await payroll.payPayrollRun(
      env.accounts,
      draft.id,
      { itemIds: [sumonLine.id], method: "CASH" },
      meta,
    );
    expect(again.run.status).toBe("PAID");
    expect(
      (await prisma.staffClaim.findUniqueOrThrow({ where: { id: september.id } })).paidAt,
    ).not.toBeNull();
    expect(await balance(env, env.acc.SALARIES_PAYABLE)).toBe("0.00");
    await expectBooksOk(env);
  });

  it("sends salaries to wallets through the payout plug, and sends failed ones again", async () => {
    const draft = await payroll.createPayrollRun(env.accounts, { month: SEP });
    await payroll.approvePayrollRun(env.admin, draft.id, meta);
    const sumonLine = lineOf(draft, env.sumon.id);
    const rinaLine = lineOf(draft, env.rina.id);
    const karimLine = lineOf(draft, env.karim.id);

    // Off until a provider is set; only wallet methods send.
    const off = await expectAppError(
      payroll.payPayrollRun(env.accounts, draft.id, {
        itemIds: [sumonLine.id],
        method: "BKASH",
        sendToWallets: true,
      }),
      "UNAVAILABLE",
    );
    expect(off.message).toContain("not connected yet");
    vi.stubEnv("PAYOUT_PROVIDER", "log");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await screens.getPayrollScreen(env.accounts, draft.id)).payouts).toEqual({
      on: true,
      test: true,
    });
    await expectAppError(
      payroll.payPayrollRun(env.accounts, draft.id, {
        itemIds: [sumonLine.id],
        method: "CASH",
        sendToWallets: true,
      }),
      "VALIDATION",
    );
    const noWallet = await expectAppError(
      payroll.payPayrollRun(env.accounts, draft.id, {
        itemIds: [sumonLine.id, karimLine.id],
        method: "BKASH",
        sendToWallets: true,
      }),
      "VALIDATION",
    );
    expect(noWallet.message).toBe(
      "Karim Uddin has no wallet number. Add it on their page, or pay them another way.",
    );

    // Voided before the queue runs: nothing is sent.
    const stopped = await payroll.payPayrollRun(
      env.accounts,
      draft.id,
      { itemIds: [sumonLine.id], method: "BKASH", sendToWallets: true },
      meta,
    );
    await payroll.voidPayrollPayment(env.accounts, stopped.paymentId, { reason: "Wrong month" });
    expect(
      await prisma.payrollPaymentLine.findMany({
        where: { paymentId: stopped.paymentId },
        select: { payout: true },
      }),
    ).toEqual([{ payout: "CANCELLED" }]);
    await runDueJobs();

    const paid = await payroll.payPayrollRun(
      env.accounts,
      draft.id,
      { itemIds: [sumonLine.id, rinaLine.id], method: "BKASH", sendToWallets: true },
      meta,
    );
    const queued = await screens.getPayrollScreen(env.accounts, draft.id);
    const payment = () =>
      screens
        .getPayrollScreen(env.accounts, draft.id)
        .then((s) => s.payments.find((p) => p.id === paid.paymentId)!);
    expect(
      queued.payments.find((p) => p.id === paid.paymentId)!.lines.map((l) => l.payout),
    ).toEqual(["QUEUED", "QUEUED"]);
    expect(await runDueJobs()).toBe(1);
    let p = await payment();
    const byName = (name: string) => p.lines.find((l) => l.employee.name === name)!;
    expect(byName("Sumon Mia")).toMatchObject({
      payout: "SENT",
      payoutReference: expect.stringMatching(/^TEST-/),
      payoutError: null,
    });
    expect(byName("Rina Begum")).toMatchObject({
      payout: "FAILED",
      payoutError: "The wallet number is not a Bangladeshi mobile number.",
    });
    expect(p.canRetry).toBe(true);
    // The books already show both paid: the failed one waits for Accounts.
    expect(lineOf(paid.run, env.rina.id)).toMatchObject({ paid: true });

    await expectAppError(payroll.retrySalaryPayouts(env.hr, paid.paymentId), "FORBIDDEN");
    await prisma.employee.update({
      where: { id: env.rina.id },
      data: { walletNumber: "01811000002" },
    });
    expect(await payroll.retrySalaryPayouts(env.accounts, paid.paymentId, {}, meta)).toMatchObject({
      queued: 1,
    });
    await expectAppError(payroll.retrySalaryPayouts(env.accounts, paid.paymentId), "CONFLICT");
    expect(await runDueJobs()).toBe(1);
    p = await payment();
    expect(p.lines.map((l) => l.payout)).toEqual(["SENT", "SENT"]);
    expect(p.canRetry).toBe(false);
    // Running the job again sends nothing twice.
    expect(await runDueJobs()).toBe(0);
    const money = await ledger.myMoney(env.sumonCtx);
    expect(money.months[0]!.parts).toEqual([
      expect.objectContaining({ method: "BKASH", payout: "SENT", amount: "30000.00" }),
    ]);
    expect((await inbox(env.users.sumon.id)).map((n) => n.body)).toContain(
      "30000.00 paid by bKash to your wallet. Your September 2026 salary is paid in full.",
    );
    await expectBooksOk(env);
  });

  it("keeps the company items staff hold", async () => {
    const laptop = await assets.issueAsset(
      env.hr,
      {
        employeeId: env.sumon.id,
        name: "Dell laptop",
        kind: "LAPTOP",
        tag: "LT-0042",
        value: 65000,
        issuedOn: "2026-10-01",
      },
      meta,
    );
    expect(laptop).toMatchObject({ out: true, value: "65000.00", issuedBy: "hr" });
    await expectAppError(
      assets.issueAsset(env.accounts, {
        employeeId: env.sumon.id,
        name: "SIM",
        issuedOn: "2026-10-01",
      }),
      "FORBIDDEN",
    );
    const future = await expectAppError(
      assets.issueAsset(env.hr, { employeeId: env.sumon.id, name: "SIM", issuedOn: "2026-10-09" }),
      "VALIDATION",
    );
    expect(future.details).toMatchObject({ issuedOn: ["Pick today or an earlier day"] });
    await expectAppError(
      assets.issueAsset(env.hr, { employeeId: env.sumon.id, name: "SIM", issuedOn: "2024-12-31" }),
      "VALIDATION",
    );
    const sim = await assets.issueAsset(env.hr, {
      employeeId: env.rina.id,
      name: "Grameenphone SIM",
      kind: "SIM",
      tag: "01711-555555",
      issuedOn: "2026-10-02",
    });

    // Accounts (hr.view) reads the list; staff only their own.
    const list = await screens.getAssetsScreen(env.accounts, {});
    expect(list).toMatchObject({ show: "out", counts: { out: 2, returned: 0 }, people: [] });
    expect(list.can.manage).toBe(false);
    expect((await screens.getAssetsScreen(env.hr, { q: "lt-00" })).items.map((i) => i.id)).toEqual([
      laptop.id,
    ]);
    expect((await screens.getAssetsScreen(env.hr, {})).people.length).toBe(4);
    await expectAppError(assets.listAssets(env.sumonCtx, {}), "FORBIDDEN");
    expect((await assets.myAssets(env.sumonCtx)).out.map((i) => i.name)).toEqual(["Dell laptop"]);
    expect((await screens.getMyProfileScreen(env.sumonCtx)).items.out).toHaveLength(1);
    const told = (await inbox(env.users.sumon.id)).find((n) => n.entityType === "MyItems")!;
    expect(told.subject).toBe("Company item: Dell laptop (LT-0042)");
    expect(recordHref(env.sumonCtx, { type: told.entityType!, id: told.entityId })).toBe(
      "/me/profile#my-items",
    );

    // Lost needs a word on what happened; the day is between giving it and today.
    await expect(
      assets.returnAsset(env.hr, sim.id, { returnedOn: "2026-10-08", condition: "LOST" }),
    ).rejects.toThrow("Say what happened");
    await expectAppError(
      assets.returnAsset(env.hr, sim.id, { returnedOn: "2026-10-01", condition: "GOOD" }),
      "VALIDATION",
    );
    const back = await assets.returnAsset(
      env.hr,
      sim.id,
      { returnedOn: "2026-10-08", condition: "LOST", note: "Lost on the bus" },
      meta,
    );
    expect(back).toMatchObject({
      out: false,
      returnCondition: "LOST",
      returnedTo: "hr",
    });
    await expectAppError(
      assets.returnAsset(env.hr, sim.id, { returnedOn: "2026-10-08", condition: "GOOD" }),
      "CONFLICT",
    );
    expect(await assets.undoAssetReturn(env.hr, sim.id, meta)).toMatchObject({ out: true });
    await assets.returnAsset(env.hr, sim.id, { returnedOn: "2026-10-08", condition: "GOOD" });
    expect((await screens.getAssetsScreen(env.hr, { show: "returned" })).items).toHaveLength(1);
    expect(await assets.removeAsset(env.hr, sim.id, meta)).toEqual({ removed: true });
    expect(await prisma.employeeAsset.count()).toBe(1);

    const page = await screens.getEmployeeScreen(env.hr, env.sumon.id);
    expect(page.assets?.map((a) => a.name)).toEqual(["Dell laptop"]);
    expect(page.can).toMatchObject({ giveItem: true, changeItems: true, deactivate: true });
    expect(page.clearance?.can).toEqual({ deactivate: false, certificate: false });
    // Accounts sees the items, but not the clearance.
    const accountsPage = await screens.getEmployeeScreen(env.accounts, env.sumon.id);
    expect(accountsPage.assets).toHaveLength(1);
    expect(accountsPage.clearance).toBeNull();
    expect(accountsPage.can.deactivate).toBe(false);
  });

  it("deactivates someone in one go and makes the clearance certificate", async () => {
    const laptop = await assets.issueAsset(env.hr, {
      employeeId: env.sumon.id,
      name: "Dell laptop",
      kind: "LAPTOP",
      tag: "LT-0042",
      issuedOn: "2026-10-01",
    });
    const before = await exits.getClearance(env.hr, env.sumon.id);
    expect(before).toMatchObject({
      today: "2026-10-08",
      salaryOwed: "0.00",
      advancesOwed: "0.00",
      claimsOwed: "0.00",
      claimsWaiting: 0,
      finalPayrollMissing: null,
      login: { email: "sumon@extras.test", active: true, canSwitchOff: true },
      certificates: [],
      making: false,
      can: { deactivate: false, certificate: false },
    });
    expect(before.items.map((i) => i.id)).toEqual([laptop.id]);
    await expectAppError(exits.getClearance(env.accounts, env.sumon.id), "FORBIDDEN");

    const held = await expectAppError(
      exits.deactivateEmployee(env.hr, env.sumon.id, {
        exitDate: "2026-10-08",
        status: "RESIGNED",
      }),
      "CONFLICT",
    );
    expect(held.message).toBe(
      "Sumon Mia still has Dell laptop (LT-0042). Take it back, or mark it lost, first.",
    );
    await assets.returnAsset(env.hr, laptop.id, { returnedOn: "2026-10-08", condition: "GOOD" });

    const later = await expectAppError(
      exits.deactivateEmployee(env.hr, env.sumon.id, {
        exitDate: "2026-10-31",
        status: "RESIGNED",
      }),
      "VALIDATION",
    );
    expect(later.message).toBe("The last working day is still to come.");
    await expectAppError(
      exits.deactivateEmployee(env.hr, env.nasrin.id, {
        exitDate: "2026-10-08",
        status: "RESIGNED",
      }),
      "FORBIDDEN",
    );
    await expectAppError(
      exits.deactivateEmployee(env.accounts, env.sumon.id, {
        exitDate: "2026-10-08",
        status: "RESIGNED",
      }),
      "FORBIDDEN",
    );

    const done = await exits.deactivateEmployee(
      env.hr,
      env.sumon.id,
      { exitDate: "2026-10-08", status: "RESIGNED", reason: "Moving to Chattogram" },
      meta,
    );
    expect(done).toEqual({
      employeeId: env.sumon.id,
      login: "OFF",
      loginRole: "Employee",
      loginProblem: null,
    });
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: env.sumon.id } });
    expect(row).toMatchObject({ status: "RESIGNED", exitReason: "Moving to Chattogram" });
    expect(row.exitDate?.toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(
      await prisma.companyMembership.findFirstOrThrow({
        where: { userId: env.users.sumon.id, companyId: env.company.id },
        select: { isActive: true },
      }),
    ).toEqual({ isActive: false });
    const making = await exits.getClearance(env.hr, env.sumon.id);
    expect(making).toMatchObject({ making: true, certificates: [], login: { active: false } });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Employee", entityId: env.sumon.id, action: "STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.summary).toContain(
      "deactivated, login switched off, clearance certificate requested",
    );

    // The queue makes the certificate and keeps it in Sumon's papers.
    expect(await runDueJobs()).toBe(1);
    const doc = await prisma.employeeDocument.findFirstOrThrow({
      where: { employeeId: env.sumon.id, kind: "CLEARANCE" },
      include: { file: true },
    });
    expect(doc).toMatchObject({
      title: "Experience and clearance certificate, 8 Oct 2026",
      addedById: env.users.hr.id,
    });
    expect(doc.file).toMatchObject({ mimeType: "application/pdf" });
    expect(doc.file.fileName).toBe(
      `Extras - Experience and clearance - ${env.sumon.code} Sumon Mia.pdf`,
    );
    const bytes = await readFile(path.join(uploads, doc.file.storagePath));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.includes(Buffer.from("/Encrypt"))).toBe(true);
    // Kept for the record.
    await expectAppError(vault.removeEmployeeDocument(env.hr, doc.id), "FORBIDDEN");

    const after = await exits.getClearance(env.hr, env.sumon.id);
    expect(after).toMatchObject({
      making: false,
      can: { deactivate: true, certificate: true },
      employee: { exitDate: "2026-10-08", status: "RESIGNED" },
    });
    expect(after.certificates.map((c) => c.id)).toEqual([doc.id]);
    // Made again (after the final salary, say): a second copy, the first kept.
    expect(await exits.remakeCertificate(env.hr, env.sumon.id, meta)).toEqual({
      employeeId: env.sumon.id,
      making: true,
    });
    vi.setSystemTime(at("11:00"));
    expect(await runDueJobs()).toBe(1);
    expect(
      await prisma.employeeDocument.count({
        where: { employeeId: env.sumon.id, kind: "CLEARANCE" },
      }),
    ).toBe(2);
    await expectAppError(exits.remakeCertificate(env.hr, env.rina.id), "CONFLICT");

    // A login that is not an Employee login stays on for someone who manages users.
    const karim = await exits.deactivateEmployee(env.hr, env.karim.id, {
      exitDate: "2026-10-07",
      status: "TERMINATED",
    });
    expect(karim).toMatchObject({ login: "KEPT", loginRole: "Accounts" });
    expect(
      await prisma.companyMembership.findFirstOrThrow({
        where: { userId: env.users.accounts.id, companyId: env.company.id },
        select: { isActive: true },
      }),
    ).toEqual({ isActive: true });
  });
});
