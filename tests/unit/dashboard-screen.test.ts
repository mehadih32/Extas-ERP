import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERIOD,
  PERIOD_OPTIONS,
  topSellersSearch,
  topSellersViewFrom,
} from "@/components/dashboard/top-sellers-view";
import { initialsOf, roleLabel } from "@/components/shell/labels";
import { isActivePath, NAV_ITEMS, visibleNavItems } from "@/components/shell/nav-items";
import { PERMISSIONS } from "@/modules/rbac/permissions";

const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);

describe("top sellers choices in the address bar", () => {
  const seller = { canSortBySales: true };
  const noSales = { canSortBySales: false };

  it("starts from the dashboard API's defaults", () => {
    expect(topSellersViewFrom({}, seller)).toEqual({
      period: DEFAULT_PERIOD,
      groupBy: "SKU",
      sortBy: "QUANTITY",
    });
    expect(topSellersSearch(topSellersViewFrom({}, seller))).toBe("");
  });

  it("reads the period, grouping and order, and writes them back the same way", () => {
    const view = topSellersViewFrom(
      { period: "this-month", group: "style", sort: "sales" },
      seller,
    );
    expect(view).toEqual({ period: "THIS_MONTH", groupBy: "STYLE", sortBy: "REVENUE" });
    expect(topSellersSearch(view)).toBe("?period=this-month&group=style&sort=sales");
    for (const { value } of PERIOD_OPTIONS) {
      const search = new URLSearchParams(
        topSellersSearch({ period: value, groupBy: "SKU", sortBy: "QUANTITY" }),
      );
      expect(topSellersViewFrom(Object.fromEntries(search), seller).period).toBe(value);
    }
  });

  it("ignores values it does not know", () => {
    const view = topSellersViewFrom(
      { period: "ALL_TIME", group: ["style", "sku"], sort: "profit" },
      seller,
    );
    expect(view).toEqual({ period: DEFAULT_PERIOD, groupBy: "SKU", sortBy: "QUANTITY" });
  });

  it("never ranks by sales value for people who may not see sales", () => {
    expect(topSellersViewFrom({ sort: "sales" }, noSales).sortBy).toBe("QUANTITY");
  });
});

describe("the app frame", () => {
  it("shows the dashboard to everyone, even without dashboard permissions", () => {
    expect(visibleNavItems([]).map((item) => item.href)).toEqual(["/"]);
    // Everything but the claimants' own Expenses entry, which Accounts reach as a tab, and
    // My HR, which HR and Accounts reach from the account menu.
    expect(visibleNavItems(ALL_PERMISSIONS).map((item) => item.href)).toEqual(
      NAV_ITEMS.map((item) => item.href).filter(
        (href) => href !== "/accounts/expenses" && href !== "/me",
      ),
    );
  });

  it("only lists permissions that exist", () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    for (const item of NAV_ITEMS) {
      for (const permission of [...item.anyOf, ...(item.noneOf ?? [])]) {
        expect(known.has(permission), permission).toBe(true);
      }
    }
  });

  it("marks the current section, without the dashboard matching every page", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/sales", "/")).toBe(false);
    expect(isActivePath("/sales", "/sales")).toBe(true);
    expect(isActivePath("/sales/12", "/sales")).toBe(true);
    expect(isActivePath("/salesmen", "/sales")).toBe(false);
  });

  it("makes initials from the name, or the email when there is none", () => {
    expect(initialsOf("Mehadi Hasan", "owner@extras.test")).toBe("MH");
    expect(initialsOf("  Nusrat  Jahan Chowdhury ", "a@b.c")).toBe("NC");
    expect(initialsOf("Rafiq", "a@b.c")).toBe("R");
    expect(initialsOf("", "store@extras.test")).toBe("S");
  });

  it("names the role, or the platform owner who has none in this company", () => {
    expect(roleLabel({ name: "Sales Executive" }, false)).toBe("Sales Executive");
    expect(roleLabel(null, true)).toBe("Platform owner");
    expect(roleLabel(null, false)).toBe("Member");
  });
});
