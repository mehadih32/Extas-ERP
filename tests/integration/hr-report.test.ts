import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The employee 360° report: the last twelve months of attendance, approved
 * overtime, tasks, salary on approved payrolls and conveyance, from the
 * records, with only the money the reader may see, as a PDF made per request.
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  const guard = async (...keys: string[]) => {
    const ctx = signedIn.ctx as import("@/modules/auth/context").CompanyContext;
    if (!keys.some((k) => ctx.permissions.has(k as never))) {
      throw new AppError("FORBIDDEN", "You do not have permission to do this.");
    }
    return ctx;
  };
  return { ...real, requireAnyPermission: guard };
});

import type { StaffClaimKind, StaffClaimStatus, TaskStatus } from "@prisma/client";

import { GET as reportRoute } from "@/app/api/hr/employees/[employeeId]/report/route";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as attendance from "@/modules/hr/attendance.service";
import * as employees from "@/modules/hr/employee.service";
import * as payroll from "@/modules/hr/payroll.service";
import { employeeReportData, employeeReportDocument } from "@/modules/hr/report.service";
import { createRole } from "@/modules/rbac/role.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** Monday 12 Oct 2026, 10:00 in Dhaka: the report covers 1 Nov 2025 to today. */
const NOW = new Date("2026-10-12T10:00:00+06:00");
const at = (day: string, time = "12:00") => new Date(`${day}T${time}:00+06:00`);

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await member(roles.SUPER_ADMIN, "owner");
  const viewerRole = await createRole(owner, { name: "HR viewer", permissions: ["hr.view"] });
  const viewer = await member(viewerRole.id, "viewer");
  const outsiderRole = await createRole(owner, { name: "Sales", permissions: ["sales.view"] });
  const outsider = await member(outsiderRole.id, "sales");
  const sumon = await employees.createEmployee(owner, {
    name: "Sumon Mia",
    joinDate: "2025-01-01",
    salary: 30000,
    overtimeRate: 200,
    phone: "01711000000",
    email: "sumon@extras.test",
  });
  const joiner = await employees.createEmployee(owner, {
    name: "Rina Begum",
    joinDate: "2026-11-01",
    salary: 20000,
  });

  // September: a day absent, a late one and two hours' overtime (1 Sep 2026 is a Tuesday).
  const mark = (date: string, entry: Record<string, unknown>) =>
    attendance.markAttendance(owner, { date, entries: [{ employeeId: sumon.id, ...entry }] });
  await mark("2026-09-01", { status: "ABSENT" });
  await mark("2026-09-02", { status: "LATE", checkIn: "09:31" });
  await mark("2026-09-03", { status: "PRESENT", overtimeMinutes: 120 });
  const draft = await payroll.createPayrollRun(owner, { month: "2026-09" });
  await payroll.approvePayrollRun(owner, draft.id);
  const line = await prisma.payrollItem.findFirstOrThrow({
    where: { runId: draft.id, employeeId: sumon.id },
  });

  let n = 0;
  const claim = (
    date: string,
    amount: number,
    extra: { approvedAmount?: number; status?: StaffClaimStatus; kind?: StaffClaimKind } = {},
  ) =>
    prisma.staffClaim.create({
      data: {
        companyId: company.id,
        employeeId: sumon.id,
        number: `CLM-R${++n}`,
        kind: extra.kind ?? "CONVEYANCE",
        status: extra.status ?? "APPROVED",
        date: new Date(`${date}T00:00:00Z`),
        amount,
        approvedAmount: extra.approvedAmount ?? null,
        fromPlace: "Office",
        toPlace: "Bank",
      },
    });
  await claim("2026-09-05", 200, { approvedAmount: 150 });
  await claim("2026-10-02", 100);
  await claim("2025-10-20", 999); // before the period
  await claim("2026-09-06", 300, { status: "PENDING" });
  await claim("2026-09-07", 400, { kind: "LOCAL_MATERIAL" });

  const task = (title: string, due: string, status: TaskStatus, doneOn?: string) =>
    prisma.task.create({
      data: {
        companyId: company.id,
        title,
        assigneeId: sumon.id,
        dueAt: at(due, "17:00"),
        status,
        completedAt: doneOn ? at(doneOn) : null,
      },
    });
  await task("Count the fabric rolls", "2026-09-10", "DONE", "2026-09-09");
  await task("Send the cutting plan", "2026-09-15", "DONE", "2026-09-18");
  await task("Label the cartons", "2026-10-01", "TODO");
  await task("Book the inspection", "2026-10-20", "IN_PROGRESS");
  await task("Old cancelled task", "2026-08-01", "CANCELLED");
  await task("Before the period", "2025-10-01", "DONE", "2025-10-01");
  return { owner, viewer, outsider, sumon, joiner, line };
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

const columnsOf = (ctx: CompanyContext, data: Awaited<ReturnType<typeof employeeReportData>>) => {
  const doc = employeeReportDocument(ctx, data, { text: "A summary.", by: "rules" });
  const tables = doc.blocks.flatMap((b) => (b.kind === "table" ? [b] : []));
  return {
    doc,
    months: tables.find((t) => t.title === "Month by month")!,
    tasks: tables.find((t) => t.title?.startsWith("Tasks")),
  };
};

