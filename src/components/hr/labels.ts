import type {
  AdvanceSettlementKind,
  AdvanceStatus,
  AttendanceStatus,
  EmployeeStatus,
  LeaveStatus,
  PaymentMethod,
  PayrollStatus,
} from "@prisma/client";

import { money } from "@/components/sales/labels";
import { formatDay, formatMonth } from "@/lib/display";

/*
 * Words and addresses the HR & payroll and My HR screens share, for the server
 * and the browser alike.
 */

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: "Working",
  ON_LEAVE: "On long leave",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
};

export const EMPLOYEE_STATUSES: readonly EmployeeStatus[] = [
  "ACTIVE",
  "ON_LEAVE",
  "RESIGNED",
  "TERMINATED",
];

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "Waiting",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const LEAVE_STATUSES: readonly LeaveStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved, to pay",
  PAID: "Paid",
};

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  OPEN: "Open",
  SETTLED: "Settled",
  VOID: "Void",
};

export const ADVANCE_STATUSES: readonly AdvanceStatus[] = ["OPEN", "SETTLED", "VOID"];

export const MARK_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  HALF_DAY: "Half day",
  ABSENT: "Absent",
};

export const SETTLEMENT_LABELS: Record<AdvanceSettlementKind, string> = {
  PAYROLL: "Taken from salary",
  EXPENSE: "Spent on a company expense",
  CASH_RETURN: "Returned in cash",
};

export const DAY_TYPE_LABELS = {
  WORKING: "Working day",
  WEEKLY_OFF: "Weekly day off",
  HOLIDAY: "Holiday",
} as const;

/** Sunday first, as the company's weekly days off are stored (0 = Sunday). */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The ways a salary is usually paid. */
export const SALARY_METHODS: readonly PaymentMethod[] = [
  "CASH",
  "BANK_TRANSFER",
  "BKASH",
  "NAGAD",
  "ROCKET",
  "CHEQUE",
];

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

/** "1 day", "half a day", "2.5 days". */
export function dayCount(n: number): string {
  if (n === 0.5) return "half a day";
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** "45 min", "2 h", "1 h 30 min". */
export function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "3 Oct 2026" or "3 to 5 Oct 2026" for leave, with "(half day)". */
export function leaveDates(l: { startDate: string; endDate: string; halfDay: boolean }): string {
  if (l.startDate === l.endDate) return `${formatDay(l.startDate)}${l.halfDay ? ", half day" : ""}`;
  return `${formatDay(l.startDate)} to ${formatDay(l.endDate)}`;
}

/** The month before or after "2026-10". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Who the salary goes to: "bKash 01711-000000", "Dutch-Bangla Bank 123…", "Cash". */
export function payDetails(p: {
  salaryMethod: PaymentMethod;
  bankName: string | null;
  bankAccountNumber: string | null;
  walletNumber: string | null;
}): string | null {
  if (p.salaryMethod === "BANK_TRANSFER" || p.salaryMethod === "CHEQUE") {
    return [p.bankName, p.bankAccountNumber].filter(Boolean).join(" · ") || null;
  }
  if (p.salaryMethod === "BKASH" || p.salaryMethod === "NAGAD" || p.salaryMethod === "ROCKET") {
    return p.walletNumber;
  }
  return null;
}

const enc = encodeURIComponent;
const withQuery = (path: string, params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return query ? `${path}?${query}` : path;
};

export const hrHref = {
  overview: "/hr",
  employees: "/hr/employees",
  employee: (id: string, year?: number) =>
    withQuery(`/hr/employees/${enc(id)}`, { year: year ? String(year) : undefined }),
  newEmployee: "/hr/employees/new",
  editEmployee: (id: string) => `/hr/employees/${enc(id)}/edit`,
  employeeMonth: (id: string, month?: string) =>
    withQuery(`/hr/employees/${enc(id)}/attendance`, { month }),
  statement: (id: string) => `/hr/employees/${enc(id)}/statement`,
  attendance: (date?: string) => withQuery("/hr/attendance", { date }),
  attendanceMonth: (month?: string) => withQuery("/hr/attendance/month", { month }),
  leave: "/hr/leave",
  leaveRequest: (id: string) => `/hr/leave/${enc(id)}`,
  newLeave: (employee?: string) => withQuery("/hr/leave/new", { employee }),
  employeeLeave: (employee: string) => withQuery("/hr/leave", { employee }),
  payroll: "/hr/payroll",
  payrollRun: (id: string) => `/hr/payroll/${enc(id)}`,
  payslip: (runId: string, itemId: string) => `/hr/payroll/${enc(runId)}/payslips/${enc(itemId)}`,
  advances: "/hr/advances",
  advance: (id: string) => `/hr/advances/${enc(id)}`,
  newAdvance: (employee?: string) => withQuery("/hr/advances/new", { employee }),
  employeeAdvances: (employee: string) => withQuery("/hr/advances", { employee }),
  settings: (year?: number) => withQuery("/hr/settings", { year: year ? String(year) : undefined }),
  journal: (id: string) => `/accounts/journal/${enc(id)}`,
  expense: (id: string) => `/accounts/expenses/${enc(id)}`,
  file: (id: string) => `/api/files/${enc(id)}`,
  me: "/me",
  myMonth: (month?: string) => withQuery("/me/attendance", { month }),
  myLeave: (year?: number) => withQuery("/me/leave", { year: year ? String(year) : undefined }),
  myPayslips: "/me/payslips",
  myPayslip: (itemId: string) => `/me/payslips/${enc(itemId)}`,
  myAdvances: "/me/advances",
};

/** A short fingerprint of a day's marks: the register starts again when the saved marks change. */
export function marksVersion(
  rows: ReadonlyArray<{
    employee: { id: string };
    mark: {
      id: string;
      status: string;
      checkIn: string | null;
      checkOut: string | null;
      overtimeMinutes: number;
      note: string | null;
    } | null;
  }>,
): string {
  const text = rows
    .map((r) =>
      r.mark
        ? [
            r.mark.id,
            r.mark.status,
            r.mark.checkIn,
            r.mark.checkOut,
            r.mark.overtimeMinutes,
            r.mark.note,
          ].join(":")
        : "-",
    )
    .join("|");
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return `${rows.length}-${(hash >>> 0).toString(36)}`;
}

/** "BDT 2,000.00 a month from Nov 2026" or "All at the Nov 2026 payroll". */
export function recoveryText(
  a: { installmentAmount: string | null; recoverFrom: string },
  currency: string,
) {
  return a.installmentAmount
    ? `${money(a.installmentAmount, currency)} a month from ${formatMonth(a.recoverFrom)}`
    : `All at the ${formatMonth(a.recoverFrom)} payroll`;
}

/** "Friday", "Friday and Saturday", "None". */
export function offDaysText(days: readonly number[]) {
  const names = days.map((d) => WEEKDAYS[d] ?? String(d));
  if (names.length === 0) return "None";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "14 days a year, shared out by the months worked" or "Unpaid, taken off the salary". */
export function leaveTypeText(t: { isPaid: boolean; daysPerYear: number; prorate: boolean }) {
  if (!t.isPaid) return "Unpaid, taken off the salary";
  return `${dayCount(t.daysPerYear)} a year${t.prorate ? ", shared out by the months worked" : ""}`;
}
