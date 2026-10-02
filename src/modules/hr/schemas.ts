import {
  AdvanceStatus,
  AttendanceStatus,
  EmployeeStatus,
  LeaveStatus,
  PaymentMethod,
} from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";

const id = z.string().min(1);
const money = z.number().min(0).max(1_000_000_000).multipleOf(0.01);
const positiveMoney = money.refine((v) => v > 0, "Must be more than zero");
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const reason = z.string().trim().min(5).max(500);
const take = z.coerce.number().int().min(1).max(200).optional();
/** A calendar day in company time, e.g. "2026-10-05". */
const day = z.iso.date();
/** A calendar day ("2026-02-28", in company time) or an exact timestamp. */
const dayOrInstant = z.union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })]);
/** 24-hour wall-clock time in company time, e.g. "09:30". */
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time like 09:30");
/** A calendar month, e.g. "2026-10". */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-10")
  .refine((m) => m >= "2000-01" && m <= "2100-12", "Choose a month between 2000 and 2100");
const year = z.coerce.number().int().min(2000).max(2100);

// --- Settings, holidays and leave types ----------------------------------------------

export const hrSettingsSchema = z
  .object({
    /** Weekly days off: 0 = Sunday ... 6 = Saturday (Friday = 5). */
    weeklyOffDays: z
      .array(z.number().int().min(0).max(6))
      .max(6, "Keep at least one working day in the week")
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    /** Check-ins after this time plus the grace minutes are late. */
    officeStartTime: clock,
    lateGraceMinutes: z.number().int().min(0).max(240),
    /** Every this many lates in a month cost one day's salary; 0 = lates cost nothing. */
    latesPerDeductionDay: z.number().int().min(0).max(31),
    /** Employees may check in and out from the portal. */
    selfCheckIn: z.boolean(),
  })
  .partial();

const holiday = z.object({ date: day, name: z.string().trim().min(2).max(120) });

/** One holiday, or a list (e.g. the year's public holidays) as `{ holidays: [...] }`. */
export const createHolidaysSchema = z.union([
  holiday.transform((h) => [h]),
  z.object({ holidays: z.array(holiday).min(1).max(60) }).transform((v) => v.holidays),
]);

export const listHolidaysSchema = z.object({ year: year.optional() });

const leaveTypeFields = {
  name: z.string().trim().min(2).max(60),
  daysPerYear: z.number().int().min(0).max(366),
  /** Unpaid leave is deducted from the salary and has no yearly limit. */
  isPaid: z.boolean(),
  /** People who join (or leave) during the year get a share for the months they work. */
  prorate: z.boolean(),
};

export const createLeaveTypeSchema = z.object({
  ...leaveTypeFields,
  isPaid: z.boolean().default(true),
  prorate: z.boolean().default(true),
});

export const updateLeaveTypeSchema = z
  .object({ ...leaveTypeFields, isActive: z.boolean() })
  .partial();

// --- Employees -------------------------------------------------------------------------

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

const employeeFields = {
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9/_-]+$/, "Use letters, numbers, dashes or slashes"),
  name: z.string().trim().min(2).max(120),
  designation: optionalText(80),
  department: optionalText(80),
  phone: optionalText(30),
  whatsapp: optionalText(30),
  email: z.email().nullish(),
  nid: optionalText(30),
  address: optionalText(300),
  photoUrl: optionalText(500),
  dateOfBirth: day.nullish(),
  bloodGroup: z.enum(BLOOD_GROUPS).nullish(),
  emergencyContact: optionalText(160),
  notes: optionalText(1000),
  /** Paid per overtime hour; no overtime pay when empty. */
  overtimeRate: money.nullish(),
  /** How the salary is usually paid (cash, bank transfer, bKash...). */
  salaryMethod: z.enum(PaymentMethod),
  bankName: optionalText(120),
  bankAccountNumber: optionalText(40),
  walletNumber: optionalText(30),
};

export const createEmployeeSchema = z.object({
  ...employeeFields,
  /** The next EMP-0001 style code when left out. */
  code: employeeFields.code.optional(),
  joinDate: day,
  /** Monthly gross salary from the joining day. */
  salary: money,
  salaryMethod: z.enum(PaymentMethod).default("CASH"),
});

