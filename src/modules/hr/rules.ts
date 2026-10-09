import type {
  AdvanceSettlementKind,
  AdvanceStatus,
  LeaveStatus,
  PayrollStatus,
} from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import { monthKey, monthLabel } from "@/modules/hr/calendar";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * What may be done with an employee, a leave request, a payroll or a salary
 * advance from where it stands, and who may do it. The HR services refuse with
 * these answers and the HR & payroll screens read the same answers to decide
 * what to offer. Months whose payroll is approved are frozen (period-lock.ts):
 * the services check that inside their transaction, and the screens pass the
 * months they know are closed so they do not offer such changes.
 */

type Can = { can: (permission: PermissionKey) => boolean };

/**
 * The HR keys a person holds, and what they add up to:
 *   view       employees, attendance, leave and holidays (no salaries)
 *   manage     hr.manage: employees and salaries, attendance, leave decisions, HR rules
 *   salaries   salaries, payslips and payroll (hr.manage, hr.payroll or accounts.view)
 *   advances   the advances register (salaries, or paying money out)
 *   payroll    hr.payroll: prepares the month's payroll
 *   approve    hr.payroll.approve: approves or reopens it (posts it to the books)
 *   pay        accounts.payments.record: pays salaries and advances
 *   receive    accounts.receipts.record: takes unspent advances back
 */
export function hrKeys(ctx: Can) {
  const manage = ctx.can("hr.manage");
  const payroll = ctx.can("hr.payroll");
  const accountsView = ctx.can("accounts.view");
  const pay = ctx.can("accounts.payments.record");
  const receive = ctx.can("accounts.receipts.record");
  const accountsManage = ctx.can("accounts.manage");
  const salaries = manage || payroll || accountsView;
  return {
    view: ctx.can("hr.view") || manage || payroll,
    manage,
    salaries,
    advances: salaries || pay,
    payroll,
    approve: ctx.can("hr.payroll.approve"),
    pay,
    receive,
    accountsManage,
    /** Hand an employee an advance (money out). */
    giveAdvance: pay,
    /** Record an advance owed from before the ERP (no money moves). */
    openingAdvance: accountsManage,
    /** Change how an open advance is recovered. */
    changeRecovery: pay || payroll,
    /** The employee portal: their own records. */
    self: ctx.can("portal.self"),
  };
}

export type HrKeys = ReturnType<typeof hrKeys>;

const monthText = (month: string) => monthLabel(month);

/** Refused when a change touches a month whose payroll is approved. */
export function monthOpen(month: string, closedMonths: ReadonlySet<string>, what: string): Verdict {
  if (closedMonths.has(month)) {
    return refuse(
      "CONFLICT",
      `The payroll for ${monthText(month)} is approved, so ${what} in that month cannot change. Reopen that payroll first.`,
    );
  }
  return ALLOWED;
}

// --- Employees ---------------------------------------------------------------------------

type EmployeeState = {
  name: string;
  /** The login linked to them, if any. */
  userId: string | null;
  exitDate: string | null;
};

/**
 * Salaries, approving leave and cancelling approved leave are someone else's
 * call for one's own record (a Super Admin aside).
 */
export function canActOnOwnRecord(
  employee: Pick<EmployeeState, "userId">,
  me: { userId: string; isOwner: boolean },
  message: string,
): Verdict {
  if (employee.userId === me.userId && !me.isOwner) return refuse("FORBIDDEN", message);
  return ALLOWED;
}

export function canChangeSalary(
  employee: EmployeeState,
  me: { userId: string; isOwner: boolean },
): Verdict {
  return canActOnOwnRecord(employee, me, "Someone else must change your own salary.");
}

/** The joining salary stays; later revisions entered by mistake are removed. */
export function canRemoveSalaryRevision(revision: { isJoining: boolean }): Verdict {
  if (revision.isJoining) {
    return refuse("CONFLICT", "The joining salary stays; add a new revision instead.");
  }
  return ALLOWED;
}

export function canReinstate(employee: EmployeeState): Verdict {
  if (!employee.exitDate) return refuse("CONFLICT", `${employee.name} has not left.`);
  return ALLOWED;
}

