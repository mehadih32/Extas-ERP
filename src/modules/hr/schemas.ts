import {
  AdvanceStatus,
  AssetKind,
  AssetReturn,
  AttendanceStatus,
  EmployeeDocumentKind,
  EmployeeStatus,
  LeaveStatus,
  OvertimeStatus,
  PaymentMethod,
  StaffClaimKind,
  StaffClaimStatus,
} from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";
import { DEFAULT_RADIUS_METRES, isLatLng, RADIUS_LIMITS } from "@/modules/hr/geo";
import { MAX_OVERTIME_MINUTES } from "@/modules/hr/overtime";
import { TERMS_LIMITS } from "@/modules/hr/terms";

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
    /** Location at check-in and check-out, and pings while checked in. */
    gpsAttendance: z.boolean(),
    /** Staying later than this is overtime (shadow overtime). */
    officeEndTime: clock,
    /** The app finds overtime from self check-outs for HR to approve. */
    shadowOvertime: z.boolean(),
    /** Stays shorter than this many minutes are not overtime. */
    overtimeMinMinutes: z.number().int().min(0).max(240),
    /** The usual conveyance fare for a km (claims well above it are flagged); 0 = no check. */
    conveyanceRatePerKm: money.max(100_000),
  })
  .partial()
  .refine(
    (s) =>
      s.officeStartTime === undefined ||
      s.officeEndTime === undefined ||
      s.officeStartTime !== s.officeEndTime,
    { message: "The day must end at a different time than it starts.", path: ["officeEndTime"] },
  );

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
  bankBranch: optionalText(120),
  bankAccountNumber: optionalText(40),
  walletNumber: optionalText(30),
  /** Someone who knows them and can vouch for them. */
  referenceName: optionalText(120),
  referencePhone: optionalText(30),
  referenceRelation: optionalText(60),
  /** The work place they check in at (GPS attendance); none for no fixed place. */
  workLocationId: id.nullish(),
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
  /** Only people with something missing from their data vault (hr/vault.ts). */
  incomplete: queryBoolean.optional(),
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
    /** The role the login works in (company.members.manage); the Employee role when left out. */
    roleId: id.optional(),
  })
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), {
    message: "Give either an existing user or an email for a new login",
    path: ["email"],
  });

/** The System access card: the login's role, or switching it off or on (company.members.manage). */
export const loginChangeSchema = z
  .object({ roleId: id.optional(), active: z.boolean().optional() })
  .refine((v) => (v.roleId === undefined) !== (v.active === undefined), {
    message: "Change either the role or whether the login is on",
    path: ["roleId"],
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

// --- GPS attendance ----------------------------------------------------------------------

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/** Where the phone is, from its GPS, with how sure it is (metres). */
export const positionSchema = z
  .object({
    lat: latitude,
    lng: longitude,
    accuracy: z.number().min(0).max(100_000).nullish(),
  })
  .refine(isLatLng, "The phone did not give a usable position. Try again.");

/** Checking in or out; with GPS attendance on, where the phone is. */
export const checkInSchema = z.object({
  note: optionalText(300),
  position: positionSchema.nullish(),
  /** My HR in a browser, or the Android app. */
  source: z.enum(["WEB", "ANDROID"]).default("WEB"),
});

/**
 * On-duty positions from the phone, sent in batches: from My HR in the
 * browser ("WEB") or the Android app's background service ("ANDROID"). Times
 * are when the phone took each position (milliseconds since 1970, or ISO).
 */
export const locationPingsSchema = z.object({
  source: z.enum(["WEB", "ANDROID"]).default("WEB"),
  points: z
    .array(
      z.object({
        at: z
          .union([z.number().int().positive(), z.iso.datetime({ offset: true })])
          .transform((v) => new Date(v)),
        lat: latitude,
        lng: longitude,
        accuracy: z.number().min(0).max(100_000).nullish(),
        speed: z.number().min(0).max(300).nullish(),
        battery: z.number().int().min(0).max(100).nullish(),
      }),
    )
    .min(1)
    .max(300),
});

/** A place staff check in at, with the radius that counts as being there. */
export const workPlaceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  address: optionalText(200),
  lat: latitude,
  lng: longitude,
  radiusMeters: z
    .number()
    .int()
    .min(RADIUS_LIMITS.min, `At least ${RADIUS_LIMITS.min} m`)
    .max(RADIUS_LIMITS.max, `At most ${RADIUS_LIMITS.max} m`)
    .default(DEFAULT_RADIUS_METRES),
});

export const updateWorkPlaceSchema = workPlaceSchema
  .extend({ radiusMeters: workPlaceSchema.shape.radiusMeters.unwrap() })
  .partial();

