import type { SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  materialsHref,
  perUnit,
  quantity,
  readPrice,
  readQuantity,
  signedQuantity,
} from "@/components/materials/labels";
import {
  clearedMaterialsView,
  isMaterialsFiltered,
  issueViewFrom,
  materialsListSearch,
  orderListQuery,
  orderViewFrom,
  purchaseViewFrom,
  stockListQuery,
  stockViewFrom,
} from "@/components/materials/list-view";
import { visibleMaterialsTabs } from "@/components/materials/tabs";
import { phoneTabs, visibleNavItems } from "@/components/shell/nav-items";
import {
  canArchiveMaterial,
  canCancelOrder,
  canChangeOrderLines,
  canChangeUnit,
  canCloseOrder,
  canReturnToSupplier,
  canVoidPurchase,
  materialsKeys,
} from "@/modules/materials/rules";
import { DEFAULT_ROLE_PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";

const role = (name: SystemRole): string[] => [...DEFAULT_ROLE_PERMISSIONS[name]];
const holding = (keys: readonly string[]) => ({
  can: (key: PermissionKey) => keys.includes(key),
});
const tabs = (permissions: string[]) => visibleMaterialsTabs(permissions).map((t) => t.label);
const message = (verdict: { ok: boolean; message?: string }) =>
  verdict.ok ? "allowed" : verdict.message;

describe("Raw materials in the menu, by role", () => {
  const ALL = [
    "Overview",
    "Stock",
    "Purchase orders",
    "Purchases",
    "Supplier returns",
    "Issue notes",
  ];

  it("gives the owner, Production Managers and Accounts every tab", () => {
    for (const name of ["SUPER_ADMIN", "PRODUCTION_MANAGER", "ACCOUNTS"] as const) {
      expect(tabs(role(name)), name).toEqual(ALL);
      expect(
        visibleNavItems(role(name)).map((i) => i.href),
        name,
      ).toContain("/materials");
    }
  });

  it("keeps the bills from the store team, who see quantities only", () => {
    expect(tabs(role("WAREHOUSE_TEAM"))).toEqual([
      "Overview",
      "Stock",
      "Purchase orders",
      "Issue notes",
    ]);
    const store = phoneTabs(visibleNavItems(role("WAREHOUSE_TEAM")));
    expect([...store.tabs, ...store.more].map((i) => i.href)).toContain("/materials");
  });

  it("hides Raw materials from Sales Executives and employees", () => {
    for (const name of ["SALES_EXECUTIVE", "EMPLOYEE"] as const) {
      expect(tabs(role(name)), name).toEqual([]);
      expect(
        visibleNavItems(role(name)).map((i) => i.href),
        name,
      ).not.toContain("/materials");
    }
  });
});

describe("What each role may do with raw materials", () => {
  const keys = (name: SystemRole) => materialsKeys(holding(DEFAULT_ROLE_PERMISSIONS[name]));

  it("lets buyers order and receive, and keeps paying to Accounts", () => {
    expect(keys("PRODUCTION_MANAGER")).toEqual({
      view: true,
      keepStore: true,
      buy: true,
      pay: false,
      seeCosts: true,
      catalogue: true,
      receive: true,
      undo: true,
      openingStock: true,
    });
    expect(keys("ACCOUNTS")).toEqual({
      view: true,
      keepStore: false,
      buy: false,
      pay: true,
      seeCosts: true,
      catalogue: false,
      receive: true,
      undo: true,
      openingStock: true,
    });
  });

  it("lets the store keep stock without seeing a price or buying", () => {
    expect(keys("WAREHOUSE_TEAM")).toEqual({
      view: true,
      keepStore: true,
      buy: false,
      pay: false,
      seeCosts: false,
      catalogue: true,
      receive: false,
      undo: false,
      openingStock: false,
    });
  });

  it("gives Sales Executives and employees nothing", () => {
    for (const name of ["SALES_EXECUTIVE", "EMPLOYEE"] as const) {
      expect(Object.values(keys(name)).some(Boolean), name).toBe(false);
    }
  });
});

describe("Raw material rules, in words the store understands", () => {
  const order = (
    status: "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED",
    received = false,
  ) => ({
    number: "PO-0007",
    status,
    received,
  });

  it("archives a material only once it is used up and nothing is due", () => {
    const fabric = { code: "FAB-0001", isActive: true, quantity: "12.5", onHand: "12.5 m" };
    expect(message(canArchiveMaterial(fabric, 0))).toMatch(/still has 12\.5 m in stock/);
    expect(message(canArchiveMaterial({ ...fabric, quantity: "0" }, 1))).toMatch(
      /still due on an open purchase order/,
    );
    expect(message(canArchiveMaterial({ ...fabric, quantity: "0" }, 0))).toBe("allowed");
    expect(message(canArchiveMaterial({ ...fabric, isActive: false }, 0))).toMatch(
      /already archived/,
    );
  });

  it("fixes the unit once the material is in use", () => {
    expect(message(canChangeUnit({ code: "FAB-0001", unitLabel: "m" }, 0))).toBe("allowed");
    expect(message(canChangeUnit({ code: "FAB-0001", unitLabel: "m" }, 3))).toMatch(
      /already has stock or orders in m/,
    );
  });

  it("cancels an order nothing arrived on and closes a part received one", () => {
    expect(message(canCancelOrder(order("OPEN")))).toBe("allowed");
    expect(message(canCancelOrder(order("PARTIALLY_RECEIVED", true)))).toMatch(/close it instead/);
    expect(message(canCloseOrder(order("OPEN")))).toMatch(/cancel it instead/);
    expect(message(canCloseOrder(order("PARTIALLY_RECEIVED", true)))).toBe("allowed");
    expect(message(canCloseOrder(order("CANCELLED")))).toMatch(/already cancelled/);
    expect(message(canChangeOrderLines(order("PARTIALLY_RECEIVED", true)))).toMatch(
      /lines can no longer change/,
    );
    expect(message(canChangeOrderLines(order("RECEIVED", true)))).toMatch(
      /received in full; it can no longer change/,
    );
  });

  it("voids a purchase only after its returns are voided", () => {
    const bill = {
      number: "SB-0003",
      status: "UNPAID" as const,
      activeReturns: ["DN-0001"],
      warehouseId: "w1",
    };
    expect(message(canVoidPurchase(bill))).toMatch(
      /went back to the supplier on DN-0001; void that return first/,
    );
    expect(message(canVoidPurchase({ ...bill, activeReturns: [] }))).toBe("allowed");
    expect(message(canReturnToSupplier({ ...bill, returnable: "0" }))).toMatch(/already gone back/);
    expect(message(canReturnToSupplier({ ...bill, returnable: "4.5" }))).toBe("allowed");
  });
});

describe("Raw material quantities and prices", () => {
  it("groups quantities as the company's money and names the unit", () => {
    expect(quantity("120000.5", "METER", "BDT")).toBe("1,20,000.5 m");
    expect(quantity("120000.5", "METER", "USD")).toBe("120,000.5 m");
    expect(quantity("-20", "CONE", "BDT")).toBe("−20 cones");
    expect(signedQuantity("20", "PCS", "BDT")).toBe("+20 pcs");
    expect(signedQuantity("-3.25", "KG", "BDT")).toBe("−3.25 kg");
  });

  it("says prices per one of the unit", () => {
    expect(perUnit("45.375", "METER", "BDT")).toBe("BDT 45.375 per m");
    expect(perUnit("138.00", "CONE", "BDT")).toBe("BDT 138.00 per cone");
    expect(perUnit("1.20", "PCS", "BDT")).toBe("BDT 1.20 per piece");
    expect(perUnit("900.00", "GROSS", "BDT")).toBe("BDT 900.00 per gross");
  });

  it("reads quantities typed in a form, counting pieces and cones whole", () => {
    expect(readQuantity("1,200.5", "METER")).toBe(1200.5);
    expect(readQuantity("", "METER")).toBe("Enter the quantity.");
    expect(readQuantity("0", "METER")).toBe("Enter more than zero.");
    expect(readQuantity("0", "METER", { allowZero: true })).toBe(0);
    expect(readQuantity("1.2345", "KG")).toMatch(/up to 3 decimals/);
    expect(readQuantity("2.5", "CONE")).toBe("cones are counted whole.");
    expect(readQuantity("-4", "METER")).toMatch(/Enter a number/);
  });

  it("reads prices with up to 4 decimals", () => {
    expect(readPrice("45.375")).toBe(45.375);
    expect(readPrice("0")).toBe(0);
    expect(readPrice("45.12345")).toBe("Enter a price like 45 or 45.375.");
    expect(readPrice(" ")).toBe("Enter the price per unit.");
  });
});

describe("Raw materials filters in the address bar", () => {
  it("keeps only known filters and well-formed ids", () => {
    const view = stockViewFrom({
      q: "  rib ",
      kind: "FABRIC",
      store: "bad id!",
      low: "1",
      archived: "yes",
    });
    expect(view).toEqual({
      list: "stock",
      q: "rib",
      kind: "FABRIC",
      store: undefined,
      low: true,
      archived: undefined,
    });
    expect(materialsListSearch(view)).toBe("?q=rib&kind=FABRIC&low=1");
    expect(stockListQuery(view, "c1")).toMatchObject({
      search: "rib",
      kind: "FABRIC",
      lowStock: true,
      cursor: "c1",
    });
    expect(orderViewFrom({ status: "SHIPPED", overdue: "1" })).toMatchObject({
      status: undefined,
      overdue: true,
    });
    expect(purchaseViewFrom({ status: "PARTIALLY_PAID" }).status).toBe("PARTIALLY_PAID");
    expect(issueViewFrom({ kind: "RETURN", project: "p1" })).toEqual({
      list: "issues",
      kind: "RETURN",
      project: "p1",
    });
  });

  it("clears back to an unfiltered list", () => {
    const orders = orderViewFrom({ q: "PO-1", supplier: "s1" });
    expect(isMaterialsFiltered(orders)).toBe(true);
    expect(orderListQuery(orders)).toMatchObject({ search: "PO-1", supplierId: "s1" });
    const cleared = clearedMaterialsView(orders);
    expect(cleared).toEqual({ list: "orders", q: "" });
    expect(isMaterialsFiltered(cleared)).toBe(false);
    expect(materialsListSearch(clearedMaterialsView(issueViewFrom({ kind: "ISSUE" })))).toBe("");
  });

  it("builds addresses with only the query it needs", () => {
    expect(materialsHref.newOrder()).toBe("/materials/orders/new");
    expect(materialsHref.newOrder({ material: "m1", project: "p 1" })).toBe(
      "/materials/orders/new?material=m1&project=p+1",
    );
    expect(materialsHref.newPurchase("o1")).toBe("/materials/purchases/new?order=o1");
    expect(materialsHref.newIssue("issue")).toBe("/materials/issues/new");
    expect(materialsHref.newIssue("return", "p1")).toBe(
      "/materials/issues/new?kind=return&project=p1",
    );
    expect(materialsHref.material("a/b")).toBe("/materials/stock/a%2Fb");
  });
});