/** Salary changes go through a revision (with an effective day), not here. */
export const updateEmployeeSchema = z
  .object({
    ...employeeFields,
    joinDate: day,
    /** ON_LEAVE is a note for long leave; the person stays on the payroll. */
    status: z.enum(["ACTIVE", "ON_LEAVE"]),
  })
  .partial();

export const salaryRevisionSchema = z.object({
  /** The new monthly gross salary. */
  amount: money,
  effectiveFrom: day,
  reason: optionalText(300),
});

export const exitEmployeeSchema = z.object({
  /** The last working day (paid up to and including it). */
  exitDate: day,
  status: z.enum(["RESIGNED", "TERMINATED"]),
  reason: optionalText(300),
});

export const listEmployeesSchema = z.object({
  status: z.enum(EmployeeStatus).optional(),
  /** true (default): people working now; false: everyone, including those who left. */
  current: queryBoolean.optional(),
  department: z.string().trim().max(80).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  take,
});

export const directorySchema = z.object({
  search: z.string().trim().max(100).optional(),
  /** Include people who have left (for old conveyance forms). */
  includeFormer: queryBoolean.optional(),
});

/** Link an existing company user, or create a login with the Employee role. */
export const portalAccessSchema = z
  .object({
    userId: id.optional(),
    email: z.email().optional(),
    phone: z.string().trim().max(30).optional(),
  })
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), {
    message: "Give either an existing user or an email for a new login",
    path: ["email"],
  });

export const statementSchema = z.object({
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
});

// --- Attendance --------------------------------------------------------------------------

export const attendanceEntrySchema = z.object({
  employeeId: id,
  status: z.enum(AttendanceStatus),
  /** Office times in company time, e.g. "09:12". */
  checkIn: clock.nullish(),
  checkOut: clock.nullish(),
  overtimeMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(0),
  note: optionalText(300),
});

/** Marks (or re-marks) a day for several employees; each row replaces that day's record. */
export const markAttendanceSchema = z
  .object({ date: day, entries: z.array(attendanceEntrySchema).min(1).max(500) })
  .refine((v) => new Set(v.entries.map((e) => e.employeeId)).size === v.entries.length, {
    message: "Each employee appears once",
    path: ["entries"],
  });

export const attendanceDaySchema = z.object({ date: day.optional() });

export const attendanceMonthSchema = z.object({
  month: monthSchema.optional(),
  employeeId: id.optional(),
});

export const checkInSchema = z.object({ note: optionalText(300) });

// --- Leave ---------------------------------------------------------------------------------

const leaveFields = {
  leaveTypeId: id,
  startDate: day,
  /** Default: the start date (a single day). */
  endDate: day.optional(),
  /** Half a day; only for a single date. */
  halfDay: z.boolean().default(false),
  reason: optionalText(500),
  /** An uploaded file, e.g. a doctor's note. */
  attachmentId: id.nullish(),
};

function checkLeaveDates(
  v: { startDate: string; endDate?: string; halfDay: boolean },
  ctx: z.RefinementCtx,
) {
  const end = v.endDate ?? v.startDate;
  if (end < v.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "Ends before it starts" });
  }
  if (v.halfDay && end !== v.startDate) {
    ctx.addIssue({ code: "custom", path: ["halfDay"], message: "A half day is a single date" });
  }
  if (end.slice(0, 4) !== v.startDate.slice(0, 4)) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "Split leave that crosses into a new year into two requests",
    });
  }
}

/** An employee asks for leave from the portal. */
export const requestLeaveSchema = z.object(leaveFields).superRefine(checkLeaveDates);

/** HR records leave for an employee; `approve` approves it at once. */
export const createLeaveSchema = z
  .object({ ...leaveFields, employeeId: id, approve: z.boolean().default(false) })
  .superRefine(checkLeaveDates);

export const approveLeaveSchema = z.object({ note: optionalText(300) });
export const rejectLeaveSchema = z.object({ note: z.string().trim().min(3).max(300) });
export const cancelLeaveSchema = z.object({ note: optionalText(300) });

