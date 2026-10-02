import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { assertCodeFitsType, naturalBalance } from "@/modules/accounts/chart";
import { manualPostingBlock } from "@/modules/accounts/chart.service";
import { depreciationCharges, monthlyCharge } from "@/modules/accounts/depreciation";
import { planInstallments, planTotals } from "@/modules/accounts/installments";
import {
  addMonths,
  financialYearStart,
  monthsBetween,
  resolvePeriod,
} from "@/modules/accounts/periods";
import { expenseStatus } from "@/modules/expenses/expense.service";

const TZ = "Asia/Dhaka";
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const fixed = (values: Prisma.Decimal[]) => values.map((v) => v.toFixed(2));

function expectAppError(fn: () => unknown, code: string) {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe("installment plans", () => {
  it("EMI: equal payments, interest on the balance still owed", () => {
    const plan = planInstallments({
      plan: "EMI",
      principal: D(100000),
      annualRatePct: 12,
      count: 12,
      firstDueDate: "2026-01-31",
      everyMonths: 1,
    });
    expect(plan).toHaveLength(12);
    // 100,000 at 1% a month over 12 months: 8,884.88 a month.
    expect(plan[0]).toMatchObject({ number: 1, dueDate: "2026-01-31" });
    expect(fixed([plan[0]!.amount, plan[0]!.interest, plan[0]!.principal])).toEqual([
      "8884.88",
      "1000.00",
      "7884.88",
    ]);
    expect(fixed([plan[1]!.interest, plan[1]!.principal, plan[1]!.balanceAfter])).toEqual([
      "921.15",
      "7963.73",
      "84151.39",
    ]);
    // Month ends stay month ends.
    expect(plan.slice(1, 4).map((i) => i.dueDate)).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(plan.slice(0, 11).every((i) => i.amount.toFixed(2) === "8884.88")).toBe(true);
    // The last one absorbs the rounding and clears the loan.
    expect(plan[11]!.amount.minus(8884.88).abs().lte(0.05)).toBe(true);
    expect(plan[11]!.balanceAfter.toFixed(2)).toBe("0.00");
    const totals = planTotals(plan);
    expect(totals.principal.toFixed(2)).toBe("100000.00");
    expect(totals.amount.toFixed(2)).toBe(totals.principal.plus(totals.interest).toFixed(2));
  });

  it("FLAT: equal principal plus interest on the original amount", () => {
    const plan = planInstallments({
      plan: "FLAT",
      principal: D(120000),
      annualRatePct: 10,
      count: 12,
      firstDueDate: "2026-08-10",
      everyMonths: 1,
    });
    expect(plan.every((i) => i.principal.toFixed(2) === "10000.00")).toBe(true);
    expect(plan.every((i) => i.interest.toFixed(2) === "1000.00")).toBe(true);
    expect(planTotals(plan).interest.toFixed(2)).toBe("12000.00");
    expect(plan[11]!.dueDate).toBe("2027-07-10");
  });

  it("INTEREST_ONLY: the return each time, the principal with the last one (quarterly)", () => {
    const plan = planInstallments({
      plan: "INTEREST_ONLY",
      principal: D(100000),
      annualRatePct: 12,
      count: 4,
      firstDueDate: "2026-03-31",
      everyMonths: 3,
    });
    expect(plan.map((i) => [i.dueDate, i.principal.toFixed(2), i.interest.toFixed(2)])).toEqual([
      ["2026-03-31", "0.00", "3000.00"],
      ["2026-06-30", "0.00", "3000.00"],
      ["2026-09-30", "0.00", "3000.00"],
      ["2026-12-31", "100000.00", "3000.00"],
    ]);
  });

  it("EMI without interest splits the principal, the last one taking the paisa", () => {
    const plan = planInstallments({
      plan: "EMI",
      principal: D(1000),
      annualRatePct: 0,
      count: 3,
      firstDueDate: "2026-01-01",
      everyMonths: 1,
    });
    expect(plan.map((i) => i.amount.toFixed(2))).toEqual(["333.33", "333.33", "333.34"]);
    expect(planTotals(plan).interest.toFixed(2)).toBe("0.00");
  });
});

describe("depreciation", () => {
  const machine = {
    cost: D(120000),
    salvage: D(0),
    ratePct: D(10),
    method: "STRAIGHT_LINE" as const,
    bookValue: D(120000),
  };

  it("straight line charges the same each month, part months by the day", () => {
    const { charges, total, bookValueAfter } = depreciationCharges(
      machine,
      "2026-01-16",
      "2026-03-31",
    );
    expect(charges.map((c) => [c.month, c.from, c.to, c.days, c.amount.toFixed(2)])).toEqual([
      ["2026-01", "2026-01-16", "2026-01-31", 16, "516.13"],
      ["2026-02", "2026-02-01", "2026-02-28", 28, "1000.00"],
      ["2026-03", "2026-03-01", "2026-03-31", 31, "1000.00"],
    ]);
    expect(total.toFixed(2)).toBe("2516.13");
    expect(bookValueAfter.toFixed(2)).toBe("117483.87");
    expect(monthlyCharge(machine).toFixed(2)).toBe("1000.00");
  });

  it("never takes the book value below the salvage value", () => {
    const { charges, total, bookValueAfter } = depreciationCharges(
      {
        cost: D(10000),
        salvage: D(9500),
        ratePct: D(50),
        method: "STRAIGHT_LINE",
        bookValue: D(9550),
      },
      "2026-01-01",
      "2026-06-30",
    );
    expect(charges.map((c) => c.amount.toFixed(2))).toEqual(["20.83", "20.83", "8.34"]);
    expect(total.toFixed(2)).toBe("50.00");
    expect(bookValueAfter.toFixed(2)).toBe("9500.00");
  });

  it("reducing balance takes the yearly rate off the book value over a year", () => {
    const { charges, bookValueAfter } = depreciationCharges(
      {
        ...machine,
        cost: D(100000),
        bookValue: D(100000),
        ratePct: D(20),
        method: "REDUCING_BALANCE",
      },
      "2026-01-01",
      "2026-12-31",
    );
    expect(charges).toHaveLength(12);
    // Each month charges less than the one before.
    expect(charges[0]!.amount.gt(charges[11]!.amount)).toBe(true);
    expect(bookValueAfter.minus(80000).abs().lte(0.1)).toBe(true);
  });

  it("does not depreciate land (no rate) or an empty range", () => {
    expect(
      depreciationCharges({ ...machine, ratePct: null }, "2026-01-01", "2026-12-31"),
    ).toMatchObject({
      charges: [],
    });
    expect(depreciationCharges(machine, "2026-02-01", "2026-01-31").charges).toEqual([]);
    expect(monthlyCharge({ ...machine, ratePct: D(0) }).toFixed(2)).toBe("0.00");
  });
});

describe("report periods", () => {
  const company = { timezone: TZ, fiscalYearStartMonth: 7 };
  // 2 October 2026, noon in Dhaka.
  const now = new Date("2026-10-02T06:00:00Z");
  const range = (period: Parameters<typeof resolvePeriod>[0], c = company, at = now) => {
    const r = resolvePeriod(period, c, at);
    return [r.period, r.from, r.to];
  };

  it("resolves the presets in company time, with a July financial year", () => {
    expect(range({})).toEqual(["THIS_MONTH", "2026-10-01", "2026-10-31"]);
    expect(range({ period: "TODAY" })).toEqual(["TODAY", "2026-10-02", "2026-10-02"]);
    expect(range({ period: "LAST_MONTH" })).toEqual(["LAST_MONTH", "2026-09-01", "2026-09-30"]);
    expect(range({ period: "THIS_FINANCIAL_YEAR" })).toEqual([
      "THIS_FINANCIAL_YEAR",
      "2026-07-01",
      "2027-06-30",
    ]);
    expect(range({ period: "LAST_FINANCIAL_YEAR" })).toEqual([
      "LAST_FINANCIAL_YEAR",
      "2025-07-01",
      "2026-06-30",
    ]);
    expect(range({ period: "ONE_WEEK" })).toEqual(["ONE_WEEK", "2026-09-26", "2026-10-02"]);
    expect(range({ period: "ONE_MONTH" })).toEqual(["ONE_MONTH", "2026-09-03", "2026-10-02"]);
    expect(range({ period: "ONE_YEAR" })).toEqual(["ONE_YEAR", "2025-10-03", "2026-10-02"]);
    expect(
      range({ period: "THIS_FINANCIAL_YEAR" }, { ...company, fiscalYearStartMonth: 1 }),
    ).toEqual(["THIS_FINANCIAL_YEAR", "2026-01-01", "2026-12-31"]);
  });

  it("gives exact instants: a Dhaka day starts at 18:00 UTC the day before", () => {
    const r = resolvePeriod({ period: "THIS_FINANCIAL_YEAR" }, company, now);
    expect(r.start.toISOString()).toBe("2026-06-30T18:00:00.000Z");
    expect(r.end.toISOString()).toBe("2027-06-30T18:00:00.000Z");
    // 01:00 on 1 October in Dhaka is still 30 September in UTC.
    expect(range({}, company, new Date("2026-09-30T19:00:00Z"))).toEqual([
      "THIS_MONTH",
      "2026-10-01",
      "2026-10-31",
    ]);
  });

  it("takes custom days and rejects backwards or very long ranges", () => {
    expect(range({ from: "2026-08-01" })).toEqual(["CUSTOM", "2026-08-01", "2026-10-02"]);
    expect(range({ from: "2026-08-01", to: "2026-08-31" })).toEqual([
      "CUSTOM",
      "2026-08-01",
      "2026-08-31",
    ]);
    expectAppError(
      () => resolvePeriod({ from: "2026-09-01", to: "2026-08-01" }, company),
      "VALIDATION",
    );
    expectAppError(
      () => resolvePeriod({ from: "2010-01-01", to: "2026-08-01" }, company),
      "VALIDATION",
    );
  });

  it("adds months keeping month ends, and finds financial years", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(financialYearStart("2026-06-30", 7)).toBe("2025-07-01");
    expect(financialYearStart("2026-07-01", 7)).toBe("2026-07-01");
    expect(financialYearStart("2026-07-01", 1)).toBe("2026-01-01");
    expect(monthsBetween("2026-07-15", "2026-09-01")).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
});

describe("chart of accounts rules", () => {
  it("shows balances on the account's normal side", () => {
    expect(naturalBalance("ASSET", 100, 30).toFixed(2)).toBe("70.00");
    expect(naturalBalance("EXPENSE", 100, 30).toFixed(2)).toBe("70.00");
    expect(naturalBalance("LIABILITY", 100, 30).toFixed(2)).toBe("-70.00");
    expect(naturalBalance("INCOME", 30, 100).toFixed(2)).toBe("70.00");
  });

  it("keeps codes inside their type's block", () => {
    expect(() => assertCodeFitsType("1999", "ASSET")).not.toThrow();
    expect(() => assertCodeFitsType("9500", "EXPENSE")).not.toThrow();
    expectAppError(() => assertCodeFitsType("2000", "ASSET"), "VALIDATION");
    expectAppError(() => assertCodeFitsType("123", "ASSET"), "VALIDATION");
    expectAppError(() => assertCodeFitsType("4abc", "INCOME"), "VALIDATION");
  });

  it("keeps hand-written journal lines off accounts other modules maintain", () => {
    const account = { code: "1000", subType: "CASH" as const, isActive: true };
    expect(manualPostingBlock(account)).toBeNull();
    expect(manualPostingBlock({ ...account, isActive: false })).toMatch(/archived/);
    expect(manualPostingBlock({ ...account, code: "1300", subType: "INVENTORY" })).toMatch(
      /stock/i,
    );
    expect(
      manualPostingBlock({ ...account, code: "1350", subType: "OTHER_CURRENT_ASSET" }),
    ).toMatch(/Production/);
    expect(manualPostingBlock({ ...account, code: "1500", subType: "FIXED_ASSET" })).toMatch(
      /asset register/,
    );
    expect(
      manualPostingBlock({ ...account, code: "2300", subType: "LOAN", capitalSource: { id: "x" } }),
    ).toMatch(/loans/);
  });
});

describe("expense status", () => {
  it("follows from the journal entry and the void / reject date", () => {
    const at = new Date();
    expect(expenseStatus({ journalEntryId: null, voidedAt: null })).toBe("PENDING");
    expect(expenseStatus({ journalEntryId: "je1", voidedAt: null })).toBe("POSTED");
    expect(expenseStatus({ journalEntryId: null, voidedAt: at })).toBe("REJECTED");
    expect(expenseStatus({ journalEntryId: "je1", voidedAt: at })).toBe("VOID");
  });
});
