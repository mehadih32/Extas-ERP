import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { amountInWords, numberInWords } from "@/lib/amount-words";
import { atLocalTime, dateColumn, dateOnly, localTime, weekday } from "@/lib/dates";
import {
  dayType,
  type HrCalendar,
  leaveDayCount,
  monthLabel,
  monthRange,
  monthsOf,
  toHalfDays,
} from "@/modules/hr/calendar";
import { defaultEntitlement } from "@/modules/hr/leave.service";
import {
  allocateRecovery,
  type EmploymentInput,
  evaluateMonth,
  grossPay,
  maxRecovery,
  minutesToHours,
  netPay,
  overtimePay,
  type RecoverableAdvance,
  salaryOn,
  scheduledRecovery,
} from "@/modules/hr/payroll-calc";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// September 2026: 30 days, starts on a Tuesday; Fridays are the 4th, 11th, 18th and 25th.
const SEP = "2026-09";

const calendar = (holidays: string[] = []): HrCalendar => ({
  weeklyOffDays: [5],
  holidays: new Set(holidays),
});

const rules = (latesPerDeductionDay = 0, holidays: string[] = []) => ({
  calendar: calendar(holidays),
  latesPerDeductionDay,
});

function person(over: Partial<EmploymentInput> = {}): EmploymentInput {
  return {
    joinDate: "2026-01-01",
    exitDate: null,
    salaries: [{ effectiveFrom: "2026-01-01", amount: D(30000) }],
    fallbackSalary: D(30000),
    attendance: new Map(),
    leave: [],
    ...over,
  };
}

const marks = (entries: Array<[string, "PRESENT" | "LATE" | "HALF_DAY" | "ABSENT", number?]>) =>
  new Map(
    entries.map(([day, status, overtimeMinutes]) => [
      day,
      { status, overtimeMinutes: overtimeMinutes ?? 0 },
    ]),
  );

describe("working calendar", () => {
  it("knows weekly days off, holidays and working days", () => {
    const cal = calendar(["2026-09-07"]);
    expect(weekday("2026-09-04")).toBe(5);
    expect(dayType(cal, "2026-09-04")).toBe("WEEKLY_OFF");
    expect(dayType(cal, "2026-09-07")).toBe("HOLIDAY");
    expect(dayType(cal, "2026-09-08")).toBe("WORKING");
  });

  it("counts leave in working days only", () => {
    const cal = calendar(["2026-09-07"]);
    // Thu 3, (Fri 4 off), Sat 5, Sun 6, (Mon 7 holiday), Tue 8.
    expect(
      leaveDayCount(cal, { startDate: "2026-09-03", endDate: "2026-09-08", halfDay: false }),
    ).toBe(4);
    expect(
      leaveDayCount(cal, { startDate: "2026-09-03", endDate: "2026-09-03", halfDay: true }),
    ).toBe(0.5);
    expect(
      leaveDayCount(cal, { startDate: "2026-09-04", endDate: "2026-09-04", halfDay: false }),
    ).toBe(0);
  });

  it("works with months", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28", days: 28 });
    expect(monthRange(SEP).days).toBe(30);
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthsOf("2026-09-20", "2026-11-02")).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect([toHalfDays(2.2), toHalfDays(2.3), toHalfDays(4.76)]).toEqual([2, 2.5, 5]);
  });

  it("reads and writes calendar days and office times in company time", () => {
    expect(dateOnly(dateColumn("2026-09-30"))).toBe("2026-09-30");
    expect(dateOnly(null)).toBeNull();
    const at = atLocalTime("2026-09-01", "09:30", "Asia/Dhaka");
    expect(at.toISOString()).toBe("2026-09-01T03:30:00.000Z");
    expect(localTime(at, "Asia/Dhaka")).toBe("09:30");
  });
});

describe("leave allowances", () => {
  const casual = { isPaid: true, prorate: true, daysPerYear: 10 };
  it("shares a yearly allowance out by the months worked", () => {
    const fullYear = { joinDate: dateColumn("2024-03-01"), exitDate: null };
    expect(defaultEntitlement(casual, fullYear, 2026)).toBe(10);
    // Joined in July: July to December is 6 months.
    expect(
      defaultEntitlement(casual, { joinDate: dateColumn("2026-07-15"), exitDate: null }, 2026),
    ).toBe(5);
    // Left in March: January to March is 3 months, 2.5 days.
    expect(
      defaultEntitlement(
        casual,
        { joinDate: dateColumn("2024-01-01"), exitDate: dateColumn("2026-03-10") },
        2026,
      ),
    ).toBe(2.5);
    // Not employed that year.
    expect(
      defaultEntitlement(casual, { joinDate: dateColumn("2027-01-05"), exitDate: null }, 2026),
    ).toBe(0);
  });

  it("gives the full allowance when it is not shared out, and no limit to unpaid leave", () => {
    const joiner = { joinDate: dateColumn("2026-11-01"), exitDate: null };
    expect(
      defaultEntitlement({ isPaid: true, prorate: false, daysPerYear: 112 }, joiner, 2026),
    ).toBe(112);
    expect(
      defaultEntitlement({ isPaid: false, prorate: false, daysPerYear: 0 }, joiner, 2026),
    ).toBeNull();
  });
});

