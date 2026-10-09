"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";
import * as advances from "@/modules/hr/advance.service";
import * as attendance from "@/modules/hr/attendance.service";
import * as employees from "@/modules/hr/employee.service";
import * as leave from "@/modules/hr/leave.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as screens from "@/modules/hr/screens.service";
import * as settings from "@/modules/hr/settings.service";

/*
 * HR & Payroll Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   hr.view                   profiles, attendance, leave and holidays (no salaries)
 *   hr.manage                 employees and salaries, attendance, leave approval, HR rules
 *   hr.payroll                prepare monthly payroll; see salaries, payslips and advances
 *   hr.payroll.approve        approve or reopen payroll (posts it to the books)
 *   accounts.payments.record  pay advances and salaries (Accounts)
 *   accounts.receipts.record  take unspent advances back (Accounts)
 * Services check the HR and money permissions themselves too, so no caller can skip them.
 * Changes refresh the screens and hand back the record's id (and number or code) only.
 */

const hrRead = () => requireAnyPermission("hr.view", "hr.manage", "hr.payroll");
const hrManage = () => requirePermission("hr.manage");
const salaryRead = () => requireAnyPermission("hr.manage", "hr.payroll", "accounts.view");
const advanceRead = () =>
  requireAnyPermission("hr.manage", "hr.payroll", "accounts.view", "accounts.payments.record");
const runPayroll = () => requirePermission("hr.payroll");
const approvePayroll = () => requirePermission("hr.payroll.approve");
const payOut = () => requirePermission("accounts.payments.record");
const takeIn = () => requirePermission("accounts.receipts.record");
const giveOut = () => requireAnyPermission("accounts.payments.record", "accounts.manage");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const employeeRef = (e: { id: string; code: string; name: string }) => ({
  id: e.id,
  code: e.code,
  name: e.name,
});
const runRef = (r: { id: string; month: string; status: string }) => ({
  id: r.id,
  month: r.month,
  status: r.status,
});
const advanceRef = (a: { id: string; number: string; status: string; outstanding: string }) => ({
  id: a.id,
  number: a.number,
  status: a.status,
  outstanding: a.outstanding,
});
const leaveRef = (l: { id: string; status: string; days: number }) => ({
  id: l.id,
  status: l.status,
  days: l.days,
});

// --- Screens -------------------------------------------------------------------------------
export const getHrOverviewScreenAction = async () =>
  runAction(async () => screens.getOverviewScreen(await hrRead()));
export const getEmployeeListAction = async (query: unknown) =>
  runAction(async () => screens.getEmployeeList(await hrRead(), query));
export const listEmployeeRowsAction = async (query: unknown) =>
  runAction(async () => screens.listEmployeeRows(await hrRead(), query));
export const getEmployeeScreenAction = async (
  employeeId: string,
  options: { year?: number } = {},
) => runAction(async () => screens.getEmployeeScreen(await hrRead(), employeeId, options));
export const getEmployeeFormAction = async (employeeId?: string) =>
  runAction(async () => screens.getEmployeeForm(await hrManage(), employeeId));
export const getEmployeeMonthScreenAction = async (employeeId: string, query: unknown) =>
  runAction(async () => screens.getEmployeeMonthScreen(await hrRead(), employeeId, query));
export const getStatementScreenAction = async (
  employeeId: string,
  query: { from?: string; to?: string } = {},
) => runAction(async () => screens.getStatementScreen(await salaryRead(), employeeId, query));
export const getAttendanceScreenAction = async (query: unknown) =>
  runAction(async () => screens.getAttendanceScreen(await hrRead(), query));
export const getAttendanceMonthScreenAction = async (query: unknown) =>
  runAction(async () => screens.getAttendanceMonthScreen(await hrRead(), query));
export const getLeaveListAction = async (query: unknown) =>
  runAction(async () => screens.getLeaveList(await hrRead(), query));
export const listLeaveRowsAction = async (query: unknown) =>
  runAction(async () => screens.listLeaveRows(await hrRead(), query));
export const getLeaveScreenAction = async (leaveId: string) =>
  runAction(async () => screens.getLeaveScreen(await hrRead(), leaveId));
export const getLeaveFormAction = async (options: { employeeId?: string } = {}) =>
  runAction(async () => screens.getLeaveForm(await hrManage(), options));
