import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Staff claims: conveyance and local material paid from the employee's own
 * pocket, sent from My HR. Each claim is checked against the day's duty, the
 * GPS trail, the usual fare and Google's road distance, and flagged for
 * Accounts; the employee never sees the flags. Approving puts it in the books
 * (local material on the production project's cost), owed to the employee in
 * Payable to Staff (2270), until Accounts pays it back.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as chart from "@/modules/accounts/chart.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as reports from "@/modules/accounts/reports.service";
import * as expenses from "@/modules/expenses/expense.service";
import * as attendance from "@/modules/hr/attendance.service";
import * as claims from "@/modules/hr/claims.service";
import * as employees from "@/modules/hr/employee.service";
import * as location from "@/modules/hr/location.service";
import * as settings from "@/modules/hr/settings.service";
import { runDueJobs } from "@/modules/jobs/worker";
import * as costs from "@/modules/production/cost.service";
import * as projects from "@/modules/production/project.service";
import { createRole } from "@/modules/rbac/role.service";
import { recordHref } from "@/modules/reminders/links";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** A Dhaka wall-clock time; 5 Oct 2026 is a Monday, 2 Oct a Friday (the weekly day off). */
const at = (time: string, day = "2026-10-05") => new Date(`${day}T${time}:00+06:00`);
const HEAD_OFFICE = { lat: 23.7806, lng: 90.407 };
const WAREHOUSE = { lat: 23.8759, lng: 90.3795 };
const north = (metres: number) => ({
  lat: HEAD_OFFICE.lat + metres / 111_195,
  lng: HEAD_OFFICE.lng,
});
const meta = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (Linux; Android 14)" };

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
  const hire = (name: string, userId: string) =>
    employees
      .createEmployee(admin, { name, joinDate: "2025-01-01", salary: 30000 })
      .then(async (e) => {
        await employees.grantPortalAccess(admin, e.id, { userId });
        return e;
      });
  const sumon = await hire("Sumon Mia", sumonUser.id);
  const rina = await hire("Rina Begum", rinaUser.id);
  // Karim keeps the books and is on the payroll too.
  const karim = await hire("Karim Uddin", accountsUser.id);
  return {
    company,
    admin,
    hr: await contextFor(hrUser.id, company.id),
    accounts: await contextFor(accountsUser.id, company.id),
    sumonCtx: await contextFor(sumonUser.id, company.id),
    rinaCtx: await contextFor(rinaUser.id, company.id),
    users: {
      owner: ownerUser,
      accounts: accountsUser,
      sumon: sumonUser,
      rina: rinaUser,
      hr: hrUser,
    },
    sumon,
    rina,
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

/** A trip on 5 Oct from the head office to Mirpur 10, unless told otherwise. */
const trip = (ctx: Env["sumonCtx"], over: Record<string, unknown> = {}) =>
  claims.submitClaim(
    ctx,
    {
      kind: "CONVEYANCE",
      date: "2026-10-05",
      amount: 150,
      fromPlace: "Head office",
      toPlace: "Mirpur 10",
      purpose: "Took samples to the buyer",
      ...over,
    },
    meta,
  );

const stored = (id: string) => prisma.staffClaim.findUniqueOrThrow({ where: { id } });
const balance = async (env: Env, accountId: string) =>
  (await chart.getAccount(env.accounts, accountId)).balance;
const inbox = (userId: string) =>
  prisma.notificationLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

async function expectBooksOk(env: Env) {
  const check = await reports.getBooksCheck(env.accounts);
  expect(check.checks.filter((c) => !c.ok)).toEqual([]);
}

/** Pings every ten minutes from `from`, walking north `step` metres each time. */
const walkNorth = (from: Date, count: number, step: number, start = 0) =>
  Array.from({ length: count }, (_, i) => ({
    at: from.getTime() + i * 600_000,
    ...north(start + (i + 1) * step),
    accuracy: 10,
  }));

run("Staff claims", () => {
  let env: Env;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
    vi.useFakeTimers({ now: at("08:00"), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("checks a trip against the day's GPS trail, again at check-out, and keeps the checks from the employee", async () => {
    await location.createWorkPlace(env.hr, { name: "Head office", ...HEAD_OFFICE });
    await location.createWorkPlace(env.hr, { name: "Uttara warehouse", ...WAREHOUSE });
    await settings.updateHrSettings(env.hr, { gpsAttendance: true });

    vi.setSystemTime(at("09:00"));
    await attendance.checkIn(env.sumonCtx, { position: { ...HEAD_OFFICE, accuracy: 10 } }, meta);
    vi.setSystemTime(at("12:00"));
    await location.recordPings(env.sumonCtx, { points: walkNorth(at("09:10"), 10, 500) });

    // Sent while the shift is open: about 5 km walked, so 150 at 30 a km is usual.
    const first = await trip(env.sumonCtx);
    expect(first).toMatchObject({ number: expect.stringMatching(/^CLM-/), status: "PENDING" });
    let saved = await stored(first.id);
    expect(saved.flags).toEqual([]);
    expect(saved.check).toMatchObject({
      duty: "ON_DUTY",
      gps: true,
      points: 11,
      missed: [],
      shiftOpen: true,
      usual: { basis: "TRAIL", claimed: 150 },
    });

    // Back to the office, and out: the claim is checked again with the whole day.
    vi.setSystemTime(at("17:50"));
    await location.recordPings(env.sumonCtx, { points: walkNorth(at("12:30"), 5, -1000, 5000) });
    await attendance.checkOut(env.sumonCtx, { position: { ...HEAD_OFFICE, accuracy: 10 } }, meta);
    saved = await stored(first.id);
    expect(saved.flags).toEqual([]);
    expect(saved.check).toMatchObject({ points: 17, shiftOpen: false });
    expect((saved.check as { trailMetres: number }).trailMetres).toBeGreaterThan(9_800);

    // The GPS trail never went near the warehouse.
    const second = await trip(env.sumonCtx, { toPlace: "Uttara warehouse", amount: 60 });
    expect((await stored(second.id)).flags).toEqual(["ROUTE_MISMATCH"]);
    expect((await stored(second.id)).check).toMatchObject({ missed: ["Uttara warehouse"] });

    // Accounts sees the flags; the employee sees only where the claims stand.
    const ledger = await claims.getClaimsLedger(env.accounts, { month: "2026-10" });
    expect(ledger.totals).toMatchObject({
      waiting: { count: 2, amount: "210.00" },
      needsLook: 1,
      readyToApprove: 1,
    });
    expect(ledger.rows.map((r) => [r.number, r.flags])).toEqual([
      [second.number, ["ROUTE_MISMATCH"]],
      [first.number, []],
    ]);
    const mine = await claims.getMyClaims(env.sumonCtx);
    expect(mine.claims.map((c) => c.state)).toEqual(["WAITING", "WAITING"]);
    expect(mine.waiting).toEqual({ count: 2, amount: "210.00" });
    const shown = JSON.stringify(mine);
    for (const hidden of ["ROUTE_MISMATCH", "flags", "trailMetres", "missed"]) {
      expect(shown).not.toContain(hidden);
    }
    expect(mine.places).toEqual(["Head office", "Uttara warehouse"]);
    expect(mine.recentRoutes).toEqual([
      { from: "Head office", to: "Uttara warehouse" },
      { from: "Head office", to: "Mirpur 10" },
    ]);

    // Accounts and the owner are told; HR and the employee are not.
    const told = await inbox(env.users.accounts.id);
    expect(told.map((n) => n.subject)).toEqual([
      `Claim ${first.number} to approve`,
      `Claim ${second.number} to approve`,
    ]);
    expect(recordHref(env.accounts, { type: told[0]!.entityType!, id: told[0]!.entityId })).toBe(
      `/hr/claims?claim=${first.id}#claim-${first.id}`,
    );
    expect(await inbox(env.users.owner.id)).toHaveLength(2);
    expect(await inbox(env.users.hr.id)).toHaveLength(0);
    expect(await inbox(env.users.sumon.id)).toHaveLength(0);
  });

  it("flags a day not on duty and a claim made twice, and checks again on request", async () => {
    vi.setSystemTime(at("10:00", "2026-10-08"));
    const noCheckIn = await trip(env.sumonCtx);
    expect(await stored(noCheckIn.id)).toMatchObject({
      flags: ["NOT_ON_DUTY"],
      check: expect.objectContaining({ duty: "NO_CHECK_IN" }),
    });
    const friday = await trip(env.sumonCtx, { date: "2026-10-02" });
    expect((await stored(friday.id)).check).toMatchObject({ duty: "DAY_OFF" });
    await prisma.attendance.create({
      data: {
        companyId: env.company.id,
        employeeId: env.sumon.id,
        date: new Date("2026-10-06"),
        status: "ABSENT",
      },
    });
    const absent = await trip(env.sumonCtx, { date: "2026-10-06" });
    expect((await stored(absent.id)).check).toMatchObject({ duty: "ABSENT" });

    const twice = await trip(env.sumonCtx);
    expect(await stored(twice.id)).toMatchObject({
      flags: ["NOT_ON_DUTY", "DUPLICATE"],
      check: expect.objectContaining({ duplicateOf: noCheckIn.number }),
    });
    // Not after today.
    const late = await expectAppError(trip(env.sumonCtx, { date: "2026-10-09" }), "VALIDATION");
    expect(late.details).toMatchObject({ date: ["The day can't be after today."] });

    // HR marks the day present: checked again, the claim is clear.
    await prisma.attendance.create({
      data: {
        companyId: env.company.id,
        employeeId: env.sumon.id,
        date: new Date("2026-10-05"),
        status: "PRESENT",
      },
    });
    await expectAppError(claims.recheckClaim(env.hr, noCheckIn.id), "FORBIDDEN");
    expect(await claims.recheckClaim(env.accounts, noCheckIn.id)).toMatchObject({ flags: [] });
  });

  it("puts an approved trip in the books, owed to the employee, and pays it back", async () => {
    vi.setSystemTime(at("10:00"));
    await attendance.checkIn(env.sumonCtx, {}, meta);
    const c = await trip(env.sumonCtx, { amount: 180 });
    expect(await claims.decideClaim(env.accounts, c.id, { decision: "APPROVE" }, meta)).toEqual({
      id: c.id,
      number: c.number,
      status: "APPROVED",
      approvedAmount: "180.00",
    });

    const row = await prisma.staffClaim.findUniqueOrThrow({
      where: { id: c.id },
      include: {
        expense: {
          include: {
            head: true,
            journalEntry: { include: { lines: { include: { account: true } } } },
          },
        },
      },
    });
    expect(row.expense).toMatchObject({
      paymentType: "DUE",
      supplierId: null,
      projectId: null,
      employeeId: env.sumon.id,
      fromLocation: "Head office",
      toLocation: "Mirpur 10",
      voidedAt: null,
      head: { name: "Conveyance" },
    });
    expect(
      row
        .expense!.journalEntry!.lines.map((l) => [
          l.account.code,
          l.debit.toFixed(2),
          l.credit.toFixed(2),
          l.employeeId,
        ])
        .sort(),
    ).toEqual([
      ["2270", "0.00", "180.00", env.sumon.id],
      ["6700", "180.00", "0.00", null],
    ]);
    expect(await balance(env, env.acc.EMPLOYEE_PAYABLE)).toBe("180.00");
    const statement = await employees.getEmployeeStatement(env.accounts, env.sumon.id);
    expect(statement.claimsPayable).toBe("180.00");

    const mine = await claims.getMyClaims(env.sumonCtx);
    expect(mine.owed).toEqual({ count: 1, amount: "180.00" });
    expect(mine.claims[0]).toMatchObject({ state: "OWED", canWithdraw: false });
    const ledger = await claims.getClaimsLedger(env.accounts, {});
    expect(ledger.owed).toEqual([
      {
        employee: { id: env.sumon.id, code: env.sumon.code, name: "Sumon Mia" },
        count: 1,
        amount: "180.00",
        can: { pay: true },
      },
    ]);
    expect(ledger.moneyAccounts.length).toBeGreaterThan(0);
    expect(ledger.rows[0]).toMatchObject({
      status: "APPROVED",
      owed: true,
      expense: { number: expect.stringMatching(/^EXP-/), voided: false },
    });

    // Only Accounts pays it back, once.
    await expectAppError(
      claims.payBackClaims(env.hr, { employeeId: env.sumon.id, method: "CASH" }),
      "FORBIDDEN",
    );
    const paid = await claims.payBackClaims(
      env.accounts,
      { employeeId: env.sumon.id, method: "CASH" },
      meta,
    );
    expect(paid).toMatchObject({ employeeId: env.sumon.id, count: 1, amount: "180.00" });
    expect(await balance(env, env.acc.EMPLOYEE_PAYABLE)).toBe("0.00");
    expect(await balance(env, env.acc.CASH)).toBe("-180.00");
    const settled = await prisma.staffClaim.findUniqueOrThrow({
      where: { id: c.id },
      include: { paymentEntry: true },
    });
    expect(settled.paidAt).not.toBeNull();
    expect(settled.paymentEntry).toMatchObject({ sourceType: "STAFF_CLAIM", sourceId: c.id });
    expect((await claims.getMyClaims(env.sumonCtx)).claims[0]).toMatchObject({ state: "PAID" });
    await expectAppError(
      claims.payBackClaims(env.accounts, { employeeId: env.sumon.id, method: "CASH" }),
      "CONFLICT",
    );
    // A claim paid back can't be voided from Accounts.
    const refused = await expectAppError(
      expenses.voidExpense(env.accounts, row.expenseId!, { reason: "Entered by mistake" }),
      "CONFLICT",
    );
    expect(refused.message).toContain("already paid back");

    const told = await inbox(env.users.sumon.id);
    expect(told.map((n) => n.subject)).toEqual([
      `Claim ${c.number} approved`,
      "Your claims are paid",
    ]);
    expect(recordHref(env.sumonCtx, { type: told[0]!.entityType!, id: told[0]!.entityId })).toBe(
      "/me/claims",
    );
    await expectBooksOk(env);
  });

  it("adds local material to the production project's cost, and takes it off when voided", async () => {
    vi.setSystemTime(at("10:00"));
    const project = await projects.createProject(env.admin, {
      name: "Polo run",
      factoryName: "Own sewing floor",
      targetDate: "2026-11-20",
      targetQuantity: 100,
    });
    const file = (userId: string) =>
      prisma.fileAsset.create({
        data: {
          companyId: env.company.id,
          uploadedById: userId,
          fileName: "memo.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1000,
          storagePath: "claims/memo.jpg",
        },
      });
    const memo = await file(env.users.sumon.id);
    const material = (over: Record<string, unknown> = {}) =>
      claims.submitClaim(env.sumonCtx, {
        kind: "LOCAL_MATERIAL",
        date: "2026-10-05",
        amount: 2500,
        projectId: project.id,
        item: "Yarn",
        quantity: "5 kg",
        shop: "Islampur market",
        receiptFileId: memo.id,
        ...over,
      });
    // Someone else's upload is not a receipt for this claim.
    const rinas = await file(env.users.rina.id);
    await expectAppError(material({ receiptFileId: rinas.id }), "NOT_FOUND");

    const yarn = await material();
    expect((await stored(yarn.id)).flags).toEqual([]);
    const buttons = await material({ item: "Buttons", amount: 300, receiptFileId: null });
    expect((await stored(buttons.id)).flags).toEqual(["NO_RECEIPT"]);

    // At most what was claimed, and a reason for less.
    await expectAppError(
      claims.decideClaim(env.accounts, yarn.id, { decision: "APPROVE", amount: 2600 }),
      "VALIDATION",
    );
    await expectAppError(
      claims.decideClaim(env.accounts, yarn.id, { decision: "APPROVE", amount: 2400 }),
      "VALIDATION",
    );
    const approved = await claims.decideClaim(env.accounts, yarn.id, {
      decision: "APPROVE",
      amount: 2400,
      reason: "Market price is 480 a kg",
    });
    expect(approved).toMatchObject({ status: "APPROVED", approvedAmount: "2400.00" });

    const row = await prisma.staffClaim.findUniqueOrThrow({
      where: { id: yarn.id },
      include: {
        costHead: true,
        expense: { include: { journalEntry: { include: { lines: true } } } },
      },
    });
    expect(row.costHead).toMatchObject({ name: "Local Materials", isProductionCost: true });
    expect(row.expense).toMatchObject({
      paymentType: "DUE",
      projectId: project.id,
      employeeId: env.sumon.id,
      headId: row.costHeadId,
      amount: expect.objectContaining({}),
    });
    expect(
      row
        .expense!.journalEntry!.lines.map((l) => [
          l.accountId,
          l.debit.toFixed(2),
          l.credit.toFixed(2),
        ])
        .sort(),
    ).toEqual(
      [
        [env.acc.WORK_IN_PROGRESS, "2400.00", "0.00"],
        [env.acc.EMPLOYEE_PAYABLE, "0.00", "2400.00"],
      ].sort(),
    );
    let sheet = await costs.getProjectCostSheet(env.admin, project.id);
    expect(sheet.summary.directCost.toFixed(2)).toBe("2400.00");
    expect(sheet.entries.find((e) => e.kind === "DIRECT")).toMatchObject({
      boughtBy: { id: env.sumon.id, name: "Sumon Mia" },
    });
    const mine = await claims.getMyClaims(env.sumonCtx);
    expect(mine.claims.find((c) => c.id === yarn.id)).toMatchObject({
      state: "OWED",
      amount: "2500.00",
      approvedAmount: "2400.00",
      reason: "Market price is 480 a kg",
      project: { id: project.id },
    });

    // Voided in Accounts: off the project and no longer owed.
    // Project costs are voided on the project, not in Expenses.
    await expectAppError(
      expenses.voidExpense(env.accounts, row.expenseId!, { reason: "Bought twice by mistake" }),
      "NOT_FOUND",
    );
    await costs.voidProjectCost(env.accounts, row.expenseId!, {
      reason: "Bought twice by mistake",
    });
    sheet = await costs.getProjectCostSheet(env.admin, project.id);
    expect(sheet.summary.directCost.toFixed(2)).toBe("0.00");
    expect(await balance(env, env.acc.EMPLOYEE_PAYABLE)).toBe("0.00");
    expect(
      (await claims.getMyClaims(env.sumonCtx)).claims.find((c) => c.id === yarn.id),
    ).toMatchObject({ state: "CANCELLED" });
    expect((await claims.getClaimsLedger(env.accounts, {})).owed).toEqual([]);

    // A finished project takes no more claims, nor approvals.
    await prisma.productionProject.update({
      where: { id: project.id },
      data: { status: "COMPLETED" },
    });
    await expectAppError(material(), "VALIDATION");
    await expect(
      claims.decideClaim(env.accounts, buttons.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(AppError);
    expect((await stored(buttons.id)).status).toBe("PENDING");
    await expectBooksOk(env);
  });

  it("lets Accounts decide, HR only look, and nobody decide or pay their own", async () => {
    // HR marks attendance here, so every working day counts as on duty.
    await settings.updateHrSettings(env.hr, { selfCheckIn: false });
    vi.setSystemTime(at("10:00"));
    const sumons = await trip(env.sumonCtx, { amount: 100 });
    const rinas = await trip(env.rinaCtx, { toPlace: "Gulshan 1", amount: 120 });
    const karims = await trip(env.accounts, { toPlace: "Motijheel", amount: 90 });
    const again = await trip(env.sumonCtx, { amount: 100 });
    expect((await stored(again.id)).flags).toEqual(["DUPLICATE"]);

    // HR sees the claims and their checks, and decides nothing.
    const seen = await claims.getClaimsLedger(env.hr, {});
    expect(seen.access).toEqual({ see: true, decide: false, pay: false });
    expect(seen.rows.every((r) => !r.can.decide)).toBe(true);
    expect(seen.costHeads).toEqual([]);
    await expectAppError(
      claims.decideClaim(env.hr, sumons.id, { decision: "APPROVE" }),
      "FORBIDDEN",
    );
    await expectAppError(claims.approveAllClaims(env.hr, { month: "2026-10" }), "FORBIDDEN");
    // Staff see only their own.
    await expectAppError(claims.getClaimsLedger(env.sumonCtx, {}), "FORBIDDEN");

    // Karim's own claim waits for someone else.
    const books = await claims.getClaimsLedger(env.accounts, {});
    expect(books.rows.find((r) => r.id === karims.id)).toMatchObject({
      own: true,
      can: { decide: false },
    });
    await expectAppError(
      claims.decideClaim(env.accounts, karims.id, { decision: "APPROVE" }),
      "FORBIDDEN",
    );

    // "Approve all" takes the clear ones and leaves the flagged one and Karim's.
    expect(await claims.approveAllClaims(env.accounts, { month: "2026-10" }, meta)).toEqual({
      approved: 2,
      skipped: [],
      needsLook: 1,
    });
    expect((await stored(sumons.id)).status).toBe("APPROVED");
    expect((await stored(rinas.id)).status).toBe("APPROVED");
    expect((await stored(karims.id)).status).toBe("PENDING");
    await expectAppError(
      claims.decideClaim(env.accounts, sumons.id, { decision: "APPROVE" }),
      "CONFLICT",
    );

    // The owner decides and pays Karim; Karim can't pay himself back.
    await claims.decideClaim(env.admin, karims.id, { decision: "APPROVE" });
    await expectAppError(
      claims.payBackClaims(env.accounts, { employeeId: env.karim.id, method: "CASH" }),
      "FORBIDDEN",
    );
    expect(
      (await claims.getClaimsLedger(env.accounts, {})).owed.find(
        (o) => o.employee.id === env.karim.id,
      ),
    ).toMatchObject({ can: { pay: false } });
    expect(
      await claims.payBackClaims(env.admin, { employeeId: env.karim.id, method: "CASH" }),
    ).toMatchObject({ count: 1, amount: "90.00" });

    // Rejecting needs a reason, which the employee sees.
    await expect(
      claims.decideClaim(env.accounts, again.id, { decision: "REJECT", reason: "" }),
    ).rejects.toThrow();
    await claims.decideClaim(env.accounts, again.id, {
      decision: "REJECT",
      reason: "Same trip as the claim before",
    });
    expect(
      (await claims.getMyClaims(env.sumonCtx)).claims.find((c) => c.id === again.id),
    ).toMatchObject({ state: "REJECTED", reason: "Same trip as the claim before" });

    // Withdrawing: only one's own, only while it waits.
    const spare = await trip(env.sumonCtx, { toPlace: "Banani", amount: 70 });
    await expectAppError(claims.withdrawMyClaim(env.rinaCtx, spare.id), "NOT_FOUND");
    await claims.withdrawMyClaim(env.sumonCtx, spare.id, meta);
    expect((await stored(spare.id)).status).toBe("WITHDRAWN");
    await expectAppError(claims.withdrawMyClaim(env.sumonCtx, spare.id), "CONFLICT");
    await expectAppError(claims.withdrawMyClaim(env.sumonCtx, sumons.id), "CONFLICT");
    await expectAppError(
      claims.decideClaim(env.accounts, spare.id, { decision: "APPROVE" }),
      "CONFLICT",
    );

    // Links from the inbox open only for the people who see claims.
    expect(recordHref(env.sumonCtx, { type: "StaffClaim", id: sumons.id })).toBeNull();
    expect(recordHref(env.hr, { type: "StaffClaim", id: sumons.id })).toBe(
      `/hr/claims?claim=${sumons.id}#claim-${sumons.id}`,
    );
    // The ledger opens the month of a linked claim.
    expect((await claims.getClaimsLedger(env.hr, { claim: sumons.id })).month).toBe("2026-10");
    await expectBooksOk(env);
  });

  it("asks Google Maps for the road distance in the background and checks the fare with it", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "AIza-test");
    const urls: string[] = [];
    let answer: unknown = {
      status: "OK",
      routes: [
        {
          legs: [
            { distance: { value: 4_800 }, start_location: HEAD_OFFICE, end_location: north(4_900) },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(JSON.stringify(answer), { status: 200 });
      }),
    );
    vi.setSystemTime(at("10:00"));
    await attendance.checkIn(env.sumonCtx, {}, meta);
    const c = await trip(env.sumonCtx, { amount: 400 });
    // Nothing to compare the fare with yet (no GPS trail, no past claims).
    expect((await stored(c.id)).flags).toEqual([]);
    expect((await claims.getClaimsLedger(env.accounts, {})).rows[0]!.road).toEqual({
      metres: null,
      waiting: true,
      checked: false,
    });

    expect(await runDueJobs()).toBe(1);
    expect(new URL(urls[0]!).searchParams.get("region")).toBe("bd");
    const saved = await stored(c.id);
    expect(saved).toMatchObject({ roadMetres: 4_800, flags: ["HIGH_PRICE"] });
    // 4.8 km at 30 a km is 144: 400 is more than half again.
    expect(saved.check).toMatchObject({
      usual: { basis: "ROAD", amount: 144, metres: 4_800, claimed: 400 },
    });
    expect((await claims.getClaimsLedger(env.accounts, {})).rows[0]!.road).toEqual({
      metres: 4_800,
      waiting: false,
      checked: true,
    });

    // A route Google can't find is noted, and the claim keeps its other checks.
    answer = { status: "ZERO_RESULTS" };
    const lost = await trip(env.sumonCtx, { toPlace: "Nowhere road", amount: 80 });
    expect(await runDueJobs()).toBe(1);
    expect(await stored(lost.id)).toMatchObject({ roadMetres: null, flags: [] });
    expect((await stored(lost.id)).roadCheckedAt).not.toBeNull();
  });
});