describe("monthly salary maths", () => {
  it("pays a full month with nothing marked as the monthly salary", () => {
    const f = evaluateMonth(SEP, rules(), person())!;
    expect(f).toMatchObject({
      daysInMonth: 30,
      employedDays: 30,
      workingDays: 26,
      presentDays: 26,
      absentDays: 0,
      unpaidDays: 0,
    });
    expect(
      [f.basic, f.unpaidDeduction, f.monthlySalary, f.dayRate].map((v) => v.toFixed(2)),
    ).toEqual(["30000.00", "0.00", "30000.00", "1000.00"]);
  });

  it("pays joiners and leavers for their days only", () => {
    const joiner = evaluateMonth(SEP, rules(), person({ joinDate: "2026-09-16" }))!;
    expect(joiner).toMatchObject({ employedFrom: "2026-09-16", employedDays: 15, workingDays: 13 });
    expect(joiner.basic.toFixed(2)).toBe("15000.00");
    const leaver = evaluateMonth(SEP, rules(), person({ exitDate: "2026-09-10" }))!;
    expect(leaver).toMatchObject({ employedTo: "2026-09-10", employedDays: 10, workingDays: 9 });
    expect(leaver.basic.toFixed(2)).toBe("10000.00");
    expect(evaluateMonth(SEP, rules(), person({ joinDate: "2026-10-01" }))).toBeNull();
    expect(evaluateMonth(SEP, rules(), person({ exitDate: "2026-08-31" }))).toBeNull();
  });

  it("deducts absences and unpaid leave at the day rate; paid leave and days off are paid", () => {
    const f = evaluateMonth(
      SEP,
      rules(),
      person({
        attendance: marks([
          ["2026-09-01", "ABSENT"],
          ["2026-09-02", "HALF_DAY"],
        ]),
        leave: [
          { startDate: "2026-09-07", endDate: "2026-09-07", halfDay: false, isPaid: false },
          // Wed 9, Thu 10, (Fri 11 off), Sat 12.
          { startDate: "2026-09-09", endDate: "2026-09-12", halfDay: false, isPaid: true },
          { startDate: "2026-09-14", endDate: "2026-09-14", halfDay: true, isPaid: false },
        ],
      }),
    )!;
    expect(f).toMatchObject({
      absentDays: 1.5,
      unpaidLeaveDays: 1.5,
      paidLeaveDays: 3,
      presentDays: 26 - 1.5 - 1.5 - 3,
      unpaidDays: 3,
    });
    expect(f.unpaidDeduction.toFixed(2)).toBe("3000.00");
    expect(f.basic.toFixed(2)).toBe("30000.00");
  });

  it("turns every N lates into a day's deduction, and adds up overtime", () => {
    const lates = marks(
      ["01", "02", "03", "05", "06", "07", "08"].map(
        (d) => [`2026-09-${d}`, "LATE", 30] as [string, "LATE", number],
      ),
    );
    const strict = evaluateMonth(SEP, rules(3), person({ attendance: lates }))!;
    expect(strict).toMatchObject({
      lateDays: 7,
      latePenaltyDays: 2,
      unpaidDays: 2,
      overtimeMinutes: 210,
    });
    expect(strict.unpaidDeduction.toFixed(2)).toBe("2000.00");
    expect(minutesToHours(strict.overtimeMinutes).toFixed(2)).toBe("3.50");
    const lenient = evaluateMonth(SEP, rules(0), person({ attendance: lates }))!;
    expect(lenient.latePenaltyDays).toBe(0);
    expect(lenient.unpaidDeduction.toFixed(2)).toBe("0.00");
  });

  it("pays each day at the salary in force that day", () => {
    const salaries = [
      { effectiveFrom: "2026-01-01", amount: D(20000) },
      { effectiveFrom: "2026-09-16", amount: D(26000) },
    ];
    expect(salaryOn(salaries, "2026-09-15", D(0)).toFixed(2)).toBe("20000.00");
    expect(salaryOn(salaries, "2026-09-16", D(0)).toFixed(2)).toBe("26000.00");
    const f = evaluateMonth(
      SEP,
      rules(),
      person({
        salaries,
        attendance: marks([
          ["2026-09-01", "ABSENT"],
          ["2026-09-17", "ABSENT"],
        ]),
      }),
    )!;
    // 15 days at 20,000 and 15 days at 26,000.
    expect(f.basic.toFixed(2)).toBe("23000.00");
    expect(f.monthlySalary.toFixed(2)).toBe("26000.00");
    // 666.67 + 866.67 (rounded once, at the end).
    expect(f.unpaidDeduction.toFixed(2)).toBe("1533.33");
  });

  it("never deducts more than the salary earned", () => {
    const f = evaluateMonth(
      SEP,
      rules(1),
      person({
        joinDate: "2026-09-29",
        salaries: [
          { effectiveFrom: "2026-09-29", amount: D(30000) },
          { effectiveFrom: "2026-09-30", amount: D(60000) },
        ],
        attendance: marks([
          ["2026-09-29", "LATE"],
          ["2026-09-30", "LATE"],
        ]),
      }),
    )!;
    expect(f.basic.toFixed(2)).toBe("3000.00");
    expect(f.unpaidDeduction.toFixed(2)).toBe("3000.00");
  });

  it("adds up gross and net pay", () => {
    const line = {
      basic: D(30000),
      allowances: D(1000),
      overtime: overtimePay(D("3.5"), D(100)),
      bonus: D(0),
      unpaidLeaveDeduction: D(2500),
    };
    expect(line.overtime.toFixed(2)).toBe("350.00");
    expect(overtimePay(D(10), null).toFixed(2)).toBe("0.00");
    expect(grossPay(line).toFixed(2)).toBe("28850.00");
    expect(
      netPay({ ...line, advanceDeduction: 2000, taxDeduction: 500, otherDeductions: 100 }).toFixed(
        2,
      ),
    ).toBe("26250.00");
  });
});

