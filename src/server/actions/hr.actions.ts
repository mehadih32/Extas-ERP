"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as advances from "@/modules/hr/advance.service";
import * as attendance from "@/modules/hr/attendance.service";
import * as employees from "@/modules/hr/employee.service";
import * as leave from "@/modules/hr/leave.service";
import * as payroll from "@/modules/hr/payroll.service";
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

// --- Rules, holidays, leave types --------------------------------------------------------
export const getHrSettingsAction = async () =>
  runAction(async () => settings.getHrSettings(await hrRead()));
export const updateHrSettingsAction = async (input: unknown) =>
  runAction(async () => settings.updateHrSettings(await hrManage(), input, await getRequestMeta()));
export const listHolidaysAction = async (query: unknown) =>
  runAction(async () =>
    settings.listHolidays(
      await requireAnyPermission("hr.view", "hr.manage", "hr.payroll", "portal.self"),
      query,
    ),
  );
export const createHolidaysAction = async (input: unknown) =>
  runAction(async () => settings.createHolidays(await hrManage(), input, await getRequestMeta()));
export const deleteHolidayAction = async (holidayId: string) =>
  runAction(async () =>
    settings.deleteHoliday(await hrManage(), holidayId, await getRequestMeta()),
  );
export const listLeaveTypesAction = async (query: { includeInactive?: unknown } = {}) =>
  runAction(async () =>
    settings.listLeaveTypes(
      await requireAnyPermission("hr.view", "hr.manage", "hr.payroll", "portal.self"),
      query,
    ),
  );
export const createLeaveTypeAction = async (input: unknown) =>
  runAction(async () => settings.createLeaveType(await hrManage(), input, await getRequestMeta()));
export const updateLeaveTypeAction = async (leaveTypeId: string, input: unknown) =>
  runAction(async () =>
    settings.updateLeaveType(await hrManage(), leaveTypeId, input, await getRequestMeta()),
  );

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
  runAction(async () => employees.createEmployee(await hrManage(), input, await getRequestMeta()));
export const updateEmployeeAction = async (employeeId: string, input: unknown) =>
  runAction(async () =>
    employees.updateEmployee(await hrManage(), employeeId, input, await getRequestMeta()),
  );
export const deleteEmployeeAction = async (employeeId: string) =>
  runAction(async () =>
    employees.deleteEmployee(await hrManage(), employeeId, await getRequestMeta()),
  );
export const reviseSalaryAction = async (employeeId: string, input: unknown) =>
  runAction(async () =>
    employees.reviseSalary(await hrManage(), employeeId, input, await getRequestMeta()),
  );
export const deleteSalaryRevisionAction = async (employeeId: string, revisionId: string) =>
  runAction(async () =>
    employees.deleteSalaryRevision(
      await hrManage(),
      employeeId,
      revisionId,
      await getRequestMeta(),
    ),
  );
export const exitEmployeeAction = async (employeeId: string, input: unknown) =>
  runAction(async () =>
    employees.exitEmployee(await hrManage(), employeeId, input, await getRequestMeta()),
  );
export const reinstateEmployeeAction = async (employeeId: string) =>
  runAction(async () =>
    employees.reinstateEmployee(await hrManage(), employeeId, await getRequestMeta()),
  );
export const grantPortalAccessAction = async (employeeId: string, input: unknown) =>
  runAction(async () =>
    employees.grantPortalAccess(await hrManage(), employeeId, input, await getRequestMeta()),
  );
export const revokePortalAccessAction = async (employeeId: string) =>
  runAction(async () =>
    employees.revokePortalAccess(await hrManage(), employeeId, await getRequestMeta()),
  );
export const getEmployeeStatementAction = async (employeeId: string, query: unknown) =>
  runAction(async () => employees.getEmployeeStatement(await salaryRead(), employeeId, query));

// --- Attendance -----------------------------------------------------------------------------
export const getAttendanceDayAction = async (query: unknown) =>
  runAction(async () => attendance.getAttendanceDay(await hrRead(), query));
export const markAttendanceAction = async (input: unknown) =>
  runAction(async () => attendance.markAttendance(await hrManage(), input, await getRequestMeta()));
