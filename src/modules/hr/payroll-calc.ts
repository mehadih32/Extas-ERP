import { type AttendanceStatus, Prisma } from "@prisma/client";

import { money, ZERO } from "@/modules/accounts/balances";
import { dayType, type DayType, eachDay, type HrCalendar, monthRange } from "@/modules/hr/calendar";

/*
 * Monthly salary maths, kept pure so it can be tested day by day.
 *
 * Salary is a monthly gross amount. Each calendar day the person is employed
 * earns 1/(days in the month) of the salary in force that day, so a full month
 * earns exactly the monthly salary and joiners and leavers are paid for their
 * days. Weekly days off and holidays are paid. On a working day:
 *   - approved leave covers the whole day or half of it (paid or unpaid type);
 *   - attendance decides the rest: PRESENT / LATE count as present, HALF_DAY as
 *     half present, ABSENT as absent, and a day nobody marked counts as present;
 *   - whatever is neither leave nor present is absent.
 * Absent days and unpaid leave are deducted at the day's rate. When the company
 * sets "every N lates cost a day", each N lates add one more unpaid day.
 */

export type SalaryPoint = { effectiveFrom: string; amount: Prisma.Decimal };
export type LeaveSpan = { startDate: string; endDate: string; halfDay: boolean; isPaid: boolean };
export type AttendanceMark = { status: AttendanceStatus; overtimeMinutes: number };

export type EmploymentInput = {
  joinDate: string;
  exitDate: string | null;
  /** Salary revisions sorted by effective day (ties: the later one wins). */
  salaries: SalaryPoint[];
  /** Used only when there is no revision at all. */
  fallbackSalary: Prisma.Decimal;
  /** Attendance marks by day. */
  attendance: ReadonlyMap<string, AttendanceMark>;
  /** Approved leave. */
  leave: LeaveSpan[];
};

export type MonthRules = {
  calendar: HrCalendar;
  /** Every this many lates cost a day's salary; 0 = never. */
  latesPerDeductionDay: number;
};

export type DayEvaluation = {
  date: string;
  dayType: DayType;
  leave: { fraction: number; isPaid: boolean } | null;
  mark: AttendanceMark | null;
  /** Fractions of the day (0, 0.5 or 1); all zero on days off. */
  present: number;
  paidLeave: number;
  unpaidLeave: number;
  absent: number;
  late: boolean;
};

export type MonthFigures = {
  month: string;
  daysInMonth: number;
  employedFrom: string;
  employedTo: string;
  employedDays: number;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  lateDays: number;
  /** Extra unpaid days for lates (every N lates = 1 day). */
  latePenaltyDays: number;
  /** Absent + unpaid leave + late penalty days. */
  unpaidDays: number;
  overtimeMinutes: number;
  /** Monthly salary in force on the last day employed this month. */
  monthlySalary: Prisma.Decimal;
  dayRate: Prisma.Decimal;
  /** Salary earned for the days employed this month. */
  basic: Prisma.Decimal;
  /** Deducted for absent days, unpaid leave and lates. */
  unpaidDeduction: Prisma.Decimal;
  days: DayEvaluation[];
};

/** The monthly salary in force on `day`: the latest revision effective by then. */
export function salaryOn(
  salaries: SalaryPoint[],
  day: string,
  fallback: Prisma.Decimal,
): Prisma.Decimal {
  let found: SalaryPoint | undefined;
  for (const s of salaries) if (s.effectiveFrom <= day) found = s;
  // Days before the first revision (a join date moved earlier) use the joining salary.
  return (found ?? salaries[0])?.amount ?? fallback;
}

function leaveOn(leave: LeaveSpan[], day: string) {
  const span = leave.find((l) => l.startDate <= day && day <= l.endDate);
  return span ? { fraction: span.halfDay ? 0.5 : 1, isPaid: span.isPaid } : null;
}