export const staffMapQuery = z.object({ person: id.max(40).optional() });

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

export const payPayrollSchema = z
  .object({
    /** Employees' payroll lines to pay in full (what is left of each); default: everyone not yet paid. */
    itemIds: z.array(id).min(1).max(1000).optional(),
    /** Or amounts to pay on chosen lines: a part of a salary, or the rest of it. */
    parts: z
      .array(z.object({ itemId: id, amount: positiveMoney }))
      .min(1)
      .max(1000)
      .optional(),
    method: z.enum(PaymentMethod).default("CASH"),
    /** Cash / bank / wallet ledger account; defaults by method. */
    accountId: id.optional(),
    date: dayOrInstant.optional(),
    reference: optionalText(120),
    /** Paid by bKash, Nagad or Rocket: also send each amount to the wallet (payout plug). */
    sendToWallets: z.boolean().optional(),
  })
  .refine((v) => !(v.itemIds && v.parts), {
    message: "Choose lines or amounts, not both.",
    path: ["parts"],
  });

/** Wallet payouts that failed, to send again. */
export const retryPayoutsSchema = z.object({ lineIds: z.array(id).min(1).max(1000).optional() });

export const reopenPayrollSchema = z.object({ reason });

// --- Data vault (the employee's own details, pay detail changes, papers) ------------------

/** The ways a salary is paid that an employee can ask for. */
export const SALARY_METHOD_CHOICES = [
  "CASH",
  "BANK_TRANSFER",
  "CHEQUE",
  "BKASH",
  "NAGAD",
  "ROCKET",
] as const;

const WALLETS = new Set(["BKASH", "NAGAD", "ROCKET"]);
const BANKS = new Set(["BANK_TRANSFER", "CHEQUE"]);

/** "01711-000000" or "+8801711000000" → "01711000000"; anything else stays as typed. */
const walletDigits = (value: string) => {
  const digits = value.replace(/[\s()-]/g, "").replace(/^\+/, "");
  return digits.startsWith("880") ? `0${digits.slice(3)}` : digits;
};

/**
 * An employee's ask to be paid another way or to another account. Only the
 * details the way of paying needs are kept: a bank and account number for a bank
 * transfer or cheque, a wallet number for bKash, Nagad or Rocket, none for cash.
 */
export const payDetailsRequestSchema = z
  .object({
    salaryMethod: z.enum(SALARY_METHOD_CHOICES),
    bankName: optionalText(120),
    bankBranch: optionalText(120),
    bankAccountNumber: optionalText(40),
    walletNumber: optionalText(30),
    /** Why, for HR. */
    note: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (BANKS.has(v.salaryMethod)) {
      if (!v.bankName)
        ctx.addIssue({ code: "custom", path: ["bankName"], message: "Enter the bank's name." });
      if (!v.bankAccountNumber) {
        ctx.addIssue({
          code: "custom",
          path: ["bankAccountNumber"],
          message: "Enter the account number.",
        });
      } else if (!/^[0-9][0-9 -]{4,38}[0-9]$/.test(v.bankAccountNumber)) {
        ctx.addIssue({
          code: "custom",
          path: ["bankAccountNumber"],
          message: "Use the account number's digits (dashes and spaces are fine).",
        });
      }
    }
    if (WALLETS.has(v.salaryMethod)) {
      if (!v.walletNumber) {
        ctx.addIssue({
          code: "custom",
          path: ["walletNumber"],
          message: "Enter the wallet number.",
        });
      } else if (!/^01[3-9]\d{8}$/.test(walletDigits(v.walletNumber))) {
        ctx.addIssue({
          code: "custom",
          path: ["walletNumber"],
          message: "Enter an 11-digit mobile number, like 01711-000000.",
        });
      }
    }
  })
  .transform((v) => {
    const bank = BANKS.has(v.salaryMethod);
    const wallet = WALLETS.has(v.salaryMethod);
    return {
      changes: {
        salaryMethod: v.salaryMethod as PaymentMethod,
        bankName: bank ? (v.bankName ?? null) : null,
        bankBranch: bank ? v.bankBranch || null : null,
        bankAccountNumber: bank ? (v.bankAccountNumber ?? null) : null,
        walletNumber: wallet && v.walletNumber ? walletDigits(v.walletNumber) : null,
      },
      note: v.note || null,
    };
  });

/** A phone number someone can be called on: 6 to 15 digits, with +, spaces or dashes. */
const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === "" || /^\+?[\d\s()-]+$/.test(v), "Use digits, like 01711-000000")
  .refine((v) => {
    const n = v.replace(/\D/g, "").length;
    return v === "" || (n >= 6 && n <= 15);
  }, "Enter the whole number, like 01711-000000")
  .nullish();