export const clearAttendanceAction = async (attendanceId: string) =>
  runAction(async () =>
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
export const createLeaveAction = async (input: unknown) =>
  runAction(async () => leave.createLeave(await hrManage(), input, await getRequestMeta()));
export const approveLeaveAction = async (leaveId: string, input: unknown) =>
  runAction(async () =>
    leave.approveLeave(await hrManage(), leaveId, input, await getRequestMeta()),
  );
export const rejectLeaveAction = async (leaveId: string, input: unknown) =>
  runAction(async () =>
    leave.rejectLeave(await hrManage(), leaveId, input, await getRequestMeta()),
  );
export const cancelLeaveAction = async (leaveId: string, input: unknown) =>
  runAction(async () =>
    leave.cancelLeave(await hrManage(), leaveId, input, await getRequestMeta()),
  );
export const getLeaveBalancesAction = async (query: unknown) =>
  runAction(async () => leave.getLeaveBalances(await hrRead(), query));
export const adjustLeaveBalanceAction = async (input: unknown) =>
  runAction(async () => leave.adjustLeaveBalance(await hrManage(), input, await getRequestMeta()));

// --- Advances -------------------------------------------------------------------------------
export const listAdvancesAction = async (query: unknown) =>
  runAction(async () => advances.listAdvances(await advanceRead(), query));
export const getAdvanceAction = async (advanceId: string) =>
  runAction(async () => advances.getAdvance(await advanceRead(), advanceId));
/** Paying an advance needs accounts.payments.record; bringing one forward, accounts.manage. */
export const giveAdvanceAction = async (input: unknown) =>
  runAction(async () =>
    advances.giveAdvance(
      await requireAnyPermission("accounts.payments.record", "accounts.manage"),
      input,
      await getRequestMeta(),
    ),
  );
export const updateAdvanceAction = async (advanceId: string, input: unknown) =>
  runAction(async () =>
    advances.updateAdvance(
      await requireAnyPermission("accounts.payments.record", "hr.payroll"),
      advanceId,
      input,
      await getRequestMeta(),
    ),
  );
export const returnAdvanceAction = async (advanceId: string, input: unknown) =>
  runAction(async () =>
    advances.returnAdvance(await takeIn(), advanceId, input, await getRequestMeta()),
  );
export const voidAdvanceReturnAction = async (
  advanceId: string,
  settlementId: string,
  input: unknown,
) =>
  runAction(async () =>
    advances.voidAdvanceReturn(
      await takeIn(),
      advanceId,
      settlementId,
      input,
      await getRequestMeta(),
    ),
  );
export const voidAdvanceAction = async (advanceId: string, input: unknown) =>
  runAction(async () =>
    advances.voidAdvance(
      await requireAnyPermission("accounts.payments.record", "accounts.manage"),
      advanceId,
      input,
      await getRequestMeta(),
    ),
  );

// --- Payroll --------------------------------------------------------------------------------
export const listPayrollRunsAction = async (query: unknown) =>
  runAction(async () => payroll.listPayrollRuns(await salaryRead(), query));
export const getPayrollRunAction = async (runId: string) =>
  runAction(async () => payroll.getPayrollRun(await salaryRead(), runId));
export const createPayrollRunAction = async (input: unknown) =>
  runAction(async () =>
    payroll.createPayrollRun(await runPayroll(), input, await getRequestMeta()),
  );
export const recalculatePayrollRunAction = async (runId: string) =>
  runAction(async () =>
    payroll.recalculatePayrollRun(await runPayroll(), runId, await getRequestMeta()),
  );
export const updatePayrollItemAction = async (runId: string, itemId: string, input: unknown) =>
  runAction(async () =>
    payroll.updatePayrollItem(await runPayroll(), runId, itemId, input, await getRequestMeta()),
  );
export const setPayrollBonusAction = async (runId: string, input: unknown) =>
  runAction(async () =>
    payroll.setPayrollBonus(await runPayroll(), runId, input, await getRequestMeta()),
  );
export const deletePayrollRunAction = async (runId: string) =>
  runAction(async () =>
    payroll.deletePayrollRun(await runPayroll(), runId, await getRequestMeta()),
  );
export const approvePayrollRunAction = async (runId: string) =>
  runAction(async () =>
    payroll.approvePayrollRun(await approvePayroll(), runId, await getRequestMeta()),
  );
export const reopenPayrollRunAction = async (runId: string, input: unknown) =>
  runAction(async () =>
    payroll.reopenPayrollRun(await approvePayroll(), runId, input, await getRequestMeta()),
  );
export const payPayrollRunAction = async (runId: string, input: unknown) =>
  runAction(async () =>
    payroll.payPayrollRun(await payOut(), runId, input, await getRequestMeta()),
  );
export const voidPayrollPaymentAction = async (paymentId: string, input: unknown) =>
  runAction(async () =>
    payroll.voidPayrollPayment(await payOut(), paymentId, input, await getRequestMeta()),
  );
export const getPayslipAction = async (runId: string, itemId: string) =>
  runAction(async () => payroll.getPayslip(await salaryRead(), runId, itemId));
