import { Prisma, type SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  accountsHref,
  assetHref,
  columnAmount,
  costPeriodLabel,
  employeePayHref,
  growthText,
  isNegative,
  PROFIT_PERIOD_LABELS,
  profitSpan,
  signedMoney,
} from "@/components/accounts/labels";
import {
  accountsListSearch,
  clearedAccountsView,
  expenseListQuery,
  expenseViewFrom,
  isAccountsFiltered,
  journalListQuery,
  journalViewFrom,
  paymentViewFrom,
} from "@/components/accounts/list-view";
import {
  asOfFrom,
  periodQuery,
  periodSearch,
  periodViewFrom,
} from "@/components/accounts/report-view";
import { visibleAccountsTabs } from "@/components/accounts/tabs";
import { phoneTabs, topBarFold, visibleNavItems } from "@/components/shell/nav-items";
import {
  costPeriodOf,
  costPeriodParam,
  costWindow,
  costYears,
  parseCostPeriod,
} from "@/modules/accounts/cost-periods";
import { growth, isProfitPeriod, profitWindow } from "@/modules/accounts/profit-periods";
import { canMoveMoney, canReverseEntry, canVoidSupplierPayment } from "@/modules/accounts/rules";
import {
  canApproveExpense,
  canEditExpense,
  canRejectExpense,
  canVoidExpense,
} from "@/modules/expenses/rules";
import { DEFAULT_ROLE_PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";

const role = (name: SystemRole): string[] => [...DEFAULT_ROLE_PERMISSIONS[name]];
const holding = (...keys: PermissionKey[]) => ({ can: (key: PermissionKey) => keys.includes(key) });
const ACCOUNTS = holding(...DEFAULT_ROLE_PERMISSIONS.ACCOUNTS);
const tabs = (permissions: string[]) => visibleAccountsTabs(permissions).map((t) => t.label);

describe("Accounts in the menu, by role", () => {
  it("gives the owner and Accounts every tab, with Accounts fourth on the phone", () => {
    const all = [
      "Overview",
      "Cash & bank",
      "Supplier payments",
      "Expenses",
      "Journal",
      "Chart of accounts",
      "Reports",
    ];
    expect(tabs(role("SUPER_ADMIN"))).toEqual(all);
    expect(tabs(role("ACCOUNTS"))).toEqual(all);
    const accounts = phoneTabs(visibleNavItems(role("ACCOUNTS")));
    expect(accounts.tabs.map((i) => i.href)).toEqual(["/", "/sales", "/production", "/accounts"]);
    expect(accounts.more.map((i) => i.href)).toEqual([
      "/materials",
      "/parties",
      "/hr",
      "/reports",
      "/planner",
      "/compliance",
    ]);
  });

  it("folds the owner's last sections under More where the top bar is narrower", () => {
    const owner = visibleNavItems(role("SUPER_ADMIN")).map((item, index) => [
      item.href,
      topBarFold(index),
    ]);
    expect(owner).toEqual([
      ["/", null],
      ["/sales", null],
      ["/production", null],
      ["/accounts", "md"],
      ["/products", "md"],
      ["/materials", "lg"],
      ["/parties", "all"],
      ["/hr", "all"],
      ["/reports", "all"],
      ["/planner", "all"],
      ["/compliance", "all"],
      ["/settings", "all"],
    ]);
    expect(topBarFold(6)).toBe("all");
  });

  it("hides the books, balances and reports from everyone else", () => {
    for (const name of ["SALES_EXECUTIVE", "PRODUCTION_MANAGER", "EMPLOYEE"] as const) {
      const items = visibleNavItems(role(name)).map((i) => i.href);
      expect(items, name).not.toContain("/accounts");
      // They record their own expenses from their own entry, and see only that tab.
      expect(items, name).toContain("/accounts/expenses");
      expect(tabs(role(name)), name).toEqual(["Expenses"]);
    }
    expect(visibleNavItems(role("WAREHOUSE_TEAM")).map((i) => i.href)).not.toContain(
      "/accounts/expenses",
    );
    expect(tabs(role("WAREHOUSE_TEAM"))).toEqual([]);
  });

  it("opens supplier payments, not the books, to people who only pay suppliers", () => {
    expect(tabs(["accounts.payments.record"])).toEqual(["Supplier payments", "Expenses"]);
    // Money received is recorded in Sales; that key alone opens nothing here.
    expect(visibleNavItems(["accounts.receipts.record"]).map((i) => i.href)).toEqual(["/"]);
    expect(tabs(["accounts.receipts.record"])).toEqual([]);
  });

  it("gives expense managers their tab under Accounts, not a second entry", () => {
    const items = visibleNavItems(["expenses.create", "expenses.manage"]).map((i) => i.href);
    // HR & payroll opens only for the staff claims they decide (its Claims tab).
    expect(items).toEqual(["/", "/accounts", "/hr"]);
    expect(tabs(["expenses.create", "expenses.manage"])).toEqual(["Expenses"]);
  });
});

describe("the Accounts lists' filters in the address bar", () => {
  it("reads only known choices and writes them back the same way", () => {
    const journal = journalViewFrom({ q: " JV-0004 ", source: "MANUAL" });
    expect(accountsListSearch(journal)).toBe("?q=JV-0004&source=MANUAL");
    expect(journalListQuery(journal)).toMatchObject({ search: "JV-0004", sourceType: "MANUAL" });
    expect(journalViewFrom({ source: "NONSENSE" }).source).toBeUndefined();

    const expenses = expenseViewFrom({ status: "PENDING", head: "abc-123", mine: "1" });
    expect(accountsListSearch(expenses)).toBe("?status=PENDING&head=abc-123&mine=1");
    expect(expenseListQuery(expenses)).toMatchObject({
      status: "PENDING",
      headId: "abc-123",
      mine: true,
    });
    expect(isAccountsFiltered(expenses)).toBe(true);
    expect(accountsListSearch(clearedAccountsView(expenses))).toBe("");
    // The Overview's breakdown opens a head's expenses for its month.
    const dated = expenseViewFrom({ head: "abc-123", from: "2026-10-01", to: "2026-10-31" });
    expect(accountsListSearch(dated)).toBe("?head=abc-123&from=2026-10-01&to=2026-10-31");
    expect(expenseListQuery(dated)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(isAccountsFiltered(expenseViewFrom({ from: "2026-10-01" }))).toBe(true);
    expect(expenseViewFrom({ from: "1 Oct", to: "2026-10-31'" })).toMatchObject({
      from: undefined,
      to: undefined,
    });
    expect(expenseViewFrom({ head: "<script>", status: "PAID" })).toMatchObject({
      head: undefined,
      status: undefined,
    });

    expect(accountsListSearch(paymentViewFrom({ supplier: "sup-1" }))).toBe("?supplier=sup-1");
    expect(isAccountsFiltered(paymentViewFrom({}))).toBe(false);
  });

  it("keeps a report's period and day in the address", () => {
    const last = periodViewFrom({ period: "LAST_MONTH", months: "1" });
    expect(periodSearch(last)).toBe("?period=LAST_MONTH&months=1");
    expect(periodQuery(last)).toEqual({ period: "LAST_MONTH", byMonth: true });
    // Dates win over a preset; this month is the default and stays out of the address.
    const custom = periodViewFrom({ period: "LAST_MONTH", from: "2026-07-01", to: "2026-09-30" });
    expect(periodSearch(custom)).toBe("?from=2026-07-01&to=2026-09-30");
    expect(periodQuery(custom)).toEqual({ from: "2026-07-01", to: "2026-09-30", byMonth: false });
    expect(periodSearch(periodViewFrom({ period: "THIS_MONTH" }))).toBe("");
    expect(periodViewFrom({ period: "FOREVER", from: "2026-02-30" })).toEqual({
      period: undefined,
      from: undefined,
      to: undefined,
      byMonth: false,
    });
    expect(asOfFrom({ asOf: "2026-09-30" })).toBe("2026-09-30");
    expect(asOfFrom({ asOf: "yesterday" })).toBeUndefined();
  });
});

describe("Accounts words and figures", () => {
  it("shows overdrafts and losses with a minus, and leaves empty columns blank", () => {
    expect(signedMoney("-1250.00", "BDT")).toBe("− BDT 1,250.00");
    expect(signedMoney("125000.00", "BDT")).toBe("BDT 1,25,000.00");
    expect(isNegative("-0.00")).toBe(false);
    expect(columnAmount("0.00", "BDT")).toBe("");
    expect(columnAmount("50.00", "BDT")).toBe("BDT 50.00");
    expect(accountsHref.pay("s 1")).toBe("/accounts/supplier-payments/new?supplier=s%201");
  });
});

describe("what the Accounts screens offer, from the same rules the services check", () => {
  const cashOut = [{ subType: "CASH" as const, debit: "0", credit: "500" }];

  it("lets only the money keys move cash", () => {
    expect(canMoveMoney(ACCOUNTS, cashOut).ok).toBe(true);
    expect(canMoveMoney(holding("accounts.manage", "accounts.receipts.record"), cashOut).ok).toBe(
      false,
    );
    expect(
      canMoveMoney(holding("accounts.manage"), [
        { subType: "OPERATING_EXPENSE", debit: "500", credit: "0" },
      ]).ok,
    ).toBe(true);
  });

  it("reverses only hand-written vouchers and transfers, once", () => {
    const entry = {
      number: "JV-0001",
      sourceType: "MANUAL" as const,
      reversalOfId: null,
      isReversed: false,
      lines: cashOut,
    };
    expect(canReverseEntry(ACCOUNTS, entry).ok).toBe(true);
    expect(canReverseEntry(ACCOUNTS, { ...entry, sourceType: "SALE" }).ok).toBe(false);
    expect(canReverseEntry(ACCOUNTS, { ...entry, sourceType: "SUPPLIER_FAULT" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("undo it in the fault log"),
    });
    expect(canReverseEntry(ACCOUNTS, { ...entry, isReversed: true }).ok).toBe(false);
    expect(canReverseEntry(ACCOUNTS, { ...entry, reversalOfId: "x" }).ok).toBe(false);
    // Reversing money paid out brings it back in, which needs the receipts key.
    expect(canReverseEntry(holding("accounts.manage", "accounts.payments.record"), entry).ok).toBe(
      false,
    );
  });

  it("voids a supplier payment once, with both money keys for cash", () => {
    const payment = {
      number: "PV-0001",
      journalEntry: { isReversed: false },
      accountSubType: "BANK" as const,
    };
    expect(canVoidSupplierPayment(ACCOUNTS, payment).ok).toBe(true);
    expect(
      canVoidSupplierPayment(ACCOUNTS, { ...payment, journalEntry: { isReversed: true } }).ok,
    ).toBe(false);
    expect(canVoidSupplierPayment(holding("accounts.payments.record"), payment).ok).toBe(false);
  });

  it("lets Accounts approve claims, and their author change or withdraw them while they wait", () => {
    const claim = {
      number: "EXP-0001",
      status: "PENDING" as const,
      paymentType: "CASH_BANK" as const,
      own: true,
    };
    const employee = holding(...DEFAULT_ROLE_PERMISSIONS.EMPLOYEE);
    expect(canApproveExpense(employee, claim).ok).toBe(false);
    expect(canApproveExpense(ACCOUNTS, claim).ok).toBe(true);
    expect(canRejectExpense(employee, claim).ok).toBe(true);
    expect(canRejectExpense(employee, { ...claim, own: false }).ok).toBe(false);
    expect(canEditExpense(employee, claim, { money: true }).ok).toBe(true);
    expect(canEditExpense(employee, { ...claim, status: "POSTED" }).ok).toBe(false);
    expect(canEditExpense(ACCOUNTS, { ...claim, status: "POSTED" }, { money: true }).ok).toBe(
      false,
    );
    expect(canVoidExpense(employee, { ...claim, status: "POSTED" }).ok).toBe(false);
    expect(canVoidExpense(ACCOUNTS, { ...claim, status: "POSTED" }).ok).toBe(true);
    expect(canVoidExpense(ACCOUNTS, claim).ok).toBe(false);
  });
});

describe("the Net profit card's periods", () => {
  it("covers today, this month or this financial year so far, against the same days before", () => {
    // Financial year from July.
    expect(profitWindow("TODAY", "2026-10-11", 7)).toEqual({
      from: "2026-10-11",
      to: "2026-10-11",
      previous: { from: "2026-10-10", to: "2026-10-10" },
    });
    expect(profitWindow("MONTH", "2026-10-11", 7)).toEqual({
      from: "2026-10-01",
      to: "2026-10-11",
      previous: { from: "2026-09-01", to: "2026-09-11" },
    });
    // A longer month against a shorter one stops at the shorter month's end.
    expect(profitWindow("MONTH", "2026-03-31", 7).previous).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(profitWindow("YEAR", "2026-10-11", 7)).toEqual({
      from: "2026-07-01",
      to: "2026-10-11",
      previous: { from: "2025-07-01", to: "2025-10-11" },
    });
    // Before July the financial year began the year before; a calendar year when it starts in January.
    expect(profitWindow("YEAR", "2026-03-05", 7).from).toBe("2025-07-01");
    expect(profitWindow("YEAR", "2026-03-05", 1).from).toBe("2026-01-01");
    expect(profitWindow("LIFETIME", "2026-10-11", 7)).toEqual({
      from: null,
      to: "2026-10-11",
      previous: null,
    });
    expect(isProfitPeriod("MONTH")).toBe(true);
    expect(isProfitPeriod("month")).toBe(false);
    expect(isProfitPeriod(undefined)).toBe(false);
  });

  it("says which way profit moved, as a share of the period before, a loss too", () => {
    const d = (v: number) => new Prisma.Decimal(v);
    expect(growth(d(12500), d(10000))).toEqual({ direction: "UP", percent: "25.0" });
    expect(growth(d(8000), d(10000))).toEqual({ direction: "DOWN", percent: "20.0" });
    expect(growth(d(5000), d(5000))).toEqual({ direction: "FLAT", percent: "0.0" });
    // From a 4,000 loss to a 1,000 loss is better: up 75%.
    expect(growth(d(-1000), d(-4000))).toEqual({ direction: "UP", percent: "75.0" });
    expect(growth(d(-500), d(1000))).toEqual({ direction: "DOWN", percent: "150.0" });
    // Nothing before: no share to give.
    expect(growth(d(300), d(0))).toEqual({ direction: "UP", percent: null });
    expect(growth(d(0), d(0))).toEqual({ direction: "FLAT", percent: null });

    expect(growthText({ direction: "UP", percent: "25.0" }, "MONTH")).toBe(
      "Up 25.0% on the same days last month",
    );
    expect(growthText({ direction: "DOWN", percent: "20.0" }, "TODAY")).toBe(
      "Down 20.0% on yesterday",
    );
    expect(growthText({ direction: "UP", percent: null }, "YEAR")).toBe(
      "Up on the same days last year",
    );
    expect(growthText({ direction: "FLAT", percent: "0.0" }, "TODAY")).toBe("Same as yesterday");
    expect(profitSpan({ period: "MONTH", from: "2026-10-01", to: "2026-10-11" })).toBe(
      "1 – 11 Oct 2026",
    );
    expect(profitSpan({ period: "TODAY", from: "2026-10-11", to: "2026-10-11" })).toBe(
      "Today, 11 Oct 2026",
    );
    expect(profitSpan({ period: "LIFETIME", from: null, to: "2026-10-11" })).toBe(
      "All time to 11 Oct 2026",
    );
    expect(Object.values(PROFIT_PERIOD_LABELS)).toEqual([
      "Today",
      "This month",
      "This year",
      "Lifetime",
    ]);
  });
});

describe("the expense breakdown's month or year", () => {
  it("reads ?costs= as a month or a whole year, and nothing else", () => {
    expect(parseCostPeriod("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseCostPeriod(" 2026 ")).toEqual({ year: 2026, month: null });
    for (const bad of ["2026-13", "2026-00", "26-10", "1999", "2026-1", "", undefined, 2026]) {
      expect(parseCostPeriod(bad), String(bad)).toBeNull();
    }
    expect(costPeriodParam({ year: 2026, month: 3 })).toBe("2026-03");
    expect(costPeriodParam({ year: 2026, month: null })).toBe("2026");
    expect(costPeriodOf("2026-10-11")).toEqual({ year: 2026, month: 10 });
  });

  it("covers the month's days, or the calendar year", () => {
    expect(costWindow({ year: 2026, month: 10 })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(costWindow({ year: 2028, month: 2 })).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(costWindow({ year: 2026, month: 2 })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(costWindow({ year: 2026, month: null })).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("offers the years from the first entry to this one, newest first", () => {
    expect(costYears(2024, 2026)).toEqual([2026, 2025, 2024]);
    expect(costYears(null, 2026)).toEqual([2026]);
    expect(costYears(2027, 2026)).toEqual([2026]);
  });

  it("names the period and links the pages", () => {
    expect(costPeriodLabel({ year: 2026, month: 10 })).toBe("October 2026");
    expect(costPeriodLabel({ year: 2026, month: null })).toBe("2026");
    expect(employeePayHref("emp 1", 2026)).toBe("/accounts/salaries/emp%201?year=2026");
    expect(employeePayHref("e1")).toBe("/accounts/salaries/e1");
    expect(assetHref.asset("a1")).toBe("/accounts/assets/a1");
    expect(assetHref.edit("a1")).toBe("/accounts/assets/a1/edit");
  });
});