describe("advance recovery", () => {
  const adv = (
    id: string,
    givenDay: string,
    outstanding: number,
    installment: number | null = null,
    recoverFromMonth = givenDay.slice(0, 7),
  ): RecoverableAdvance => ({
    id,
    givenDay,
    recoverFromMonth,
    outstanding: D(outstanding),
    installment: installment === null ? null : D(installment),
  });
  const a1 = adv("a1", "2026-08-10", 6000, 2000);
  const a2 = adv("a2", "2026-09-05", 1000);
  const later = adv("a3", "2026-10-02", 500);

  it("recovers installments and whole advances given by the month's end", () => {
    expect(scheduledRecovery([a1, a2, later], SEP, false).toFixed(2)).toBe("3000.00");
    expect(maxRecovery([a1, a2, later], SEP).toFixed(2)).toBe("7000.00");
    // Recovery can start in a later month.
    const deferred = adv("a2", "2026-09-05", 1000, null, "2026-10");
    expect(scheduledRecovery([a1, deferred], SEP, false).toFixed(2)).toBe("2000.00");
    // Someone leaving gives everything back.
    expect(scheduledRecovery([a1, deferred, later], SEP, true).toFixed(2)).toBe("7000.00");
    // The installment never asks for more than is owed.
    expect(scheduledRecovery([adv("a4", "2026-08-01", 500, 2000)], SEP, false).toFixed(2)).toBe(
      "500.00",
    );
  });

  it("settles the schedule first, then the oldest balances", () => {
    const split = (total: number) =>
      allocateRecovery([a2, a1], SEP, D(total), false).map((p) => [
        p.advanceId,
        p.amount.toFixed(2),
      ]);
    expect(split(1500)).toEqual([["a1", "1500.00"]]);
    expect(split(3500)).toEqual([
      ["a1", "2500.00"],
      ["a2", "1000.00"],
    ]);
    expect(split(7000)).toEqual([
      ["a1", "6000.00"],
      ["a2", "1000.00"],
    ]);
    expect(() => allocateRecovery([a1, a2], SEP, D(7000.01), false)).toThrow(RangeError);
  });
});

describe("amounts in words", () => {
  it("uses thousand, lakh and crore", () => {
    expect(numberInWords(0)).toBe("Zero");
    expect(numberInWords(105)).toBe("One Hundred Five");
    expect(numberInWords(125050)).toBe("One Lakh Twenty Five Thousand Fifty");
    expect(numberInWords(123456789)).toBe(
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine",
    );
    expect(() => numberInWords(-1)).toThrow(RangeError);
  });

  it("writes Taka and Paisa for payslips and vouchers", () => {
    expect(amountInWords("26250")).toBe("Taka Twenty Six Thousand Two Hundred Fifty Only");
    expect(amountInWords("125050.50")).toBe(
      "Taka One Lakh Twenty Five Thousand Fifty and Fifty Paisa Only",
    );
    expect(amountInWords("1000.05", "USD")).toBe("One Thousand and 05/100 USD Only");
  });
});