/** How one day counts (see the rules at the top of this file). */
export function evaluateDay(rules: MonthRules, input: EmploymentInput, day: string): DayEvaluation {
  const type = dayType(rules.calendar, day);
  const mark = input.attendance.get(day) ?? null;
  const leave = leaveOn(input.leave, day);
  if (type !== "WORKING") {
    return {
      date: day,
      dayType: type,
      leave: null,
      mark,
      present: 0,
      paidLeave: 0,
      unpaidLeave: 0,
      absent: 0,
      late: false,
    };
  }
  const onLeave = leave?.fraction ?? 0;
  const marked =
    mark === null ? 1 : mark.status === "ABSENT" ? 0 : mark.status === "HALF_DAY" ? 0.5 : 1;
  const present = Math.min(marked, 1 - onLeave);
  return {
    date: day,
    dayType: type,
    leave,
    mark,
    present,
    paidLeave: leave?.isPaid ? onLeave : 0,
    unpaidLeave: leave && !leave.isPaid ? onLeave : 0,
    absent: 1 - onLeave - present,
    late: mark?.status === "LATE" && present > 0,
  };
}

/**
 * A month for one employee, or null when they were not employed in it.
 * Amounts are rounded to 2 decimals at the end, so a full month earns exactly
 * the monthly salary.
 */
export function evaluateMonth(
  month: string,
  rules: MonthRules,
  input: EmploymentInput,
): MonthFigures | null {
  const range = monthRange(month);
  const from = input.joinDate > range.from ? input.joinDate : range.from;
  const to = input.exitDate && input.exitDate < range.to ? input.exitDate : range.to;
  if (from > to) return null;

  const dim = new Prisma.Decimal(range.days);
  const byRate = new Map<string, { amount: Prisma.Decimal; employed: number; unpaid: number }>();
  const days: DayEvaluation[] = [];
  let workingDays = 0;
  let presentDays = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let absentDays = 0;
  let lateDays = 0;
  let overtimeMinutes = 0;

  for (const day of eachDay(from, to)) {
    const e = evaluateDay(rules, input, day);
    days.push(e);
    overtimeMinutes += e.mark?.overtimeMinutes ?? 0;
    const rate = salaryOn(input.salaries, day, input.fallbackSalary);
    const key = rate.toFixed(2);
    const bucket = byRate.get(key) ?? { amount: rate, employed: 0, unpaid: 0 };
    bucket.employed += 1;
    byRate.set(key, bucket);
    if (e.dayType !== "WORKING") continue;
    workingDays += 1;
    presentDays += e.present;
    paidLeaveDays += e.paidLeave;
    unpaidLeaveDays += e.unpaidLeave;
    absentDays += e.absent;
    if (e.late) lateDays += 1;
    bucket.unpaid += e.unpaidLeave + e.absent;
  }

  const latePenaltyDays =
    rules.latesPerDeductionDay > 0 ? Math.floor(lateDays / rules.latesPerDeductionDay) : 0;
  const monthlySalary = salaryOn(input.salaries, to, input.fallbackSalary);
  let earned = ZERO;
  let deducted = monthlySalary.times(latePenaltyDays).dividedBy(dim);
  for (const b of byRate.values()) {
    earned = earned.plus(b.amount.times(b.employed).dividedBy(dim));
    deducted = deducted.plus(b.amount.times(b.unpaid).dividedBy(dim));
  }
  const basic = money(earned);
  return {
    month,
    daysInMonth: range.days,
    employedFrom: from,
    employedTo: to,
    employedDays: days.length,
    workingDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    absentDays,
    lateDays,
    latePenaltyDays,
    unpaidDays: unpaidLeaveDays + absentDays + latePenaltyDays,
    overtimeMinutes,
    monthlySalary,
    dayRate: money(monthlySalary.dividedBy(dim)),
    basic,
    unpaidDeduction: Prisma.Decimal.min(money(deducted), basic),
    days,
  };
}

/** Overtime pay: hours x the hourly rate (no rate, no pay). */
export function overtimePay(hours: Prisma.Decimal.Value, rate: Prisma.Decimal | null) {
  return rate ? money(new Prisma.Decimal(hours).times(rate)) : ZERO;
}