export const getPayrollListAction = async (query: { year?: unknown } = {}) =>
  runAction(async () => screens.getPayrollList(await salaryRead(), query));
export const getPayrollScreenAction = async (runId: string) =>
  runAction(async () => screens.getPayrollScreen(await salaryRead(), runId));
export const getPayslipScreenAction = async (runId: string, itemId: string) =>
  runAction(async () => screens.getPayslipScreen(await salaryRead(), runId, itemId));
export const getAdvanceListAction = async (query: unknown) =>
  runAction(async () => screens.getAdvanceList(await advanceRead(), query));
export const listAdvanceRowsAction = async (query: unknown) =>
  runAction(async () => screens.listAdvanceRows(await advanceRead(), query));
export const getAdvanceScreenAction = async (advanceId: string) =>
  runAction(async () => screens.getAdvanceScreen(await advanceRead(), advanceId));
export const getAdvanceFormAction = async (options: { employeeId?: string } = {}) =>
  runAction(async () => screens.getAdvanceForm(await giveOut(), options));
export const getHrSettingsScreenAction = async (query: { year?: unknown } = {}) =>
  runAction(async () => screens.getSettingsScreen(await hrRead(), query));

// --- Rules, holidays, leave types --------------------------------------------------------
export const getHrSettingsAction = async () =>
  runAction(async () => settings.getHrSettings(await hrRead()));
export const updateHrSettingsAction = async (input: unknown) =>
  change(async () => {
    await settings.updateHrSettings(await hrManage(), input, await getRequestMeta());
    return { saved: true };
  });
export const listHolidaysAction = async (query: unknown) =>
  runAction(async () =>
    settings.listHolidays(
      await requireAnyPermission("hr.view", "hr.manage", "hr.payroll", "portal.self"),
      query,
    ),
  );
export const createHolidaysAction = async (input: unknown) =>
  change(async () => {
    const added = await settings.createHolidays(await hrManage(), input, await getRequestMeta());
    return { year: added.year };
  });
export const deleteHolidayAction = async (holidayId: string) =>
  change(async () => settings.deleteHoliday(await hrManage(), holidayId, await getRequestMeta()));
export const listLeaveTypesAction = async (query: { includeInactive?: unknown } = {}) =>
  runAction(async () =>
    settings.listLeaveTypes(
      await requireAnyPermission("hr.view", "hr.manage", "hr.payroll", "portal.self"),
      query,
    ),
  );
export const createLeaveTypeAction = async (input: unknown) =>
  change(async () => {
    const type = await settings.createLeaveType(await hrManage(), input, await getRequestMeta());
    return { id: type.id, name: type.name };
  });
export const updateLeaveTypeAction = async (leaveTypeId: string, input: unknown) =>
  change(async () => {
    const type = await settings.updateLeaveType(
      await hrManage(),
      leaveTypeId,
      input,
      await getRequestMeta(),
    );
    return { id: type.id, name: type.name };
  });

// --- Employees ------------------------------------------------------------------------------
export const listEmployeesAction = async (query: unknown) =>
  runAction(async () => employees.listEmployees(await hrRead(), query));
/** Names and codes for pickers (the employee on a conveyance expense). */
export const employeeDirectoryAction = async (query: unknown) =>
  runAction(async () =>
    employees.employeeDirectory(
      await requireAnyPermission(
        "hr.view",
        "hr.manage",
        "hr.payroll",
        "expenses.create",
        "expenses.manage",
        "accounts.view",
        "accounts.payments.record",
      ),
      query,
    ),
  );
export const getEmployeeAction = async (employeeId: string) =>
  runAction(async () => employees.getEmployee(await hrRead(), employeeId));
export const createEmployeeAction = async (input: unknown) =>
  change(async () =>
    employeeRef(await employees.createEmployee(await hrManage(), input, await getRequestMeta())),
  );
export const updateEmployeeAction = async (employeeId: string, input: unknown) =>
  change(async () =>
    employeeRef(
      await employees.updateEmployee(await hrManage(), employeeId, input, await getRequestMeta()),
    ),
  );
export const deleteEmployeeAction = async (employeeId: string) =>
  change(async () =>
    employees.deleteEmployee(await hrManage(), employeeId, await getRequestMeta()),
  );