/**
 * What employees fill in themselves in My HR. Who they are (national ID, date of
 * birth, blood group) is filled once: after that HR changes it. Contacts and the
 * reference person they keep up to date.
 */
export const myDetailsSchema = z
  .object({
    nid: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s-]/g, ""))
      .refine(
        (v) => v === "" || /^(\d{10}|\d{13}|\d{17})$/.test(v),
        "A national ID has 10, 13 or 17 digits",
      )
      .nullish(),
    dateOfBirth: day.nullish(),
    bloodGroup: z.enum(BLOOD_GROUPS).nullish(),
    whatsapp: phone,
    email: z.email().nullish(),
    address: optionalText(300),
    emergencyContact: optionalText(160),
    referenceName: optionalText(120),
    referencePhone: phone,
    referenceRelation: optionalText(60),
  })
  .partial()
  .transform(
    (v) =>
      Object.fromEntries(
        Object.entries(v).map(([key, value]) => [key, value === "" ? null : value]),
      ) as { [K in keyof typeof v]: Exclude<(typeof v)[K], ""> },
  );

export const decidePayRequestSchema = z.object({ note: optionalText(300) });
export const rejectPayRequestSchema = z.object({ reason });

export const listPayRequestsSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]).optional(),
  employeeId: id.optional(),
  take,
});

/** A paper for the vault; the file itself comes with the upload. */
export const employeeDocumentSchema = z.object({
  // Signed terms and the clearance certificate are made by the app itself, never by hand.
  kind: z.enum(EmployeeDocumentKind).exclude(["TERMS", "CLEARANCE"]),
  title: optionalText(120),
});

// --- Terms of employment (terms.service.ts) ----------------------------------

const termsSection = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the section a heading.")
    .max(TERMS_LIMITS.sectionTitle, "Keep the heading shorter."),
  body: z
    .string()
    .trim()
    .min(1, "Write the section's text.")
    .max(TERMS_LIMITS.sectionBody, "This section is too long; split it in two."),
});

/** The draft HR edits before publishing it. */
export const termsDraftSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the terms a title.")
    .max(TERMS_LIMITS.title, "Keep the title shorter."),
  intro: optionalText(TERMS_LIMITS.intro),
  sections: z
    .array(termsSection)
    .min(1, "Add at least one section.")
    .max(TERMS_LIMITS.sections, `Up to ${TERMS_LIMITS.sections} sections.`),
});

/** Publishing: whether everyone agrees again, or only staff who never agreed. */
export const publishTermsSchema = z.object({ askEveryone: z.boolean().default(true) });

/** Agreeing to a version: a signature drawn on the screen (a PNG), or the SMS code. */
export const agreeToTermsSchema = z.discriminatedUnion("method", [
  z.object({
    versionId: id,
    method: z.literal("SIGNATURE"),
    /** data:image/png;base64,... as the browser's canvas gives it. */
    signature: z
      .string()
      .min(1, "Sign in the box first.")
      .max(700_000, "The signature is too big."),
  }),
  z.object({
    versionId: id,
    method: z.literal("SMS_CODE"),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code from the SMS."),
  }),
]);

// --- Shadow overtime ------------------------------------------------------------------------

/** The overtime ledger: a month (default this month), optionally one status or person. */
export const overtimeLedgerSchema = z.object({
  month: monthSchema.optional(),
  status: z.enum(OvertimeStatus).optional(),
  employeeId: id.optional(),
});

/**
 * HR's decision on overtime the app found: approve it (as found, or other
 * minutes with a reason), or reject it with a reason.
 */
export const decideOvertimeSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("APPROVE"),
    /** Minutes to pay; left out, the minutes found. */
    minutes: z
      .number()
      .int("Overtime is in whole minutes.")
      .min(1, "Approve at least 1 minute, or reject it.")
      .max(MAX_OVERTIME_MINUTES, "That is more than 16 hours.")
      .optional(),
    reason: optionalText(300),
  }),
  z.object({ decision: z.literal("REJECT"), reason }),
]);

/** Approves a month's waiting overtime as found, except entries that need a look. */
export const approveAllOvertimeSchema = z.object({ month: monthSchema });

// --- Staff claims (conveyance, local material) ----------------------------------------------

const place = z.string().trim().min(2, "Write the place.").max(160);

/**
 * A claim from My HR: a trip (date, from, to, what for, the fare) or local
 * material bought for a production project (what, how much, where, the price).
 * The date is the day of the trip or purchase, not after today.
 */
