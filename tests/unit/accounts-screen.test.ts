import type { SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { accountsHref, columnAmount, isNegative, signedMoney } from "@/components/accounts/labels";
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
    expect(accounts.more.map((i) => i.href)).toEqual(["/materials", "/parties", "/hr"]);
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
      ["/accounts", null],
      ["/products", "md"],
      ["/materials", "lg"],
      ["/parties", "lg"],
      ["/hr", "all"],
      ["/settings", "all"],
    ]);
    expect(topBarFold(7)).toBe("all");
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
    expect(items).toEqual(["/", "/accounts"]);
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