export const reviseSalaryAction = async (employeeId: string, input: unknown) =>
  change(async () =>
    employeeRef(
      await employees.reviseSalary(await hrManage(), employeeId, input, await getRequestMeta()),
    ),
  );
export const deleteSalaryRevisionAction = async (employeeId: string, revisionId: string) =>
  change(async () =>
    employeeRef(
      await employees.deleteSalaryRevision(
        await hrManage(),
        employeeId,
        revisionId,
        await getRequestMeta(),
      ),
    ),
  );
export const exitEmployeeAction = async (employeeId: string, input: unknown) =>
  change(async () =>
    employeeRef(
      await employees.exitEmployee(await hrManage(), employeeId, input, await getRequestMeta()),
    ),
  );
export const reinstateEmployeeAction = async (employeeId: string) =>
  change(async () =>
    employeeRef(
      await employees.reinstateEmployee(await hrManage(), employeeId, await getRequestMeta()),
    ),
  );
/** The temporary password comes back once, for a login made for them now. */
export const grantPortalAccessAction = async (employeeId: string, input: unknown) =>
  change(async () => {
    const granted = await employees.grantPortalAccess(
      await hrManage(),
      employeeId,
      input,
      await getRequestMeta(),
    );
    return {
      email: granted.employee.portalLogin?.email ?? null,
      temporaryPassword: granted.temporaryPassword,
    };
  });
export const revokePortalAccessAction = async (employeeId: string) =>
  change(async () =>
    employeeRef(
      await employees.revokePortalAccess(await hrManage(), employeeId, await getRequestMeta()),
    ),
  );
export const getEmployeeStatementAction = async (employeeId: string, query: unknown) =>
  runAction(async () => employees.getEmployeeStatement(await salaryRead(), employeeId, query));

// --- Attendance -----------------------------------------------------------------------------
export const getAttendanceDayAction = async (query: unknown) =>
  runAction(async () => attendance.getAttendanceDay(await hrRead(), query));
export const markAttendanceAction = async (input: unknown) =>
  change(async () => {
    const day = await attendance.markAttendance(await hrManage(), input, await getRequestMeta());
    return { date: day.date, totals: day.totals };
  });
export const clearAttendanceAction = async (attendanceId: string) =>
  change(async () =>
    attendance.clearAttendance(await hrManage(), attendanceId, await getRequestMeta()),
  );
export const getAttendanceSummaryAction = async (query: unknown) =>
  runAction(async () => attendance.getAttendanceSummary(await hrRead(), query));
export const getEmployeeAttendanceAction = async (employeeId: string, query: unknown) =>
  runAction(async () => attendance.getEmployeeAttendance(await hrRead(), employeeId, query));

// --- Leave ----------------------------------------------------------------------------------
export const listLeaveRequestsAction = async (query: unknown) =>
  runAction(async () => leave.listLeaveRequests(await hrRead(), query));
export const getLeaveRequestAction = async (leaveId: string) =>
  runAction(async () => leave.getLeaveRequest(await hrRead(), leaveId));
/** A doctor's note or other paper for a leave request, recorded by HR. */
export const uploadLeaveFileAction = async (form: FormData) =>
  runAction(async () => {
    const asset = await files.storeUpload(
      await hrManage(),
      await files.fileFromForm(form),
      await getRequestMeta(),
    );
    return { id: asset.id, fileName: asset.fileName };
  });
export const createLeaveAction = async (input: unknown) =>
  change(async () =>
    leaveRef(await leave.createLeave(await hrManage(), input, await getRequestMeta())),
  );
export const approveLeaveAction = async (leaveId: string, input: unknown) =>
  change(async () =>
    leaveRef(await leave.approveLeave(await hrManage(), leaveId, input, await getRequestMeta())),
  );
export const rejectLeaveAction = async (leaveId: string, input: unknown) =>
  change(async () =>
    leaveRef(await leave.rejectLeave(await hrManage(), leaveId, input, await getRequestMeta())),
  );
export const cancelLeaveAction = async (leaveId: string, input: unknown) =>
  change(async () =>
    leaveRef(await leave.cancelLeave(await hrManage(), leaveId, input, await getRequestMeta())),
  );
