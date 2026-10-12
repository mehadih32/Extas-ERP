import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * HR > Money: the salary, conveyance, bonus and overtime totals for a period
 * (approved payrolls counted in the month they are for, approved trips on
 * their day), who got each, every month or trip behind a person's share, and
 * who may see it (hr.money.view: Super Admin unless given).
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  return {
    ...real,
    requirePermission: async (...keys: string[]) => {
      const ctx = signedIn.ctx as import("@/modules/auth/context").CompanyContext;
      if (keys.some((k) => !ctx.permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx;
    },
  };
});

import type { Prisma, PayrollStatus } from "@prisma/client";

import { GET as moneyRoute } from "@/app/api/hr/money/route";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as employees from "@/modules/hr/employee.service";
import * as money from "@/modules/hr/money.service";
import { createRole } from "@/modules/rbac/role.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** Monday 12 Oct 2026, 10:00 in Dhaka. */
const NOW = new Date("2026-10-12T10:00:00+06:00");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return user;
  };
  const owner = await contextFor((await member(roles.SUPER_ADMIN, "owner")).id, company.id);
  const accounts = await contextFor((await member(roles.ACCOUNTS, "accounts")).id, company.id);
  const viewerRole = await createRole(owner, {
    name: "Money viewer",
    permissions: ["hr.money.view"],
  });
  const viewer = await contextFor((await member(viewerRole.id, "viewer")).id, company.id);
  const hire = (name: string, salary: number) =>
    employees.createEmployee(owner, {
      name,
      joinDate: "2024-01-01",
      salary,
      designation: "Cutter",
    });
  const sumon = await hire("Sumon Mia", 30000);
  const rina = await hire("Rina Begum", 20000);

  const payroll = async (
    month: number,
    status: PayrollStatus,
    items: Array<{ employeeId: string } & Partial<Prisma.PayrollItemUncheckedCreateInput>>,
  ) => {
    const r = await prisma.payrollRun.create({
      data: { companyId: company.id, year: 2026, month, status },
    });
    for (const { employeeId, ...rest } of items) {
      await prisma.payrollItem.create({
        data: { runId: r.id, employeeId, basic: 0, netPay: 0, workingDays: 26, ...rest },
      });
    }
    return r;
  };
  const aug = await payroll(8, "PAID", [
    {
      employeeId: sumon.id,
      basic: 30000,
      allowances: 2000,
      unpaidLeaveDeduction: 1000,
      overtime: 1500,
      overtimeHours: 10,
      presentDays: 25,
      netPay: 32500,
      paidAmount: 32500,
    },
    {
      employeeId: rina.id,
      basic: 20000,
      bonus: 5000,
      note: "Eid bonus",
      presentDays: 26,
      netPay: 25000,
      paidAmount: 10000,
    },
  ]);
  const sep = await payroll(9, "APPROVED", [
    {
      employeeId: sumon.id,
      basic: 30000,
      overtime: 600,
      overtimeHours: 4,
      overtimeEdited: true,
      presentDays: 26,
      netPay: 30600,
    },
    { employeeId: rina.id, basic: 20000, presentDays: 26, netPay: 20000 },
  ]);
  // A draft is not money yet.
  await payroll(10, "DRAFT", [{ employeeId: sumon.id, basic: 30000, bonus: 9999, netPay: 39999 }]);

  // Approved overtime days (and one still waiting).
  const overtime = async (
    employeeId: string,
    date: string,
    minutes: number,
    extra: Partial<Prisma.OvertimeEntryUncheckedCreateInput> = {},
  ) => {
    const a = await prisma.attendance.create({
      data: { companyId: company.id, employeeId, date: day(date), status: "PRESENT" },
    });
    await prisma.overtimeEntry.create({
      data: {
        companyId: company.id,
        employeeId,
        attendanceId: a.id,
        date: day(date),
        basis: "AFTER_HOURS",
        startsAt: new Date(`${date}T12:00:00Z`),
        checkOut: new Date(`${date}T14:00:00Z`),
        detectedMinutes: minutes,
        status: "APPROVED",
        approvedMinutes: minutes,
        ...extra,
      },
    });
  };
  await overtime(sumon.id, "2026-08-03", 120);
  await overtime(sumon.id, "2026-08-10", 480, { basis: "DAY_OFF", reason: "Shipment" });
  await overtime(sumon.id, "2026-09-05", 240);
  await overtime(sumon.id, "2026-09-06", 60, { status: "PENDING", approvedMinutes: null });

  let n = 0;
  const claim = (
    employeeId: string,
    date: string,
    amount: number,
    extra: Partial<Prisma.StaffClaimUncheckedCreateInput> = {},
  ) =>
    prisma.staffClaim.create({
      data: {
        companyId: company.id,
        employeeId,
        number: `CLM-${String(++n).padStart(4, "0")}`,
        kind: "CONVEYANCE",
        date: day(date),
        amount,
        status: "APPROVED",
        ...extra,
      },
    });
  const cut = await claim(sumon.id, "2026-10-05", 300, {
    approvedAmount: 250,
    reason: "The bus fare is 250",
    fromPlace: "Office",
    toPlace: "Port",
    purpose: "Client visit",
  });
  const withSalary = await prisma.payrollItem.findFirstOrThrow({
    where: { runId: sep.id, employeeId: sumon.id },
  });
  await claim(sumon.id, "2026-09-20", 200, { payrollItemId: withSalary.id });
  await claim(sumon.id, "2026-10-06", 500, { status: "PENDING" });
  await claim(sumon.id, "2026-10-07", 400, { status: "REJECTED" });
  await claim(sumon.id, "2026-10-01", 900, { kind: "LOCAL_MATERIAL" });
  await claim(rina.id, "2026-08-15", 120, { paidAt: new Date("2026-08-20T08:00:00Z") });

  return { company, owner, accounts, viewer, sumon, rina, aug, sep, cut, withSalary };
}