/** Changing the status (active / on long leave) is for people still working here. */
export function canSetStatus(employee: EmployeeState): Verdict {
  if (employee.exitDate) {
    return refuse("CONFLICT", `${employee.name} has left; reinstate them first.`);
  }
  return ALLOWED;
}

/** Only someone added by mistake, with no records at all, is deleted. */
export function canDeleteEmployee(employee: EmployeeState, records: number): Verdict {
  if (records > 0) {
    return refuse(
      "CONFLICT",
      `${employee.name} has payroll, advance, attendance, leave or expense records. Record their leaving day instead.`,
    );
  }
  return ALLOWED;
}

export function canGivePortalLogin(
  employee: EmployeeState & { loginEmail?: string | null },
): Verdict {
  if (employee.userId) {
    return refuse(
      "CONFLICT",
      `${employee.name} already signs in as ${employee.loginEmail ?? "another login"}; remove that first.`,
    );
  }
  return ALLOWED;
}

export function canRemovePortalLogin(employee: EmployeeState): Verdict {
  if (!employee.userId) return refuse("CONFLICT", `${employee.name} has no portal login.`);
  return ALLOWED;
}

// --- Attendance ----------------------------------------------------------------------------

/** A day is marked once it has come, while its month's payroll is open. */
export function canMarkDay(day: string, today: string, closedMonths: ReadonlySet<string>): Verdict {
  if (day > today) return refuse("VALIDATION", "Attendance cannot be marked ahead.");
  return monthOpen(day.slice(0, 7), closedMonths, "attendance");
}

// --- Leave -----------------------------------------------------------------------------------

type LeaveState = {
  status: LeaveStatus;
  /** The employee's login, to spot one's own leave. */
  employeeUserId: string | null;
  /** The months the leave touches ("2026-10"). */
  months: string[];
};

const already = (status: LeaveStatus) =>
  refuse("CONFLICT", `This request is already ${status.toLowerCase()}.`);

export function canApproveLeave(
  leave: LeaveState,
  me: { userId: string; isOwner: boolean },
  closedMonths: ReadonlySet<string>,
): Verdict {
  if (leave.status !== "PENDING") return already(leave.status);
  const own = canActOnOwnRecord(
    { userId: leave.employeeUserId },
    me,
    "Someone else must approve your own leave.",
  );
  if (!own.ok) return own;
  for (const month of leave.months) {
    const open = monthOpen(month, closedMonths, "leave");
    if (!open.ok) return open;
  }
  return ALLOWED;
}

export function canRejectLeave(leave: Pick<LeaveState, "status">): Verdict {
  if (leave.status !== "PENDING") return already(leave.status);
  return ALLOWED;
}

/**
 * HR cancels waiting or approved leave (approved leave only while its months'
 * payroll is open, and not their own); employees withdraw their own waiting
 * requests.
 */
export function canCancelLeave(
  leave: LeaveState,
  me: { userId: string; isOwner: boolean; manage: boolean },
  closedMonths: ReadonlySet<string>,
): Verdict {
  const own = leave.employeeUserId === me.userId;
  if (!me.manage) {
    if (!own) return refuse("FORBIDDEN", "Only HR can cancel someone else's leave.");
    if (leave.status === "APPROVED") {
      return refuse("CONFLICT", "Ask HR to cancel leave that is already approved.");
    }
  }
  if (leave.status !== "PENDING" && leave.status !== "APPROVED") return already(leave.status);
  if (leave.status === "APPROVED") {
    const mine = canActOnOwnRecord(
      { userId: leave.employeeUserId },
      me,
      "Someone else must cancel your own approved leave.",
    );
    if (!mine.ok) return mine;
    for (const month of leave.months) {
      const open = monthOpen(month, closedMonths, "leave");
      if (!open.ok) return open;
    }
  }
  return ALLOWED;
}

/** Only paid leave has a yearly allowance to set. */
export function canSetAllowance(type: { name: string; isPaid: boolean }): Verdict {
  if (!type.isPaid) {
    return refuse("VALIDATION", `${type.name} is unpaid and has no allowance to set.`);
  }
  return ALLOWED;
}