run("Employee 360° report", () => {
  let env: Env;
  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    vi.stubEnv("AI_API_KEY", "");
    await resetDb();
    env = await setup();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("gathers twelve months of attendance, overtime, pay, trips and tasks", async () => {
    const data = await employeeReportData(env.owner, env.sumon.id, NOW);
    expect([data.from, data.to]).toEqual(["2025-11-01", "2026-10-12"]);
    expect(data.months.map((m) => m.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    const sep = data.months.find((m) => m.month === "2026-09")!;
    const salary = env.line.basic.plus(env.line.allowances).minus(env.line.unpaidLeaveDeduction);
    expect({
      absent: sep.absent,
      late: sep.late,
      overtime: sep.overtimeMinutes,
      salary: sep.salary?.toFixed(2),
      conveyance: sep.conveyance.toFixed(2),
      trips: sep.trips,
    }).toEqual({
      absent: 1,
      late: 1,
      overtime: 120,
      salary: salary.toFixed(2),
      conveyance: "150.00",
      trips: 1,
    });
    expect(sep.present).toBe(sep.workingDays - 1);
    // Months without an approved payroll have no salary.
    expect(data.months.find((m) => m.month === "2026-08")!.salary?.toFixed(2)).toBe("0.00");
    expect(data.months.find((m) => m.month === "2026-10")!.conveyance.toFixed(2)).toBe("100.00");

    expect(data.facts.tasks).toEqual({ due: 3, onTime: 1, late: 1, overdue: 1, open: 2 });
    expect(data.tasks.map((t) => [t.title, t.state])).toEqual([
      ["Book the inspection", "In progress"],
      ["Label the cartons", "Overdue"],
      ["Send the cutting plan", "Done late, 18 Sep 2026"],
      ["Count the fabric rolls", "Done on time"],
    ]);
    expect(data.facts).toMatchObject({
      overtimeHours: 2,
      tenure: "1 year, 9 months and 12 days",
      money: {
        currency: "BDT",
        salary: salary.toFixed(2),
        bonus: "0.00",
        overtimePay: "400.00",
        conveyance: { amount: "250.00", trips: 2 },
      },
    });

    const { months, tasks } = columnsOf(env.owner, data);
    expect(months.columns.map((c) => c.label)).toEqual([
      "Month",
      "Present",
      "Absent",
      "Leave",
      "Late",
      "Overtime (h)",
      "Salary (BDT)",
      "Conveyance (BDT)",
    ]);
    expect(months.rows.at(-1)!.cells.slice(0, 1)).toEqual(["Total"]);
    expect(tasks?.rows).toHaveLength(4);
  });

  it("shows only the money the reader may see, and only to people who see employees", async () => {
    const seen = await employeeReportData(env.viewer, env.sumon.id, NOW);
    expect(seen.sees).toEqual({ salaries: false, conveyance: false, taskTitles: false });
    expect(seen.facts.money).toEqual({ currency: "BDT" });
    expect(seen.months.every((m) => m.salary === null && m.conveyance.isZero())).toBe(true);
    const { months, tasks, doc } = columnsOf(env.viewer, seen);
    expect(months.columns.map((c) => c.label)).not.toContain("Salary (BDT)");
    expect(tasks).toBeUndefined();
    const figures = doc.blocks.find((b) => b.kind === "figures");
    expect(JSON.stringify(figures)).not.toMatch(/Salary|Conveyance|Bonus/);

    await expectAppError(employeeReportData(env.outsider, env.sumon.id, NOW), "FORBIDDEN");
    const early = await expectAppError(
      employeeReportData(env.owner, env.joiner.id, NOW),
      "VALIDATION",
    );
    expect(early.message).toBe("Rina Begum joins on 1 Nov 2026: there is nothing to report yet.");
  });

  it("downloads as a PDF made for the request, logged and not kept", async () => {
    const files = await prisma.fileAsset.count();
    const documents = await prisma.generatedDocument.count();
    signedIn.ctx = env.owner;
    const response = await reportRoute(
      new Request(`http://localhost/api/hr/employees/${env.sumon.id}/report`),
      { params: Promise.resolve({ employeeId: env.sumon.id }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename\*=UTF-8''Extras%20-%20360%20report%20EMP-\d+%20Sumon%20Mia\.pdf$/,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect([await prisma.fileAsset.count(), await prisma.generatedDocument.count()]).toEqual([
      files,
      documents,
    ]);
    const logged = await prisma.auditLog.findFirst({
      where: { entityType: "Employee", entityId: env.sumon.id, action: "EXPORT" },
    });
    expect(logged?.summary).toMatch(
      /^Made the 360° report for EMP-\d+ Sumon Mia \(1 Nov 2025 to 12 Oct 2026\)$/,
    );

    signedIn.ctx = env.outsider;
    const refused = await reportRoute(
      new Request(`http://localhost/api/hr/employees/${env.sumon.id}/report`),
      { params: Promise.resolve({ employeeId: env.sumon.id }) },
    );
    expect(refused.status).toBe(403);
    expect((await refused.json()).ok).toBe(false);
  });
});
