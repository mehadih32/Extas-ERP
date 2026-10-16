import { describe, expect, it } from "vitest";

import { buyerName, isZero, money, usesWholesalePrice } from "@/components/sales/labels";
import { parseRatio, presetRatio, ratioPieces, ratioText } from "@/components/sales/magic-ratio";
import {
  clearedView,
  invoiceListQuery,
  invoiceViewFrom,
  isSalesFiltered,
  orderViewFrom,
  paymentListQuery,
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

  it("filters cheques by status, without days", () => {
    const view = paymentViewFrom({ show: "cheques", status: "BOUNCED", from: "2026-10-01" });
    expect(view).toEqual({ list: "payments", show: "cheques", chequeStatus: "BOUNCED" });
    expect(salesListSearch(view)).toBe("?show=cheques&status=BOUNCED");
    expect(isSalesFiltered(view)).toBe(true);
    expect(paymentListQuery(view, "c1")).toEqual({ status: "BOUNCED", cursor: "c1", take: 30 });
    expect(clearedView(view)).toEqual({ list: "payments", show: "cheques" });
    expect(paymentViewFrom({ show: "cheques", status: "nonsense" }).chequeStatus).toBeUndefined();
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
      "/tech-packs",
      "/accounts",
      "/products",
      "/materials",
      "/parties",
      "/hr",
      "/reports",
      "/planner",
      "/compliance",
      "/accounts/expenses",
      "/me",
      "/ai",
      "/settings",
    ]);
    // Their printed quotations and invoices are under Reports & documents.
    expect(visibleNavItems(["sales.view"]).map((i) => i.href)).toEqual(["/", "/sales", "/reports"]);
    expect(visibleSalesTabs(["sales.view"]).map((t) => t.label)).toEqual([
      "Overview",
      "Orders",
      "Quotations",
      "Proformas",
      "Invoices",
      "Payments",
      "Returns",
    ]);
    expect(visibleSalesTabs(["inventory.view"])).toEqual([]);
  });

  it("keeps four sections on the phone's tab bar and moves the rest under More", () => {
    const everything = phoneTabs(visibleNavItems(all));
    expect(everything.tabs.map((i) => i.href)).toEqual(["/", "/sales", "/production", "/accounts"]);
    // Tech Pack always sits under More on the phone (v6.4), first.
    expect(everything.more.map((i) => i.href)).toEqual([
      "/tech-packs",
      "/products",
      "/materials",
      "/parties",
      "/hr",
      "/reports",
      "/planner",
      "/compliance",
      "/ai",
      "/settings",
    ]);
    const seller = phoneTabs(visibleNavItems(["sales.view", "inventory.view", "parties.view"]));
    expect(seller.tabs.map((i) => i.href)).toEqual(["/", "/sales", "/products", "/parties"]);
    expect(seller.more.map((i) => i.href)).toEqual(["/reports"]);
  });
});

describe("Magic Ratio on the order grid", () => {
  const sizes = [
    { id: "s", name: "S" },
    { id: "m", name: "M" },
    { id: "l", name: "L" },
    { id: "xl", name: "XL" },
  ];

  it("reads a ratio however people type it", () => {
    for (const text of ["1:2:2:1", "1-2-2-1", "1 2 2 1", " 1 : 2 : 2 : 1 ", "1/2/2/1", "1,2,2,1"]) {
      expect(parseRatio(text)).toEqual([1, 2, 2, 1]);
    }
    expect(parseRatio("0:1:1:0")).toEqual([0, 1, 1, 0]);
    expect(ratioText([1, 2, 2, 1])).toBe("1:2:2:1");
  });

  it("refuses a ratio that is not whole numbers, or all zero", () => {
    for (const text of ["", "1:a:2", "1.5:2", "0:0:0", "1::2", "-1:2", "1000:1"]) {
      expect(parseRatio(text)).toBeNull();
    }
  });

  it("fills sets of the ratio, one number per size", () => {
    const result = ratioPieces(sizes, [1, 2, 2, 1], 10);
    expect("pieces" in result && Object.fromEntries(result.pieces)).toEqual({
      s: 10,
      m: 20,
      l: 20,
      xl: 10,
    });
  });

  it("says why a ratio does not fit the style", () => {
    expect(ratioPieces(sizes, [1, 2, 1], 10)).toEqual({
      problem: "This style has 4 sizes (S, M, L, XL): type 4 numbers. Use 0 to skip a size.",
    });
    expect(ratioPieces(sizes, null, 10)).toEqual({
      problem: "Type the ratio as numbers, like 1:2:2:1.",
    });
    for (const sets of [0, -1, 1.5, Number.NaN]) {
      expect(ratioPieces(sizes, [1, 2, 2, 1], sets)).toEqual({
        problem: "Enter how many sets, like 10.",
      });
    }
  });

  it("lays a saved ratio over the style's sizes", () => {
    const saved = [
      { sizeId: "m", ratio: 2 },
      { sizeId: "l", ratio: 3 },
      { sizeId: "xxl", ratio: 1 },
    ];
    expect(presetRatio(sizes, saved)).toEqual([0, 2, 3, 0]);
    // A ratio for none of the style's sizes is not offered.
    expect(presetRatio(sizes, [{ sizeId: "xxl", ratio: 1 }])).toBeNull();
  });
});