type Env = Awaited<ReturnType<typeof setup>>;

const totals = (s: money.MoneySummary) =>
  Object.fromEntries(money.MONEY_KINDS.map((k) => [k, s.kinds[k].total]));

run("HR > Money", () => {
  let env: Env;

  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    await resetDb();
    env = await setup();
  }, 30_000);
  afterEach(() => {
    vi.useRealTimers();
  });

  it("works out the periods and the payroll months that end in them", () => {
    const today = "2026-10-12";
    expect(money.moneyPeriod(today, {})).toEqual({
      range: "month",
      from: "2026-09-13",
      to: today,
    });
    expect(money.moneyPeriod(today, { range: "week" })).toMatchObject({ from: "2026-10-06" });
    expect(money.moneyPeriod(today, { range: "6m" })).toMatchObject({ from: "2026-04-13" });
    expect(money.moneyPeriod(today, { range: "year" })).toMatchObject({ from: "2025-10-13" });
    expect(money.moneyPeriod(today, { range: "all" })).toMatchObject({ from: null, to: today });
    expect(
      money.moneyPeriod(today, { range: "custom", from: "2026-08-01", to: "2026-08-31" }),
    ).toEqual({ range: "custom", from: "2026-08-01", to: "2026-08-31" });
    // A custom period the wrong way round, or junk, is the last month.
    expect(
      money.moneyPeriod(today, { range: "custom", from: "2026-09-01", to: "2026-08-01" }).range,
    ).toBe("month");
    expect(money.moneyPeriod(today, { range: "decade", from: "x" }).range).toBe("month");

    const months = (raw: unknown) => money.payrollMonths(money.moneyPeriod(today, raw));
    expect(months({})).toEqual({ first: "2026-09", last: "2026-09" });
    // No month ends in the last week.
    expect(months({ range: "week" })).toBeNull();
    expect(months({ range: "all" })).toEqual({ first: null, last: "2026-09" });
    expect(months({ range: "custom", from: "2026-08-01", to: "2026-08-31" })).toEqual({
      first: "2026-08",
      last: "2026-08",
    });
  });

  it("adds up salary, conveyance, bonus and overtime for the period", async () => {
    const month = await money.getMoneySummary(env.owner, {});
    expect(totals(month)).toEqual({
      salary: "50000.00",
      conveyance: "450.00",
      bonus: "0.00",
      overtime: "600.00",
    });
    expect(month.kinds.conveyance).toMatchObject({ count: 2 });
    expect(month.kinds.conveyance.people).toEqual([
      expect.objectContaining({ amount: "450.00", count: 2 }),
    ]);

    const half = await money.getMoneySummary(env.owner, { range: "6m" });
    expect(totals(half)).toEqual({
      // Sumon: 30,000 + 2,000 - 1,000 in August and 30,000 in September; Rina 20,000 twice.
      salary: "101000.00",
      conveyance: "570.00",
      bonus: "5000.00",
      overtime: "2100.00",
    });
    expect(half.kinds.overtime.hours).toBe("14.00");
    // Largest first, with months, trips or hours.
    expect(half.kinds.salary.people.map((p) => [p.employee.name, p.amount, p.count])).toEqual([
      ["Sumon Mia", "61000.00", 2],
      ["Rina Begum", "40000.00", 2],
    ]);
    expect(half.kinds.bonus.people.map((p) => p.employee.name)).toEqual(["Rina Begum"]);
    expect(half.kinds.overtime.people[0]).toMatchObject({ hours: "14.00", count: 2 });

    // Nothing ended or was claimed in the last week; August alone.
    expect(totals(await money.getMoneySummary(env.owner, { range: "week" }))).toEqual({
      salary: "0.00",
      conveyance: "0.00",
      bonus: "0.00",
      overtime: "0.00",
    });
    const august = await money.getMoneySummary(env.owner, {
      range: "custom",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(totals(august)).toMatchObject({ salary: "51000.00", conveyance: "120.00" });
    expect(totals(await money.getMoneySummary(env.owner, { range: "all" }))).toEqual(totals(half));
  });

  it("lists one person's months and trips with what each was for", async () => {
    const q = { range: "6m", employeeId: env.sumon.id };
    const salary = await money.getMoneyBreakdown(env.viewer, { ...q, kind: "salary" });
    expect(salary.total).toBe("61000.00");
    expect(salary.lines.map((l) => [l.title, l.date, l.amount, l.state?.label])).toEqual([
      ["September 2026", "2026-09-30", "30000.00", "To be paid"],
      ["August 2026", "2026-08-31", "31000.00", "Paid"],
    ]);
    expect(salary.lines[1]).toMatchObject({
      purpose: "25 of 26 working days present",
      details: [
        { label: "Basic", amount: "30000.00" },
        { label: "Allowances", amount: "2000.00" },
        { label: "Absence", amount: "1000.00", minus: true },
      ],
      payslip: { runId: env.aug.id },
    });

    const overtime = await money.getMoneyBreakdown(env.viewer, { ...q, kind: "overtime" });
    expect(overtime.lines.map((l) => [l.title, l.amount, l.purpose])).toEqual([
      ["September 2026", "600.00", "4 hours of overtime (hours set on the payroll)"],
      ["August 2026", "1500.00", "10 hours of overtime"],
    ]);
    // Only the approved days.
    expect(overtime.lines[0]!.days).toEqual([
      { date: "2026-09-05", minutes: 240, dayOff: false, reason: null },
    ]);
    expect(overtime.lines[1]!.days).toEqual([
      { date: "2026-08-03", minutes: 120, dayOff: false, reason: null },
      { date: "2026-08-10", minutes: 480, dayOff: true, reason: "Shipment" },
    ]);

    const trips = await money.getMoneyBreakdown(env.viewer, {
      kind: "conveyance",
      employeeId: env.sumon.id,
    });
    expect(trips.total).toBe("450.00");
    expect(trips.lines).toEqual([
      expect.objectContaining({
        date: "2026-10-05",
        title: env.cut.number,
        amount: "250.00",
        purpose: "Office to Port · Client visit",
        details: [{ label: "Asked", amount: "300.00", note: "The bus fare is 250" }],
        state: { label: "To be paid back", tone: "open" },
        payslip: null,
      }),
      expect.objectContaining({
        date: "2026-09-20",
        amount: "200.00",
        state: { label: "With the salary", tone: "done" },
        payslip: { runId: env.sep.id, itemId: env.withSalary.id },
      }),
    ]);

    const bonus = await money.getMoneyBreakdown(env.viewer, {
      ...q,
      kind: "bonus",
      employeeId: env.rina.id,
    });
    expect(bonus.lines.map((l) => [l.title, l.amount, l.purpose, l.state?.label])).toEqual([
      ["August 2026", "5000.00", "Eid bonus", "Part paid"],
    ]);
  });

  it("is for people allowed to see staff money only", async () => {
    await expect(money.getMoneySummary(env.accounts, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      money.getMoneyBreakdown(env.accounts, { kind: "salary", employeeId: env.sumon.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Someone given only this permission sees it.
    expect((await money.getMoneySummary(env.viewer, {})).kinds.salary.total).toBe("50000.00");

    // Another company's employee is not found; a wrong kind is refused.
    const other = await makeCompany("Other");
    const stranger = await prisma.employee.create({
      data: {
        companyId: other.company.id,
        code: "EMP-0001",
        name: "Stranger",
        joinDate: day("2025-01-01"),
        baseSalary: 1,
      },
    });
    await expect(
      money.getMoneyBreakdown(env.owner, { kind: "salary", employeeId: stranger.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      money.getMoneyBreakdown(env.owner, { kind: "tips", employeeId: env.sumon.id }),
    ).rejects.toThrow();

    const get = (ctx: CompanyContext, query: string) => {
      signedIn.ctx = ctx;
      return moneyRoute(new Request(`http://erp.test/api/hr/money${query}`), {
        params: Promise.resolve({}),
      });
    };
    expect((await get(env.accounts, "")).status).toBe(403);
    const response = await get(env.owner, "?range=6m");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { period: { range: "6m" }, kinds: { bonus: { total: "5000.00" } } },
    });
  });
});