export const submitClaimSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CONVEYANCE"),
    date: day,
    amount: positiveMoney,
    fromPlace: place,
    toPlace: place,
    purpose: z.string().trim().min(3, "Say what the trip was for.").max(300),
    receiptFileId: id.nullish(),
  }),
  z.object({
    kind: z.literal("LOCAL_MATERIAL"),
    date: day,
    amount: positiveMoney,
    projectId: id,
    item: z.string().trim().min(2, "Write what you bought.").max(160),
    quantity: optionalText(80),
    shop: optionalText(160),
    purpose: optionalText(300),
    receiptFileId: id.nullish(),
  }),
]);

/** The claims ledger: a month (default this month), optionally one status, kind or person. */
export const claimsLedgerSchema = z.object({
  month: monthSchema.optional(),
  status: z.enum(StaffClaimStatus).optional(),
  kind: z.enum(StaffClaimKind).optional(),
  employeeId: id.optional(),
  /** Opens the month this claim is in (a link from the inbox). */
  claim: id.optional(),
});

/**
 * Accounts' decision on a claim: approve it (the amount claimed, or less with
 * a reason; local material under a production cost head), or reject it with a
 * reason.
 */
export const decideClaimSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("APPROVE"),
    /** Left out, the amount claimed. */
    amount: positiveMoney.optional(),
    reason: optionalText(300),
    /** Local material: the project's cost head; left out, "Local Materials". */
    costHeadId: id.optional(),
  }),
  z.object({ decision: z.literal("REJECT"), reason }),
]);

/** Approves a month's waiting claims that have no flag, as claimed. */
export const approveAllClaimsSchema = z.object({ month: monthSchema });

/** Accounts pays an employee back everything approved and still owed to them. */
export const payBackClaimsSchema = z.object({
  employeeId: id,
  method: z.enum(PaymentMethod).default("CASH"),
  /** Cash / bank / wallet account; defaults by method. */
  accountId: id.optional(),
  reference: optionalText(120),
  /** When it was paid; default: now. */
  date: dayOrInstant.optional(),
});

// --- Notice board -----------------------------------------------------------------------------

export const NOTICE_LIMITS = { title: 150, body: 5000 } as const;

/** A notice HR posts for every employee; it shows until its last day, if one is set. */
export const postNoticeSchema = z.object({
  title: z.string().trim().min(1, "Write a title").max(NOTICE_LIMITS.title),
  body: z.string().trim().min(1, "Write the notice").max(NOTICE_LIMITS.body),
  pinned: z.boolean().default(false),
  showUntil: day.nullish(),
});

export const updateNoticeSchema = z.object({
  title: z.string().trim().min(1, "Write a title").max(NOTICE_LIMITS.title).optional(),
  body: z.string().trim().min(1, "Write the notice").max(NOTICE_LIMITS.body).optional(),
  pinned: z.boolean().optional(),
  showUntil: day.nullish(),
});

export const NOTICE_SHOWS = ["current", "ended", "all"] as const;

/** HR's list: notices staff see now, ended or taken down, or all. */
export const listNoticesSchema = z.object({
  show: z.enum(NOTICE_SHOWS).catch("current").default("current"),
});

/** The notices on the employee's screen, to mark as read. */
export const readNoticesSchema = z.object({ noticeIds: z.array(id).max(200) });

// --- Company items with staff, and leaving -----------------------------------------------------

export const ASSET_SHOWS = ["out", "returned", "all"] as const;

/** HR's list of company items: with staff now, back, or all; for one person or by name or tag. */
export const listAssetsSchema = z.object({
  show: z.enum(ASSET_SHOWS).catch("out").default("out"),
  employeeId: id.optional(),
  q: z.string().trim().max(80).optional(),
});

/** HR gives a company item to an employee. */
export const issueAssetSchema = z.object({
  employeeId: id,
  name: z.string().trim().min(2, "Write what it is").max(120),
  kind: z.enum(AssetKind).default("OTHER"),
  tag: optionalText(80),
  value: money.nullish(),
  issuedOn: day,
  note: optionalText(300),
});

/** The item came back: good, damaged or lost (the last two need a note). */
export const returnAssetSchema = z
  .object({
    returnedOn: day,
    condition: z.enum(AssetReturn),
    note: optionalText(300),
  })
  .refine((v) => v.condition === "GOOD" || (v.note?.trim().length ?? 0) >= 3, {
    message: "Say what happened",
    path: ["note"],
  });

/**
 * Deactivating someone in one go: their last working day (today or before),
 * why they left, and an optional note; the login goes off and the experience
 * and clearance certificate is made.
 */
export const deactivateEmployeeSchema = exitEmployeeSchema;
