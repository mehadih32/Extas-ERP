import { describe, expect, it } from "vitest";

import { buyerName, isZero, money, usesWholesalePrice } from "@/components/sales/labels";
import {
  clearedView,
  invoiceListQuery,
  invoiceViewFrom,
  isSalesFiltered,
  orderViewFrom,
  paymentViewFrom,
  salesListSearch,
} from "@/components/sales/list-view";
import { visibleSalesTabs } from "@/components/sales/tabs";
import { NAV_ITEMS, phoneTabs, visibleNavItems } from "@/components/shell/nav-items";
import { PERMISSIONS } from "@/modules/rbac/permissions";

describe("the Sales lists' filters in the address bar", () => {
  it("reads only known choices and writes them back the same way", () => {
    const view = orderViewFrom({ q: " rahim ", status: "CONFIRMED", channel: "WEBSITE" });
    // Website orders come with the integrations, so that filter is not offered yet.
    expect(view).toEqual({ list: "orders", q: "rahim", status: "CONFIRMED", channel: undefined });
    expect(salesListSearch(view)).toBe("?q=rahim&status=CONFIRMED");
    expect(isSalesFiltered(view)).toBe(true);
    expect(salesListSearch(clearedView(view))).toBe("");
    expect(orderViewFrom({ status: "nonsense" }).status).toBeUndefined();
  });

  it("asks for overdue invoices with the overdue flag, not a status", () => {
    const view = invoiceViewFrom({ status: "OVERDUE" });
    expect(invoiceListQuery(view)).toMatchObject({ status: undefined, overdue: true });
    expect(invoiceListQuery(invoiceViewFrom({ status: "PAID" }))).toMatchObject({
      status: "PAID",
      overdue: undefined,
    });
  });

  it("keeps the payments' days in order and the refunds switch out of the filters", () => {
    const view = paymentViewFrom({ show: "refunds", from: "2026-10-09", to: "2026-10-01" });
    expect(view).toEqual({
      list: "payments",
      show: "refunds",
      from: "2026-10-01",
      to: "2026-10-09",
    });
    expect(isSalesFiltered({ ...view, from: undefined, to: undefined })).toBe(false);
    expect(clearedView(view)).toEqual({ list: "payments", show: "refunds" });
  });
});

describe("Sales words and figures", () => {
  it("shows amounts with the currency and lakh grouping", () => {
    expect(money("1234567.50", "BDT")).toBe("BDT 12,34,567.50");
    expect(isZero("0.00")).toBe(true);
    expect(isZero("0.01")).toBe(false);
    expect(buyerName(null, "Tanvir")).toBe("Tanvir");
    expect(buyerName(null)).toBe("Walk-in customer");
    expect(usesWholesalePrice("WHOLESALE")).toBe(true);
    expect(usesWholesalePrice("POS")).toBe(false);
  });
});

describe("the menu with Sales in it", () => {
  const all = PERMISSIONS.map((p) => p.key);

  it("puts Sales second, for people who may see sales", () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual([
      "/",
      "/sales",
      "/production",
      "/accounts",
      "/products",
      "/materials",
      "/parties",
      "/hr",
      "/accounts/expenses",
      "/me",
      "/settings",
    ]);
    expect(visibleNavItems(["sales.view"]).map((i) => i.href)).toEqual(["/", "/sales"]);
    expect(visibleSalesTabs(["sales.view"]).map((t) => t.label)).toEqual([
      "Orders",
      "Quotations",
      "Proformas",
      "Invoices",
      "Payments",
    ]);
    expect(visibleSalesTabs(["inventory.view"])).toEqual([]);
  });

  it("keeps four sections on the phone's tab bar and moves the rest under More", () => {
    const everything = phoneTabs(visibleNavItems(all));
    expect(everything.tabs.map((i) => i.href)).toEqual(["/", "/sales", "/production", "/accounts"]);
    expect(everything.more.map((i) => i.href)).toEqual([
      "/products",
      "/materials",
      "/parties",
      "/hr",
      "/settings",
    ]);
    const seller = phoneTabs(visibleNavItems(["sales.view", "inventory.view", "parties.view"]));
    expect(seller.tabs).toHaveLength(4);
    expect(seller.more).toEqual([]);
  });
});