export const listLeaveSchema = z.object({
  status: z.enum(LeaveStatus).optional(),
  employeeId: id.optional(),
  leaveTypeId: id.optional(),
  /** Leave touching this period. */
  from: day.optional(),
  to: day.optional(),
  cursor: z.string().optional(),
  take,
});

export const leaveBalancesSchema = z.object({
  employeeId: id.optional(),
  year: year.optional(),
});

export const adjustLeaveBalanceSchema = z.object({
  employeeId: id,
  leaveTypeId: id,
  year: z.number().int().min(2000).max(2100),
  /** Days allowed that year (halves allowed); null goes back to the default. */
  entitled: z.number().min(0).max(366).multipleOf(0.5).nullable(),
  note: optionalText(200),
});

// --- Salary advances -------------------------------------------------------------------------

export const giveAdvanceSchema = z.object({
  employeeId: id,
  amount: positiveMoney,
  /** When it was handed over; default: now. */
  date: dayOrInstant.optional(),
  method: z.enum(PaymentMethod).default("CASH"),
  /** Cash / bank / wallet ledger account; defaults by method. */
  accountId: id.optional(),
  reference: optionalText(120),
  purpose: optionalText(300),
  /** Recovered from each salary; empty = all at the next payroll. */
  installmentAmount: positiveMoney.nullish(),
  /** First payroll month to recover in (default: the month it is given), e.g. "2026-11". */
  recoverFrom: monthSchema.nullish(),
  /** Owed from before the ERP: no money moves now (posted against Opening Balance Equity). */
  isOpening: z.boolean().default(false),
});

export const updateAdvanceSchema = z
  .object({
    purpose: optionalText(300),
    installmentAmount: positiveMoney.nullable(),
    recoverFrom: monthSchema.nullable(),
  })
  .partial();

export const advanceReturnSchema = z.object({
  amount: positiveMoney,
  date: dayOrInstant.optional(),
  method: z.enum(PaymentMethod).default("CASH"),
  accountId: id.optional(),
  reference: optionalText(120),
  note: optionalText(300),
});

export const listAdvancesSchema = z.object({
  employeeId: id.optional(),
  status: z.enum(AdvanceStatus).optional(),
  cursor: z.string().optional(),
  take,
});

export const voidSchema = z.object({ reason });

// --- Payroll ---------------------------------------------------------------------------------

export const createPayrollSchema = z.object({
  month: monthSchema,
  notes: optionalText(500),
});

export const listPayrollSchema = z.object({ year: year.optional() });

export const updatePayrollItemSchema = z
  .object({
    allowances: money,
    bonus: money,
    taxDeduction: money,
    otherDeductions: money,
    /** Hours paid as overtime; null goes back to the hours in attendance. */
    overtimeHours: z.number().min(0).max(744).multipleOf(0.01).nullable(),
    /** Recovered from advances this month; null goes back to the scheduled recovery. */
    advanceDeduction: money.nullable(),
    note: optionalText(300),
  })
  .partial();

/** Bonus for everyone (or the listed employees): a % of monthly salary or a fixed amount. */
export const payrollBonusSchema = z
  .object({
    percentOfSalary: z.number().min(0).max(500).multipleOf(0.01).optional(),
    amount: money.optional(),
    employeeIds: z.array(id).min(1).max(1000).optional(),
  })
  .refine((v) => (v.percentOfSalary === undefined) !== (v.amount === undefined), {
    message: "Give either a percentage of salary or an amount",
    path: ["amount"],
  });

export const payPayrollSchema = z.object({
  /** Employees' payroll lines to pay; default: everyone not yet paid. */
  itemIds: z.array(id).min(1).max(1000).optional(),
  method: z.enum(PaymentMethod).default("CASH"),
  /** Cash / bank / wallet ledger account; defaults by method. */
  accountId: id.optional(),
  date: dayOrInstant.optional(),
  reference: optionalText(120),
});

export const reopenPayrollSchema = z.object({ reason });