/** Paid or unpaid decides past salaries, so a type with approved leave keeps it. */
export function canSwitchPaid(type: { name: string }, approvedRequests: number): Verdict {
  if (approvedRequests > 0) {
    return refuse(
      "CONFLICT",
      `${type.name} already has approved leave, so it cannot switch between paid and unpaid. Add a new leave type instead.`,
    );
  }
  return ALLOWED;
}

// --- Payroll ---------------------------------------------------------------------------------

type RunState = { status: PayrollStatus; year: number; month: number };

const runLabel = (run: RunState) => monthLabel(monthKey(run.year, run.month));

/** A draft is worked on (recalculated, edited, bonus added, deleted) until it is approved. */
export function canChangePayroll(run: RunState): Verdict {
  if (run.status !== "DRAFT") {
    return refuse(
      "CONFLICT",
      `The payroll for ${runLabel(run)} is ${run.status.toLowerCase()}; reopen it to change it.`,
    );
  }
  return ALLOWED;
}

export const canApprovePayroll = canChangePayroll;

/** Reopened only with no live salary payments (void those first). */
export function canReopenPayroll(run: RunState, livePayments: number): Verdict {
  if (run.status === "DRAFT") return refuse("CONFLICT", "This payroll is still a draft.");
  if (livePayments > 0) {
    return refuse("CONFLICT", "Salaries from this payroll were paid; void those payments first.");
  }
  return ALLOWED;
}

/** Salaries are paid once the payroll is approved, while someone is still unpaid. */
export function canPayPayroll(run: RunState, unpaidLines: number): Verdict {
  if (run.status === "DRAFT") {
    return refuse("CONFLICT", `Approve the payroll for ${runLabel(run)} before paying it.`);
  }
  if (run.status === "PAID") {
    return refuse("CONFLICT", `The payroll for ${runLabel(run)} is already fully paid.`);
  }
  if (unpaidLines === 0) return refuse("CONFLICT", "Nothing is left to pay.");
  return ALLOWED;
}

export function canVoidSalaryPayment(payment: { number: string; voided: boolean }): Verdict {
  if (payment.voided) return refuse("CONFLICT", `${payment.number} is already void.`);
  return ALLOWED;
}

// --- Salary advances ---------------------------------------------------------------------

type AdvanceState = { number: string; status: AdvanceStatus; isOpening: boolean };

const notOpen = (a: AdvanceState) =>
  refuse("CONFLICT", `${a.number} is ${a.status.toLowerCase()}.`);

/** How an advance is recovered changes, and money is taken back, while it is open. */
export function canChangeAdvance(advance: AdvanceState): Verdict {
  if (advance.status !== "OPEN") return notOpen(advance);
  return ALLOWED;
}

export const canTakeAdvanceBack = canChangeAdvance;

/** An advance recorded by mistake is voided before any of it is recovered or spent. */
export function canVoidAdvance(advance: AdvanceState, liveSettlements: number): Verdict {
  if (advance.status === "VOID") return refuse("CONFLICT", `${advance.number} is already void.`);
  if (liveSettlements > 0) {
    return refuse(
      "CONFLICT",
      `Part of ${advance.number} has been recovered or spent; undo those first or take the rest back.`,
    );
  }
  return ALLOWED;
}

/** Whose keys void an advance: Accounts' money keys, or accounts.manage for one brought forward. */
export function mayVoidAdvance(keys: HrKeys, advance: Pick<AdvanceState, "isOpening">): boolean {
  return advance.isOpening ? keys.accountsManage : keys.pay && keys.receive;
}

/** Only money handed back in cash is undone here; salary and expense settlements have their own records. */
export function isCashReturn(settlement: { kind: AdvanceSettlementKind; hasEntry: boolean }) {
  return settlement.kind === "CASH_RETURN" && settlement.hasEntry;
}

/** A cash return recorded by mistake is undone (the amount is owed again). */
export function canUndoReturn(advance: AdvanceState, settlement: { reversed: boolean }): Verdict {
  if (advance.status === "VOID") return refuse("CONFLICT", `${advance.number} is void.`);
  if (settlement.reversed) return refuse("CONFLICT", "This return was already undone.");
  return ALLOWED;
}

// --- Holidays --------------------------------------------------------------------------------

export function canRemoveHoliday(day: string, closedMonths: ReadonlySet<string>): Verdict {
  return monthOpen(day.slice(0, 7), closedMonths, "holidays");
}