export const getLeaveBalancesAction = async (query: unknown) =>
  runAction(async () => leave.getLeaveBalances(await hrRead(), query));
export const adjustLeaveBalanceAction = async (input: unknown) =>
  change(async () => {
    await leave.adjustLeaveBalance(await hrManage(), input, await getRequestMeta());
    return { saved: true };
  });

// --- Advances -------------------------------------------------------------------------------
export const listAdvancesAction = async (query: unknown) =>
  runAction(async () => advances.listAdvances(await advanceRead(), query));
export const getAdvanceAction = async (advanceId: string) =>
  runAction(async () => advances.getAdvance(await advanceRead(), advanceId));
/** Paying an advance needs accounts.payments.record; bringing one forward, accounts.manage. */
export const giveAdvanceAction = async (input: unknown) =>
  change(async () =>
    advanceRef(await advances.giveAdvance(await giveOut(), input, await getRequestMeta())),
  );
export const updateAdvanceAction = async (advanceId: string, input: unknown) =>
  change(async () =>
    advanceRef(
      await advances.updateAdvance(
        await requireAnyPermission("accounts.payments.record", "hr.payroll"),
        advanceId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const returnAdvanceAction = async (advanceId: string, input: unknown) =>
  change(async () =>
    advanceRef(
      await advances.returnAdvance(await takeIn(), advanceId, input, await getRequestMeta()),
    ),
  );
export const voidAdvanceReturnAction = async (
  advanceId: string,
  settlementId: string,
  input: unknown,
) =>
  change(async () =>
    advanceRef(
      await advances.voidAdvanceReturn(
        await takeIn(),
        advanceId,
        settlementId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const voidAdvanceAction = async (advanceId: string, input: unknown) =>
  change(async () =>
    advanceRef(
      await advances.voidAdvance(await giveOut(), advanceId, input, await getRequestMeta()),
    ),
  );

// --- Payroll --------------------------------------------------------------------------------
export const listPayrollRunsAction = async (query: unknown) =>
  runAction(async () => payroll.listPayrollRuns(await salaryRead(), query));
export const getPayrollRunAction = async (runId: string) =>
  runAction(async () => payroll.getPayrollRun(await salaryRead(), runId));
export const createPayrollRunAction = async (input: unknown) =>
  change(async () =>
    runRef(await payroll.createPayrollRun(await runPayroll(), input, await getRequestMeta())),
  );
export const recalculatePayrollRunAction = async (runId: string) =>
  change(async () =>
    runRef(await payroll.recalculatePayrollRun(await runPayroll(), runId, await getRequestMeta())),
  );
export const updatePayrollItemAction = async (runId: string, itemId: string, input: unknown) =>
  change(async () =>
    runRef(
      await payroll.updatePayrollItem(
        await runPayroll(),
        runId,
        itemId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const setPayrollBonusAction = async (runId: string, input: unknown) =>
  change(async () =>
    runRef(await payroll.setPayrollBonus(await runPayroll(), runId, input, await getRequestMeta())),
  );
export const deletePayrollRunAction = async (runId: string) =>
  change(async () => payroll.deletePayrollRun(await runPayroll(), runId, await getRequestMeta()));
export const approvePayrollRunAction = async (runId: string) =>
  change(async () =>
    runRef(await payroll.approvePayrollRun(await approvePayroll(), runId, await getRequestMeta())),
  );
export const reopenPayrollRunAction = async (runId: string, input: unknown) =>
  change(async () =>
    runRef(
      await payroll.reopenPayrollRun(await approvePayroll(), runId, input, await getRequestMeta()),
    ),
  );
export const payPayrollRunAction = async (runId: string, input: unknown) =>
  change(async () => {
    const paid = await payroll.payPayrollRun(await payOut(), runId, input, await getRequestMeta());
    return { paymentId: paid.paymentId, number: paid.number, run: runRef(paid.run) };
  });
export const voidPayrollPaymentAction = async (paymentId: string, input: unknown) =>
  change(async () =>
    runRef(
      await payroll.voidPayrollPayment(await payOut(), paymentId, input, await getRequestMeta()),
    ),
  );
export const getPayslipAction = async (runId: string, itemId: string) =>
  runAction(async () => payroll.getPayslip(await salaryRead(), runId, itemId));
