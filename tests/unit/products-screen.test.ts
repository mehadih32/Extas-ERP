import { BadStockSource, StockMovementType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  badStockDays,
  badStockPeriodFrom,
  badStockSearch,
} from "@/components/products/bad-stock-view";
import { matrixChange, parentChoices } from "@/components/products/catalog-helpers";
import {
  countLines,
  countSearch,
  countTotals,
  countViewFrom,
  openingLines,
  readPieces,
  shelfNumbers,
  shortage,
} from "@/components/products/count-sheet";
import { readAmount } from "@/components/products/form-values";
import { canDeleteWarehouse } from "@/modules/inventory/rules";
import { COLOR_PRESETS } from "@/components/products/setup/color-presets";
import {
  BAD_STOCK_SOURCE_CHOICES,
  BAD_STOCK_SOURCE_LABELS,
  MOVEMENT_LABELS,
  money,
  pieces,
  signed,
} from "@/components/products/labels";
import {
  looksLikeCode,
  styleListQuery,
  styleListSearch,
  styleListViewFrom,
} from "@/components/products/style-list-view";
import { visibleProductsTabs } from "@/components/products/tabs";
import { activeTabHref, visibleNavItems } from "@/components/shell/nav-items";
import { createColorSchema } from "@/modules/inventory/schemas";
import { DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";

const tabs = (permissions: readonly string[]) =>
  visibleProductsTabs(permissions).map((t) => t.label);
const hasProducts = (permissions: readonly string[]) =>
  visibleNavItems([...permissions]).some((item) => item.href === "/products");

describe("the Products area", () => {
  it("is in the menu for people who may see the stock", () => {
    expect(hasProducts(["inventory.view"])).toBe(true);
    expect(hasProducts(["inventory.manage", "sales.view", "accounts.view"])).toBe(false);
    expect(hasProducts(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN)).toBe(true);
    expect(hasProducts(DEFAULT_ROLE_PERMISSIONS.PRODUCTION_MANAGER)).toBe(true);
    expect(hasProducts(DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE)).toBe(true);
    expect(hasProducts(DEFAULT_ROLE_PERMISSIONS.WAREHOUSE_TEAM)).toBe(true);
    // Accounts and Employees do not see the stock by default.
    expect(hasProducts(DEFAULT_ROLE_PERMISSIONS.ACCOUNTS)).toBe(false);
    expect(hasProducts(DEFAULT_ROLE_PERMISSIONS.EMPLOYEE)).toBe(false);
  });

  it("shows the stock count only to people who may change stock", () => {
    expect(tabs(["inventory.view"])).toEqual([
      "Styles",
      "Archived styles",
      "Damage & QC Rejects",
      "Setup",
    ]);
    expect(tabs(["inventory.view", "inventory.manage"])).toEqual([
      "Styles",
      "Archived styles",
      "Stock count",
      "Damage & QC Rejects",
      "Setup",
    ]);
    expect(tabs(DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE)).toEqual([
      "Styles",
      "Archived styles",
      "Damage & QC Rejects",
      "Setup",
    ]);
    expect(tabs(DEFAULT_ROLE_PERMISSIONS.WAREHOUSE_TEAM)).toHaveLength(5);
    expect(tabs(DEFAULT_ROLE_PERMISSIONS.ACCOUNTS)).toEqual([]);
  });

  it("marks the tab a page belongs to", () => {
    const hrefs = visibleProductsTabs(["inventory.view", "inventory.manage"]).map((t) => t.href);
    expect(activeTabHref("/products", hrefs)).toBe("/products");
    expect(activeTabHref("/products/new", hrefs)).toBe("/products");
    expect(activeTabHref("/products/cm1abc/edit", hrefs)).toBe("/products");
    expect(activeTabHref("/products/archived", hrefs)).toBe("/products/archived");
    expect(activeTabHref("/products/stock-count", hrefs)).toBe("/products/stock-count");
    expect(activeTabHref("/products/bad-stock", hrefs)).toBe("/products/bad-stock");
    expect(activeTabHref("/products/setup", hrefs)).toBe("/products/setup");
    expect(activeTabHref("/products-old", hrefs)).toBeUndefined();
    expect(activeTabHref("/settings/team", ["/settings/team", "/settings/roles"])).toBe(
      "/settings/team",
    );
  });
});

describe("the style list filters", () => {
  it("round-trip through the address bar and drop anything malformed", () => {
    const view = styleListViewFrom({ q: "  polo ", category: "cm1cat", brand: "not an id!" });
    expect(view).toEqual({ q: "polo", category: "cm1cat", brand: undefined, archived: false });
    expect(styleListSearch(view)).toBe("?q=polo&category=cm1cat");
    expect(styleListSearch(styleListViewFrom({}))).toBe("");
    expect(styleListQuery(view, "cm1next")).toEqual({
      search: "polo",
      categoryId: "cm1cat",
      brandId: undefined,
      archived: undefined,
      cursor: "cm1next",
      take: 24,
    });
    // The Archived styles tab lists archived styles only; the address does not decide it.
    const archived = styleListViewFrom({ archived: "1" }, true);
    expect(styleListSearch(archived)).toBe("");
    expect(styleListQuery(archived).archived).toBe(true);
    expect(styleListViewFrom({ archived: "1" }).archived).toBe(false);
  });

  it("look a search up as a SKU or barcode only when it could be one", () => {
    expect(looksLikeCode("EX-PL-001-NAVY-XL")).toBe(true);
    expect(looksLikeCode("8801234567890")).toBe(true);
    expect(looksLikeCode("classic polo")).toBe(false);
    expect(looksLikeCode("ab")).toBe(false);
  });
});

describe("the stock count sheet", () => {
  const cells = [
    { variantId: "a", sku: "P-NAVY-S", onShelf: 10 },
    { variantId: "b", sku: "P-NAVY-M", onShelf: 5 },
    { variantId: "c", sku: "P-WHITE-S", onShelf: 0 },
    { variantId: "d", sku: "P-WHITE-M", onShelf: 2 },
  ];

  it("reads whole pieces only", () => {
    expect(readPieces("")).toEqual({ kind: "empty" });
    expect(readPieces(" 12 ")).toEqual({ kind: "pieces", value: 12 });
    expect(readPieces("0")).toEqual({ kind: "pieces", value: 0 });
    expect(readPieces("1.5").kind).toBe("invalid");
    expect(readPieces("-3").kind).toBe("invalid");
    expect(readPieces("2000000").kind).toBe("invalid");
  });

  it("counts the SKUs typed, and what differs from the shelf", () => {
    const { lines, invalid } = countLines(cells, { a: "8", b: "5", c: "3", d: "x" });
    expect(invalid).toEqual(["P-WHITE-M"]);
    expect(lines.map((l) => [l.sku, l.counted, l.difference])).toEqual([
      ["P-NAVY-S", 8, -2],
      ["P-NAVY-M", 5, 0],
      ["P-WHITE-S", 3, 3],
    ]);
    expect(countTotals(lines)).toEqual({ counted: 3, changed: 2, added: 3, removed: 2 });
  });

  it("notes a shortage: the pieces missing and, with every cost known, their value", () => {
    const costed = cells.map((c, i) => ({ ...c, unitCost: ["412.3333", "400.00", "1", null][i]! }));
    const { lines } = countLines(costed, { a: "7", b: "4", c: "5" });
    const short = shortage(lines);
    expect(short.lines.map((l) => [l.sku, l.difference])).toEqual([
      ["P-NAVY-S", -3],
      ["P-NAVY-M", -1],
    ]);
    // Each line rounded to the paisa, as the books round them: 1237.00 + 400.00.
    expect(short).toMatchObject({ pieces: 4, value: "1637.00" });
    // A SKU short whose cost is hidden hides the total.
    const hidden = shortage(countLines(costed, { a: "9", d: "1" }).lines);
    expect(hidden).toMatchObject({ pieces: 2, value: null });
    expect(shortage(countLines(cells, { a: "1" }).lines)).toMatchObject({ pieces: 9, value: null });
    expect(shortage(countLines(cells, { a: "10" }).lines)).toMatchObject({
      pieces: 0,
      value: null,
    });
  });

  it("adds opening stock for the SKUs given more than nothing", () => {
    const { lines, invalid } = openingLines(cells, { a: "12", b: "0", c: "" });
    expect(invalid).toEqual([]);
    expect(lines.map((l) => [l.sku, l.quantity])).toEqual([["P-NAVY-S", 12]]);
  });

  it("can start every box from the shelf", () => {
    expect(shelfNumbers(cells)).toEqual({ a: "10", b: "5", c: "0", d: "2" });
  });

  it("keeps its choices in the address bar", () => {
    const view = countViewFrom({ style: "cm1style", grade: "b", mode: "opening" });
    expect(view).toEqual({
      style: "cm1style",
      warehouse: undefined,
      grade: "B_GRADE",
      mode: "OPENING",
    });
    expect(countSearch(view)).toBe("?style=cm1style&grade=b&mode=opening");
    expect(countSearch(countViewFrom({ grade: "x", mode: "?" }))).toBe("");
  });
});

describe("deleting a warehouse", () => {
  const empty = { pieces: 0, materials: 0, orders: 0, deliveries: 0 };
  const why = (hold: Partial<typeof empty>, others = 1) => {
    const verdict = canDeleteWarehouse({ hold: { ...empty, ...hold }, others });
    return verdict.ok ? "ok" : verdict.message;
  };

  it("is allowed only for an empty warehouse that is not the last one", () => {
    expect(why({})).toBe("ok");
    expect(why({}, 0)).toBe("This is the only warehouse. Add another one before deleting it.");
    expect(why({ pieces: 1 })).toBe(
      "It still holds stock (1 piece). Sell, issue or count it down to 0 first.",
    );
    expect(why({ pieces: 120, materials: 3 })).toBe(
      "It still holds stock (120 pieces and 3 raw materials). Sell, issue or count it down to 0 first.",
    );
    expect(why({ orders: 1 })).toBe("1 open order still uses it. Finish or cancel it first.");
    expect(why({ orders: 2, deliveries: 1 })).toBe(
      "2 open orders and 1 delivery from production still use it. Finish or cancel them first.",
    );
  });
});

describe("the catalogue forms", () => {
  it("read amounts with up to two decimals", () => {
    expect(readAmount("")).toBeNull();
    expect(readAmount("950")).toBe(950);
    expect(readAmount("1,450.50")).toBe(1450.5);
    expect(readAmount("9.999")).toBe("invalid");
    expect(readAmount("abc")).toBe("invalid");
    expect(readAmount("2000000000")).toBe("invalid");
  });

  it("count the SKUs that ticking and unticking colours and sizes adds and removes", () => {
    const cells = ["a", "b"].flatMap((colorId) =>
      ["s", "m"].map((sizeId) => ({ colorId, sizeId })),
    );
    const set = (...ids: string[]) => new Set(ids);
    expect(matrixChange([], set("a", "b"), set("s", "m", "l", "xl"))).toEqual({
      adding: 8,
      removing: 0,
    });
    // A new colour in the two sizes.
    expect(matrixChange(cells, set("a", "b", "c"), set("s", "m"))).toEqual({
      adding: 2,
      removing: 0,
    });
    // Size m unticked, size l ticked: a and b lose m and gain l.
    expect(matrixChange(cells, set("a", "b"), set("s", "l"))).toEqual({ adding: 2, removing: 2 });
    expect(matrixChange(cells, set("a"), set("s", "m"))).toEqual({ adding: 0, removing: 2 });
    expect(matrixChange(cells, set("a", "b"), set("s", "m"))).toEqual({ adding: 0, removing: 0 });
  });

  it("offer quick-pick colours the colour form accepts, each once", () => {
    for (const preset of COLOR_PRESETS) {
      expect(createColorSchema.parse({ name: preset.name, hexCode: preset.hex }).hexCode).toBe(
        preset.hex,
      );
    }
    expect(new Set(COLOR_PRESETS.map((p) => p.name.toLowerCase())).size).toBe(COLOR_PRESETS.length);
    expect(new Set(COLOR_PRESETS.map((p) => p.hex)).size).toBe(COLOR_PRESETS.length);
  });

  it("never move a category inside itself", () => {
    const tree = [
      { id: "tops", depth: 0 },
      { id: "polos", depth: 1 },
      { id: "long", depth: 2 },
      { id: "tees", depth: 1 },
      { id: "bottoms", depth: 0 },
    ];
    expect(parentChoices(tree, "polos").map((c) => c.id)).toEqual(["tops", "tees", "bottoms"]);
    expect(parentChoices(tree, "tops").map((c) => c.id)).toEqual(["bottoms"]);
    expect(parentChoices(tree).map((c) => c.id)).toHaveLength(5);
  });
});

describe("the bad stock period", () => {
  it("defaults to all time and keeps other periods in the address bar", () => {
    expect(badStockPeriodFrom({})).toBe("ALL");
    expect(badStockPeriodFrom({ period: "this-month" })).toBe("THIS_MONTH");
    expect(badStockPeriodFrom({ period: "all" })).toBe("ALL");
    expect(badStockSearch("LAST_MONTH")).toBe("?period=last-month");
    expect(badStockSearch("ALL")).toBe("");
    expect(badStockDays("ALL", "2026-10-03", 7)).toEqual({});
    expect(badStockDays("THIS_MONTH", "2026-10-03", 7)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
});

describe("the Products words", () => {
  it("name every kind of stock movement and bad stock", () => {
    expect(Object.keys(MOVEMENT_LABELS).sort()).toEqual(Object.values(StockMovementType).sort());
    expect(Object.keys(BAD_STOCK_SOURCE_LABELS).sort()).toEqual(
      Object.values(BadStockSource).sort(),
    );
    // Sales returns put their pieces here themselves, never from the form.
    expect(BAD_STOCK_SOURCE_CHOICES.map((c) => c.value)).not.toContain("RETURN_QC");
  });

  it("write pieces, changes and amounts", () => {
    expect(pieces(1, "BDT")).toBe("1 piece");
    expect(pieces(124500, "BDT")).toBe("1,24,500 pieces");
    expect(signed(3, "BDT")).toBe("+3");
    expect(signed(-1200, "USD")).toBe("−1,200");
    expect(signed(0, "BDT")).toBe("0");
    expect(money("1450.00", "BDT")).toBe("BDT 1,450.00");
  });
});
