import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The HR & payroll and My HR screens decide what to show and offer from flags
 * the server sends with the data (seeSalaries, can.approve, can.pay...). These
 * tests open the screens' data as each built-in role, plus an HR Manager and
 * an HR Viewer, and then try the changes through the same Server Actions the
 * buttons call: each must work exactly when the screen offers it, salaries
 * must reach only HR managers, payroll and Accounts, and My HR must show
 * employees only their own records. Next.js' request helpers are replaced as
 * in screens.test.ts.
 */
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => void browser.cookies.set(name, value),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => browser.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`Redirected to ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
      redirectedTo: url,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("Not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
  useRouter: () => ({}),
  usePathname: () => "/hr",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import AdvancePage from "@/app/(app)/hr/advances/[advanceId]/page";
import NewAdvancePage from "@/app/(app)/hr/advances/new/page";
import AdvancesPage from "@/app/(app)/hr/advances/page";
import AttendanceMonthPage from "@/app/(app)/hr/attendance/month/page";
import AttendancePage from "@/app/(app)/hr/attendance/page";
import EmployeeMonthPage from "@/app/(app)/hr/employees/[employeeId]/attendance/page";
import EditEmployeePage from "@/app/(app)/hr/employees/[employeeId]/edit/page";
import EmployeePage from "@/app/(app)/hr/employees/[employeeId]/page";
import StatementPage from "@/app/(app)/hr/employees/[employeeId]/statement/page";
import NewEmployeePage from "@/app/(app)/hr/employees/new/page";
import EmployeesPage from "@/app/(app)/hr/employees/page";
import LeaveRequestPage from "@/app/(app)/hr/leave/[leaveId]/page";
import NewLeavePage from "@/app/(app)/hr/leave/new/page";
import LeavePage from "@/app/(app)/hr/leave/page";
import HrOverviewPage from "@/app/(app)/hr/page";
import PayrollRunPage from "@/app/(app)/hr/payroll/[runId]/page";
import PayslipPage from "@/app/(app)/hr/payroll/[runId]/payslips/[itemId]/page";
import PayrollPage from "@/app/(app)/hr/payroll/page";
import HrSettingsPage from "@/app/(app)/hr/settings/page";
import MyAdvancesPage from "@/app/(app)/me/advances/page";
import MyAttendancePage from "@/app/(app)/me/attendance/page";
import MyLeavePage from "@/app/(app)/me/leave/page";
import MyHrPage from "@/app/(app)/me/page";
import MyPayslipPage from "@/app/(app)/me/payslips/[itemId]/page";
import MyPayslipsPage from "@/app/(app)/me/payslips/page";
import { SectionError } from "@/components/dashboard/section-error";
import { HrNoAccess, MyHrProblem, SalariesNoAccess } from "@/components/hr/no-access";
import { visibleHrTabs } from "@/components/hr/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { addDays, localDay, weekday } from "@/lib/dates";
import type { ActionResult } from "@/lib/result";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import * as advances from "@/modules/hr/advance.service";
import * as employees from "@/modules/hr/employee.service";
import * as leave from "@/modules/hr/leave.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as settings from "@/modules/hr/settings.service";
import { createRole } from "@/modules/rbac/role.service";
import {
  approveLeaveAction,
  approvePayrollRunAction,
  cancelLeaveAction,
  createHolidaysAction,
  getAdvanceFormAction,
  getAdvanceListAction,
  getAdvanceScreenAction,
  getAttendanceMonthScreenAction,
  getAttendanceScreenAction,
  getEmployeeFormAction,
  getEmployeeListAction,
  getEmployeeMonthScreenAction,
  getEmployeeScreenAction,
  getHrOverviewScreenAction,
  getHrSettingsScreenAction,
  getLeaveFormAction,
  getLeaveListAction,
  getLeaveScreenAction,
  getPayrollListAction,
  getPayrollScreenAction,
  getPayslipScreenAction,
  getStatementScreenAction,
  giveAdvanceAction,
  listAdvanceRowsAction,
  listEmployeeRowsAction,
  listLeaveRowsAction,
  markAttendanceAction,
  payPayrollRunAction,
  recalculatePayrollRunAction,
  rejectLeaveAction,
  reopenPayrollRunAction,
  returnAdvanceAction,
  updateAdvanceAction,
  updateEmployeeAction,
  updateLeaveTypeAction,
  voidAdvanceAction,
  voidAdvanceReturnAction,
  voidPayrollPaymentAction,
} from "@/server/actions/hr.actions";
import {
  cancelMyLeaveAction,
  checkInAction,
  checkOutAction,
  getMyAdvancesScreenAction,
  getMyHrScreenAction,
  getMyLeaveScreenAction,
  getMyMonthScreenAction,
  getMyPayslipScreenAction,
  getMyPayslipsScreenAction,
  requestMyLeaveAction,
} from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const BUILT_IN = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  sales: "SALES_EXECUTIVE",
  store: "WAREHOUSE_TEAM",
  accounts: "ACCOUNTS",
  employee: "EMPLOYEE",
} as const;
type Who = keyof typeof BUILT_IN | "hr" | "viewer";
const EVERYONE: Who[] = [...(Object.keys(BUILT_IN) as Who[]), "hr", "viewer"];
const TZ = "Asia/Dhaka";

async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(["FORBIDDEN", "CONFLICT", "VALIDATION"], `${label}: ${result.error.message}`).toContain(
    result.error.code,
  );
}

/** The change works exactly when the screen offered it. */
function expectOffered(result: ActionResult<unknown>, offered: boolean, label: string) {
  expect(result.ok, `${label}${result.ok ? "" : `: ${result.error.message}`}`).toBe(offered);
  expectRuleRefusal(result, label);
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** What a page rendered: "no access", "not linked" (My HR), an error, or the page. */
async function rendered(page: Promise<React.ReactElement>): Promise<string> {
  const element = await page;
  if (element.type === HrNoAccess || element.type === SalariesNoAccess) return "no access";
  if (element.type === MyHrProblem) {
    const { error } = element.props as { error: { code: string } };
    if (error.code === "FORBIDDEN") return "no access";
    if (error.code === "NOT_FOUND") return "not linked";
    return "error";
  }
  if (element.type === SectionError) return "error";
  return "page";
}

const today = () => localDay(new Date(), TZ);

/** "YYYY-MM" `n` months before this one. */
function monthsAgo(n: number) {
  const [y, m] = today().split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

/** This month's working days (Friday is the default weekly day off). */
function workingDaysThisMonth() {
  const month = today().slice(0, 7);
  const days: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) {
    if (weekday(d) !== 5) days.push(d);
  }
  return days;
}

/**
 * Extas with one person in each built-in role, an HR Manager (hr.view,
 * hr.manage, portal.self) and an HR Viewer (hr.view only); Rahim, whose login
 * is the Employee's, and Karim; last month's payroll as a draft; a waiting
 * leave request and an advance for Rahim.
 */
async function factory() {
  const { company, roles } = await makeCompany("Extas");
  const owner = await makeUser("owner@extas.test");
  await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
  const ownerCtx = await contextFor(owner.id, company.id);
  const hrRole = await createRole(ownerCtx, {
    name: "HR Manager",
    permissions: ["hr.view", "hr.manage", "portal.self"],
  });
  const viewerRole = await createRole(ownerCtx, { name: "HR Viewer", permissions: ["hr.view"] });
  const roleOf: Record<Who, string> = {
    owner: roles.SUPER_ADMIN,
    production: roles.PRODUCTION_MANAGER,
    sales: roles.SALES_EXECUTIVE,
    store: roles.WAREHOUSE_TEAM,
    accounts: roles.ACCOUNTS,
    employee: roles.EMPLOYEE,
    hr: hrRole.id,
    viewer: viewerRole.id,
  };
  const people: Partial<Record<Who, { id: string }>> = { owner };
  for (const who of EVERYONE) {
    if (who === "owner") continue;
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roleOf[who]);
    people[who] = user;
  }
  await ensureControlAccounts(company.id);
  const hire = (name: string, salary = 20000) =>
    employees.createEmployee(ownerCtx, { name, joinDate: "2025-01-01", salary });
  const rahim = await hire("Rahim Uddin", 30000);
  const karim = await hire("Karim Mia");
  await employees.grantPortalAccess(ownerCtx, rahim.id, { userId: people.employee!.id });
  const types = await settings.listLeaveTypes(ownerCtx);
  const casual = types.find((t) => t.name === "Casual Leave")!;
  const days = workingDaysThisMonth();
  const waiting = await leave.createLeave(ownerCtx, {
    employeeId: rahim.id,
    leaveTypeId: casual.id,
    startDate: days[0]!,
    approve: false,
  });
  const draft = await payroll.createPayrollRun(ownerCtx, { month: monthsAgo(1) });
  const advance = await advances.giveAdvance(ownerCtx, {
    employeeId: rahim.id,
    amount: 3000,
    installmentAmount: 1000,
  });
  return {
    company,
    people: people as Record<Who, { id: string }>,
    owner: ownerCtx,
    rahim,
    karim,
    casual,
    days,
    waiting,
    draft,
    advance,
    hire,
  };
}

type Factory = Awaited<ReturnType<typeof factory>>;

async function as(env: Factory, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});

/** Who may do what, from the role's permissions (hr.actions.ts guards). */
function keys(ctx: CompanyContext) {
  const manage = ctx.can("hr.manage");
  const payrollKey = ctx.can("hr.payroll");
  const salaries = manage || payrollKey || ctx.can("accounts.view");
  const pay = ctx.can("accounts.payments.record");
  return {
    view: ctx.can("hr.view") || manage || payrollKey,
    manage,
    salaries,
    advances: salaries || pay,
    payroll: payrollKey,
    approve: ctx.can("hr.payroll.approve"),
    pay,
    receive: ctx.can("accounts.receipts.record"),
    give: pay || ctx.can("accounts.manage"),
    self: ctx.can("portal.self"),
  };
}

run("HR & payroll screens", () => {
  beforeEach(resetDb);

  it("shows each page to the people its actions let in, and nothing to the others", async () => {
    const env = await factory();
    const line = env.draft.items.find((i) => i.employee.id === env.rahim.id)!;

    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const k = keys(ctx);

      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/hr");
      expect(inMenu, who).toBe(k.view || k.advances);
      expect(
        visibleHrTabs(ctx.permissions).map((t) => t.href),
        who,
      ).toEqual([
        ...(k.view ? ["/hr", "/hr/employees", "/hr/attendance", "/hr/leave"] : []),
        ...(k.salaries ? ["/hr/payroll"] : []),
        ...(k.advances ? ["/hr/advances"] : []),
        ...(k.view ? ["/hr/settings"] : []),
      ]);

      // Each screen's data comes exactly to the people its page is shown to.
      const overview = await getHrOverviewScreenAction();
      expect(overview.ok, `${who}: overview`).toBe(k.view);
      const list = await getEmployeeListAction({});
      expect(list.ok, `${who}: employees`).toBe(k.view);
      expect((await listEmployeeRowsAction({})).ok, `${who}: more employees`).toBe(k.view);
      const profile = await getEmployeeScreenAction(env.rahim.id);
      expect(profile.ok, `${who}: employee`).toBe(k.view);
      expect((await getEmployeeFormAction()).ok, `${who}: employee form`).toBe(k.manage);
      expect((await getEmployeeFormAction(env.rahim.id)).ok, `${who}: edit form`).toBe(k.manage);
      expect((await getEmployeeMonthScreenAction(env.rahim.id, {})).ok, `${who}: month`).toBe(
        k.view,
      );
      expect((await getStatementScreenAction(env.rahim.id)).ok, `${who}: statement`).toBe(
        k.salaries,
      );
      expect((await getAttendanceScreenAction({})).ok, `${who}: attendance`).toBe(k.view);
      expect((await getAttendanceMonthScreenAction({})).ok, `${who}: month totals`).toBe(k.view);
      expect((await getLeaveListAction({})).ok, `${who}: leave`).toBe(k.view);
      expect((await listLeaveRowsAction({})).ok, `${who}: more leave`).toBe(k.view);
      expect((await getLeaveScreenAction(env.waiting.id)).ok, `${who}: leave request`).toBe(k.view);
      expect((await getLeaveFormAction()).ok, `${who}: leave form`).toBe(k.manage);
      expect((await getPayrollListAction()).ok, `${who}: payroll`).toBe(k.salaries);
      expect((await getPayrollScreenAction(env.draft.id)).ok, `${who}: payroll run`).toBe(
        k.salaries,
      );
      expect((await getPayslipScreenAction(env.draft.id, line.id)).ok, `${who}: payslip`).toBe(
        k.salaries,
      );
      const advanceList = await getAdvanceListAction({});
      expect(advanceList.ok, `${who}: advances`).toBe(k.advances);
      expect((await listAdvanceRowsAction({})).ok, `${who}: more advances`).toBe(k.advances);
      expect((await getAdvanceScreenAction(env.advance.id)).ok, `${who}: advance`).toBe(k.advances);
      expect((await getAdvanceFormAction()).ok, `${who}: advance form`).toBe(k.give);
      expect((await getHrSettingsScreenAction()).ok, `${who}: settings`).toBe(k.view);

      // Salaries reach only the people who see them.
      if (overview.ok) {
        expect(overview.data.payroll !== null, `${who}: overview payroll`).toBe(k.salaries);
        expect(overview.data.advances !== null, `${who}: overview advances`).toBe(k.advances);
        expect(overview.data.can, who).toEqual({
          addEmployee: k.manage,
          markAttendance: k.manage,
          recordLeave: k.manage,
          startPayroll: k.payroll,
          giveAdvance: k.pay,
        });
      }
      if (list.ok) {
        expect(list.data.seeSalaries, who).toBe(k.salaries);
        expect(
          list.data.items.every((e) => (e.salary !== null) === k.salaries),
          `${who}: salaries in the list`,
        ).toBe(true);
        expect(list.data.can.add, who).toBe(k.manage);
      }
      if (profile.ok) {
        expect(profile.data.pay !== null, `${who}: pay on the profile`).toBe(k.salaries);
        expect(JSON.stringify(profile.data).includes("30000"), `${who}: salary figure`).toBe(
          k.salaries,
        );
      }
      if (advanceList.ok) {
        expect(advanceList.data.can.give, who).toBe(k.pay);
      }

      // The pages show "not part of your role" in the same cases.
      const page = (allowed: boolean) => (allowed ? "page" : "no access");
      const listed = { searchParams: noQuery() };
      const employee = { params: params({ employeeId: env.rahim.id }), searchParams: noQuery() };
      if (k.view || !k.advances) {
        expect(await rendered(HrOverviewPage()), `${who}: /hr`).toBe(page(k.view));
      } else {
        await expect(HrOverviewPage(), `${who}: /hr`).rejects.toMatchObject({
          redirectedTo: visibleHrTabs(ctx.permissions)[0]!.href,
        });
      }
      expect(await rendered(EmployeesPage(listed)), `${who}: employees`).toBe(page(k.view));
      expect(await rendered(NewEmployeePage()), `${who}: new employee`).toBe(page(k.manage));
      expect(await rendered(EmployeePage(employee)), `${who}: employee`).toBe(page(k.view));
      expect(
        await rendered(EditEmployeePage({ params: params({ employeeId: env.rahim.id }) })),
        `${who}: edit employee`,
      ).toBe(page(k.manage));
      expect(await rendered(EmployeeMonthPage(employee)), `${who}: month`).toBe(page(k.view));
      expect(await rendered(StatementPage(employee)), `${who}: statement`).toBe(page(k.salaries));
      expect(await rendered(AttendancePage(listed)), `${who}: attendance`).toBe(page(k.view));
      expect(await rendered(AttendanceMonthPage(listed)), `${who}: month totals`).toBe(
        page(k.view),
      );
      expect(await rendered(LeavePage(listed)), `${who}: leave`).toBe(page(k.view));
      expect(await rendered(NewLeavePage(listed)), `${who}: record leave`).toBe(page(k.manage));
      expect(
        await rendered(
          LeaveRequestPage({
            params: params({ leaveId: env.waiting.id }),
            searchParams: noQuery(),
          }),
        ),
        `${who}: leave request`,
      ).toBe(page(k.view));
      expect(await rendered(PayrollPage(listed)), `${who}: payroll`).toBe(page(k.salaries));
      expect(
        await rendered(
          PayrollRunPage({ params: params({ runId: env.draft.id }), searchParams: noQuery() }),
        ),
        `${who}: payroll run`,
      ).toBe(page(k.salaries));
      expect(
        await rendered(PayslipPage({ params: params({ runId: env.draft.id, itemId: line.id }) })),
        `${who}: payslip`,
      ).toBe(page(k.salaries));
      expect(await rendered(AdvancesPage(listed)), `${who}: advances`).toBe(page(k.advances));
      expect(await rendered(NewAdvancePage(listed)), `${who}: give an advance`).toBe(page(k.give));
      expect(
        await rendered(
          AdvancePage({ params: params({ advanceId: env.advance.id }), searchParams: noQuery() }),
        ),
        `${who}: advance`,
      ).toBe(page(k.advances));
      expect(await rendered(HrSettingsPage(listed)), `${who}: settings`).toBe(page(k.view));
    }
  });

  it("counts this month only up to today, and past months in full", async () => {
    const env = await factory();
    await as(env, "owner");
    const soFar = env.days.filter((d) => d <= today()).length;
    const month = data(await getEmployeeMonthScreenAction(env.karim.id, {}), "this month");
    expect(month.totals).toMatchObject({ workingDays: soFar, presentDays: soFar, absentDays: 0 });
    // The day list still runs to the end of the month.
    const [y, m] = today().split("-").map(Number) as [number, number];
    expect(month.days).toHaveLength(new Date(Date.UTC(y, m, 0)).getUTCDate());
    const profile = data(await getEmployeeScreenAction(env.karim.id), "profile");
    expect(profile.thisMonth.totals?.workingDays).toBe(soFar);
    const all = data(await getAttendanceMonthScreenAction({}), "month totals");
    expect(all.rows.find((r) => r.employee.id === env.karim.id)?.workingDays).toBe(soFar);
    const last = data(
      await getEmployeeMonthScreenAction(env.karim.id, { month: monthsAgo(1) }),
      "last",
    );
    expect(last.totals?.workingDays).toBe(
      env.draft.items.find((i) => i.employee.id === env.karim.id)!.days.working,
    );
  });

  it("offers each change to leave, attendance, people and rules exactly when it works", async () => {
    const env = await factory();
    const nextYear = Number(today().slice(0, 4)) + 1;

    for (const [i, who] of EVERYONE.entries()) {
      const ctx = await as(env, who);
      const k = keys(ctx);

      // A waiting request of their own to decide, on someone who is not them.
      const worker = await env.hire(`Worker ${who}`);
      const asked = await leave.createLeave(env.owner, {
        employeeId: worker.id,
        leaveTypeId: env.casual.id,
        startDate: env.days[1]!,
        approve: false,
      });
      const screen = await getLeaveScreenAction(asked.id);
      const can = screen.ok
        ? screen.data.can
        : { approve: false, reject: false, cancel: false, openEmployee: false };
      expect(can.approve, `${who}: approve offered`).toBe(k.manage);
      expectOffered(await approveLeaveAction(asked.id, {}), can.approve, `${who}: approve`);
      const approved = await getLeaveScreenAction(asked.id);
      if (approved.ok && approved.data.leave.status === "APPROVED") {
        expectOffered(
          await cancelLeaveAction(asked.id, {}),
          approved.data.can.cancel,
          `${who}: cancel approved leave`,
        );
      }
      const second = await leave.createLeave(env.owner, {
        employeeId: worker.id,
        leaveTypeId: env.casual.id,
        startDate: env.days[2]!,
        approve: false,
      });
      expectOffered(
        await rejectLeaveAction(second.id, { note: "Busy week" }),
        can.reject,
        `${who}: reject`,
      );

      // Marking today's attendance.
      const register = await getAttendanceScreenAction({});
      const mark = register.ok && register.data.can.mark;
      expect(mark, `${who}: mark offered`).toBe(k.manage);
      expectOffered(
        await markAttendanceAction({
          date: today(),
          entries: [{ employeeId: env.karim.id, status: "PRESENT" }],
        }),
        mark,
        `${who}: mark`,
      );

      // Changing someone's details.
      const profile = await getEmployeeScreenAction(env.karim.id);
      const edit = profile.ok && profile.data.can.edit;
      expectOffered(
        await updateEmployeeAction(env.karim.id, { designation: `Cutter ${i}` }),
        edit,
        `${who}: edit employee`,
      );

      // Holidays and leave types.
      const rules = await getHrSettingsScreenAction();
      const manage = rules.ok && rules.data.can.manage;
      expect(manage, `${who}: rules offered`).toBe(k.manage);
      expectOffered(
        await createHolidaysAction({
          date: `${nextYear}-02-${String(10 + i).padStart(2, "0")}`,
          name: `Company day ${i}`,
        }),
        manage,
        `${who}: add a holiday`,
      );
      expectOffered(
        await updateLeaveTypeAction(env.casual.id, { daysPerYear: 10 + (i % 2) }),
        manage,
        `${who}: change a leave type`,
      );
    }
  });

  it("offers preparing, approving and paying payroll exactly when it works", async () => {
    const env = await factory();
    const rahimLine = env.draft.items.find((i) => i.employee.id === env.rahim.id)!;

    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const k = keys(ctx);
      const screen = await getPayrollScreenAction(env.draft.id);
      const can = screen.ok ? screen.data.can : null;
      expect(can?.change ?? false, `${who}: change offered`).toBe(k.payroll);
      expect(can?.approve ?? false, `${who}: approve offered`).toBe(k.approve);
      expectOffered(
        await recalculatePayrollRunAction(env.draft.id),
        can?.change ?? false,
        `${who}: work it out again`,
      );
      const approved = await approvePayrollRunAction(env.draft.id);
      expectOffered(approved, can?.approve ?? false, `${who}: approve`);
      if (approved.ok) {
        const again = await getPayrollScreenAction(env.draft.id);
        expect(data(again, who).can.reopen, `${who}: reopen offered`).toBe(true);
        data(await reopenPayrollRunAction(env.draft.id, { reason: "Checking the reopen" }), who);
      }
    }

    // Approved: paying it is Accounts' (and the owner's), never HR's.
    await payroll.approvePayrollRun(env.owner, env.draft.id);
    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const k = keys(ctx);
      const screen = await getPayrollScreenAction(env.draft.id);
      const can = screen.ok ? screen.data.can : null;
      expect(can?.pay ?? false, `${who}: pay offered`).toBe(k.pay);
      expect(can?.change ?? false, `${who}: approved payroll stays as it is`).toBe(false);
      const paid = await payPayrollRunAction(env.draft.id, { itemIds: [rahimLine.id] });
      expectOffered(paid, can?.pay ?? false, `${who}: pay`);
      if (paid.ok) {
        expect(can?.voidPayment, `${who}: void offered`).toBe(k.pay && k.receive);
        data(
          await voidPayrollPaymentAction(paid.data.paymentId, { reason: "Paid twice by mistake" }),
          who,
        );
      }
    }
  });

  it("offers giving, changing, taking back and voiding advances exactly when it works", async () => {
    const env = await factory();

    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const k = keys(ctx);

      const list = await getAdvanceListAction({});
      const give = list.ok && list.data.can.give;
      expectOffered(
        await giveAdvanceAction({ employeeId: env.karim.id, amount: 500 }),
        give,
        `${who}: give`,
      );

      const fresh = await advances.giveAdvance(env.owner, {
        employeeId: env.karim.id,
        amount: 800,
      });
      const screen = await getAdvanceScreenAction(fresh.id);
      const can = screen.ok ? screen.data.can : { change: false, takeBack: false, void: false };
      expectOffered(
        await updateAdvanceAction(fresh.id, { purpose: `Visit ${who}` }),
        can.change,
        `${who}: change`,
      );
      const returned = await returnAdvanceAction(fresh.id, { amount: 100 });
      expectOffered(returned, can.takeBack, `${who}: money returned`);
      if (returned.ok) {
        const settlement = (await advances.getAdvance(env.owner, fresh.id)).settlements.at(-1)!;
        data(
          await voidAdvanceReturnAction(fresh.id, settlement.id, { reason: "Counted twice" }),
          `${who}: undo the return`,
        );
      }
      expectOffered(
        await voidAdvanceAction(fresh.id, { reason: "Entered by mistake" }),
        can.void,
        `${who}: void`,
      );
      expect(can.void, `${who}: void offered`).toBe(k.pay && k.receive);
    }
  });

  it("shows employees only their own records in My HR", async () => {
    const env = await factory();
    await payroll.approvePayrollRun(env.owner, env.draft.id);
    const rahimLine = env.draft.items.find((i) => i.employee.id === env.rahim.id)!;
    const karimLine = env.draft.items.find((i) => i.employee.id === env.karim.id)!;

    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const linked = who === "employee";
      const self = ctx.can("portal.self");
      const expected = !self ? "no access" : linked ? "page" : "not linked";
      const result = await getMyHrScreenAction();
      expect(result.ok, `${who}: my HR`).toBe(linked);
      if (!result.ok) {
        expect(result.error.code, who).toBe(self ? "NOT_FOUND" : "FORBIDDEN");
      }
      expect(await rendered(MyHrPage()), `${who}: /me`).toBe(expected);
      expect(await rendered(MyAttendancePage({ searchParams: noQuery() })), who).toBe(expected);
      expect(await rendered(MyLeavePage({ searchParams: noQuery() })), who).toBe(expected);
      expect(await rendered(MyPayslipsPage()), who).toBe(expected);
      expect(await rendered(MyAdvancesPage()), who).toBe(expected);
      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/me");
      expect(inMenu, `${who}: My HR in the menu`).toBe(
        self && !keys(ctx).view && !keys(ctx).advances,
      );
    }

    await as(env, "employee");
    const mine = data(await getMyHrScreenAction(), "my HR");
    expect(mine.profile.id).toBe(env.rahim.id);
    expect(mine.advances.outstanding).toBe("3000.00");
    expect(mine.latestPayslips.map((s) => s.itemId)).toEqual([rahimLine.id]);
    expect(data(await getMyMonthScreenAction({}), "month").employee.id).toBe(env.rahim.id);
    expect(data(await getMyAdvancesScreenAction(), "advances").items).toHaveLength(1);
    expect(data(await getMyPayslipsScreenAction(), "payslips").payslips).toHaveLength(1);
    expect(data(await getMyPayslipScreenAction(rahimLine.id), "payslip").slip.employee.id).toBe(
      env.rahim.id,
    );
    const other = await getMyPayslipScreenAction(karimLine.id);
    expect(other.ok ? "shown" : other.error.code).toBe("NOT_FOUND");
    await expect(MyPayslipPage({ params: params({ itemId: karimLine.id }) })).rejects.toMatchObject(
      { digest: "NEXT_HTTP_ERROR_FALLBACK;404" },
    );
    expect(await rendered(MyPayslipPage({ params: params({ itemId: rahimLine.id }) }))).toBe(
      "page",
    );

    // Checking in and out works exactly when it is offered.
    expectOffered(await checkInAction(), mine.can.checkIn, "check in");
    const after = data(await getMyHrScreenAction(), "after check-in");
    expectOffered(await checkOutAction(), after.can.checkOut, "check out");

    // Asking for leave, and withdrawing it while it waits.
    const asked = data(
      await requestMyLeaveAction({ leaveTypeId: env.casual.id, startDate: env.days.at(-1)! }),
      "ask for leave",
    );
    expect(asked.status).toBe("PENDING");
    const leaveScreen = data(await getMyLeaveScreenAction({}), "my leave");
    const request = leaveScreen.requests.find((r) => r.id === asked.id)!;
    const earlier = leaveScreen.requests.find((r) => r.id === env.waiting.id)!;
    expect(request.canWithdraw).toBe(true);
    expectOffered(await cancelMyLeaveAction(asked.id), request.canWithdraw, "withdraw");
    await leave.approveLeave(env.owner, env.waiting.id, {});
    const decided = data(await getMyLeaveScreenAction({}), "my leave").requests.find(
      (r) => r.id === earlier.id,
    )!;
    expect(decided.canWithdraw).toBe(false);
    expectOffered(await cancelMyLeaveAction(earlier.id), false, "withdraw approved leave");
  });
});