/** Hours (2 decimals) from minutes. */
export function minutesToHours(minutes: number): Prisma.Decimal {
  return new Prisma.Decimal(minutes).dividedBy(60).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

type PayLine = {
  basic: Prisma.Decimal.Value;
  allowances: Prisma.Decimal.Value;
  overtime: Prisma.Decimal.Value;
  bonus: Prisma.Decimal.Value;
  unpaidLeaveDeduction: Prisma.Decimal.Value;
};

type Deductions = {
  advanceDeduction: Prisma.Decimal.Value;
  taxDeduction: Prisma.Decimal.Value;
  otherDeductions: Prisma.Decimal.Value;
};

/** Gross pay: salary for the days + allowances + overtime + bonus - unpaid days. */
export function grossPay(i: PayLine): Prisma.Decimal {
  return money(
    new Prisma.Decimal(i.basic)
      .plus(i.allowances)
      .plus(i.overtime)
      .plus(i.bonus)
      .minus(i.unpaidLeaveDeduction),
  );
}

/** Net pay: gross - advance recovery - tax - other deductions. */
export function netPay(i: PayLine & Deductions): Prisma.Decimal {
  return money(
    grossPay(i).minus(i.advanceDeduction).minus(i.taxDeduction).minus(i.otherDeductions),
  );
}

// =============================================================================
// Advance recovery
// =============================================================================

export type RecoverableAdvance = {
  id: string;
  /** The day it was given ("YYYY-MM-DD", company time). */
  givenDay: string;
  /** First payroll month it is recovered in ("YYYY-MM"). */
  recoverFromMonth: string;
  outstanding: Prisma.Decimal;
  /** Recovered per salary; null = everything at once. */
  installment: Prisma.Decimal | null;
};

/** Advances a month's salary can recover: given by the month's end, oldest first. */
export function recoverableIn(advances: RecoverableAdvance[], month: string) {
  const end = monthRange(month).to;
  return advances
    .filter((a) => a.givenDay <= end && a.outstanding.gt(0))
    .sort((a, b) => a.givenDay.localeCompare(b.givenDay) || a.id.localeCompare(b.id));
}

/** What an advance is due to give back this month (everything when the person leaves). */
function scheduledFor(a: RecoverableAdvance, month: string, leaving: boolean) {
  if (leaving) return a.outstanding;
  if (a.recoverFromMonth > month) return ZERO;
  return a.installment ? Prisma.Decimal.min(a.installment, a.outstanding) : a.outstanding;
}

/** The recovery the schedule asks for this month (before capping at the pay available). */
export function scheduledRecovery(
  advances: RecoverableAdvance[],
  month: string,
  leaving: boolean,
): Prisma.Decimal {
  return recoverableIn(advances, month).reduce(
    (t, a) => t.plus(scheduledFor(a, month, leaving)),
    ZERO,
  );
}

/** The most a month's salary can recover: everything still owed on advances given by then. */
export function maxRecovery(advances: RecoverableAdvance[], month: string): Prisma.Decimal {
  return recoverableIn(advances, month).reduce((t, a) => t.plus(a.outstanding), ZERO);
}

/**
 * Splits a month's recovery over the advances: each advance's scheduled amount
 * first (oldest first), then anything extra against the oldest balances.
 */
export function allocateRecovery(
  advances: RecoverableAdvance[],
  month: string,
  total: Prisma.Decimal,
  leaving: boolean,
): Array<{ advanceId: string; amount: Prisma.Decimal }> {
  const list = recoverableIn(advances, month);
  const taken = new Map<string, Prisma.Decimal>();
  let left = total;
  for (const pass of ["scheduled", "extra"] as const) {
    for (const a of list) {
      if (left.lte(0)) break;
      const already = taken.get(a.id) ?? ZERO;
      const room =
        pass === "scheduled"
          ? scheduledFor(a, month, leaving).minus(already)
          : a.outstanding.minus(already);
      const amount = Prisma.Decimal.min(room, left);
      if (amount.lte(0)) continue;
      taken.set(a.id, already.plus(amount));
      left = left.minus(amount);
    }
  }
  if (left.gt(0)) {
    throw new RangeError(`Recovery is ${left.toFixed(2)} more than the advances owed.`);
  }
  return [...taken].map(([advanceId, amount]) => ({ advanceId, amount }));
}
