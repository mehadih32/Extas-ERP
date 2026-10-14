import { describe, expect, it } from "vitest";

import {
  completionNote,
  days,
  evenCostText,
  materialLine,
  pieces,
  plainQuantity,
  productionHref,
  remainingText,
} from "@/components/production/labels";
import {
  billListQuery,
  billViewFrom,
  clearedProductionView,
  deliveryViewFrom,
  isProductionFiltered,
  productionListSearch,
  projectListQuery,
  projectViewFrom,
} from "@/components/production/list-view";
import { visibleProductionTabs } from "@/components/production/tabs";
import { phoneTabs, visibleNavItems } from "@/components/shell/nav-items";
import type { SystemRole } from "@prisma/client";

import { DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";

const role = (name: SystemRole): string[] => [...DEFAULT_ROLE_PERMISSIONS[name]];

describe("the Production lists' filters in the address bar", () => {
  it("reads only known choices and writes them back the same way", () => {
    const view = projectViewFrom({ q: " polo ", status: "ACTIVE", stage: "SEWING" });
    expect(view).toEqual({ list: "projects", q: "polo", status: "ACTIVE", stage: "SEWING" });
    expect(productionListSearch(view)).toBe("?q=polo&status=ACTIVE&stage=SEWING");
    expect(isProductionFiltered(view)).toBe(true);
    expect(productionListSearch(clearedProductionView(view))).toBe("");
    // A finished project is found by its status, not a stage.
    expect(projectViewFrom({ stage: "COMPLETED", status: "nonsense" })).toEqual({
      list: "projects",
      q: "",
      status: undefined,
      stage: undefined,
    });
  });

  it("asks for late projects with the overdue flag, not a status", () => {
    expect(projectListQuery(projectViewFrom({ status: "OVERDUE" }))).toMatchObject({
      status: undefined,
      overdue: true,
    });
    expect(projectListQuery(projectViewFrom({ status: "ON_HOLD" }))).toMatchObject({
      status: "ON_HOLD",
      overdue: undefined,
    });
  });

  it("filters deliveries and bills by status only", () => {
    expect(deliveryViewFrom({ status: "CONFIRMED", q: "x" })).toEqual({
      list: "deliveries",
      status: "CONFIRMED",
    });
    // A PARSED delivery (read by AI) waits for the AI integration; drafts are DRAFT.
    expect(deliveryViewFrom({ status: "PARSED" }).status).toBeUndefined();
    const bills = billViewFrom({ status: "UNPAID" });
    expect(productionListSearch(bills)).toBe("?status=UNPAID");
    expect(billListQuery(bills, "c1")).toEqual({ status: "UNPAID", cursor: "c1", take: 30 });
    expect(isProductionFiltered(billViewFrom({}))).toBe(false);
  });
});

describe("Production words", () => {
  it("says how a project's target day stands", () => {
    expect(remainingText({ remainingDays: 12, overdueDays: 0, isOverdue: false })).toBe(
      "12 days left",
    );
    expect(remainingText({ remainingDays: 0, overdueDays: 0, isOverdue: false })).toBe("Due today");
    expect(remainingText({ remainingDays: -1, overdueDays: 1, isOverdue: true })).toBe(
      "1 day late",
    );
    expect(remainingText({ remainingDays: null, overdueDays: 0, isOverdue: false })).toBeNull();
    expect(days(1)).toBe("1 day");
    expect(pieces(125000, "BDT")).toBe("1,25,000 pcs");
    expect(productionHref.newDelivery("p 1")).toBe("/production/deliveries/new?project=p%201");
  });

  it("says what a piece costs once evened out, and what completing means", () => {
    expect(evenCostText({ a: "122.22", b: "122.22" }, "BDT")).toBe("BDT 122.22 a piece");
    expect(evenCostText({ a: "125.00", b: "62.50" }, "BDT")).toBe(
      "A-grade BDT 125.00, B-grade BDT 62.50 a piece",
    );
    expect(evenCostText({ a: null, b: "100.00" }, "BDT")).toBe("BDT 100.00 a piece");
    expect(evenCostText({ a: null, b: null }, "BDT")).toBe("");
    expect(completionNote({ short: 1200, perPiece: { a: "103.09", b: null } }, "BDT")).toBe(
      "The 1,200 pieces short are listed as wastage, with no loss booked. Every piece received then costs the same: BDT 103.09 a piece.",
    );
    expect(completionNote({ short: 0, perPiece: null }, "BDT")).toBe("");
  });

  it("writes a line of materials sent as one phrase", () => {
    expect(materialLine({ description: "Oxford fabric", quantity: 500, unit: "kg" }, "BDT")).toBe(
      "500 kg Oxford fabric",
    );
    expect(plainQuantity(12.5, "BDT")).toBe("12.5");
    expect(plainQuantity(120000.25, "BDT")).toBe("1,20,000.25");
    expect(plainQuantity(120000.125, "USD")).toBe("120,000.125");
    expect(plainQuantity(10, "BDT")).toBe("10");
    expect(plainQuantity(0.5, "BDT")).toBe("0.5");
  });
});

describe("Production in the menu, by role", () => {
  const tabs = (permissions: string[]) => visibleProductionTabs(permissions).map((t) => t.label);
  const inMenu = (permissions: string[]) =>
    visibleNavItems(permissions).some((item) => item.href === "/production");

  it("gives Production Managers every tab", () => {
    const manager = role("PRODUCTION_MANAGER");
    expect(inMenu(manager)).toBe(true);
    expect(tabs(manager)).toEqual([
      "Overview",
      "Batches",
      "Bookings",
      "Projects",
      "Deliveries",
      "Bills",
      "Cost heads",
      "Fault log",
    ]);
  });

  it("keeps bills, with their costs, from the store team", () => {
    const store = role("WAREHOUSE_TEAM");
    expect(inMenu(store)).toBe(true);
    expect(tabs(store)).toEqual([
      "Overview",
      "Batches",
      "Bookings",
      "Projects",
      "Deliveries",
      "Fault log",
    ]);
    // Someone who only receives goods lands on Deliveries.
    expect(tabs(["production.stock_intake"])).toEqual(["Deliveries"]);
  });

  it("shows Accounts the bills but not the cost heads to change", () => {
    expect(tabs(role("ACCOUNTS"))).toEqual([
      "Overview",
      "Batches",
      "Bookings",
      "Projects",
      "Deliveries",
      "Bills",
      "Fault log",
    ]);
  });

  it("leaves Production out for sales staff", () => {
    expect(inMenu(role("SALES_EXECUTIVE"))).toBe(false);
    expect(tabs(role("SALES_EXECUTIVE"))).toEqual([]);
  });

  it("puts Production third on the phone's tab bar", () => {
    const owner = phoneTabs(visibleNavItems(role("SUPER_ADMIN")));
    expect(owner.tabs.map((i) => i.href)).toEqual(["/", "/sales", "/production", "/accounts"]);
  });
});
