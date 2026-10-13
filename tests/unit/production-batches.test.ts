import { describe, expect, it } from "vitest";

import { typedRatio } from "@/components/production/target-grid";
import { fillByTotal } from "@/modules/inventory/ratio";
import { batchState } from "@/modules/production/batch.service";
import { batchCostGuard, costGuard, guardWorsened } from "@/modules/production/cost-guard";

describe("the cost guard", () => {
  it("compares the cost per piece so far with the target price", () => {
    expect(costGuard(4000, 100, 50)).toMatchObject({ level: "OK", percent: 80 });
    expect(costGuard(4000, 100, 50)!.perPiece.toFixed(2)).toBe("40.00");
    expect(costGuard(4000, 100, 50)!.leftPerPiece.toFixed(2)).toBe("10.00");
    // Yellow from 85% of the target, red from 100%.
    expect(costGuard(4250, 100, 50)!.level).toBe("NEAR");
    expect(costGuard(4249, 100, 50)!.level).toBe("OK");
    expect(costGuard(5000, 100, 50)!.level).toBe("OVER");
    expect(costGuard(6000, 100, 50)).toMatchObject({ level: "OVER", percent: 120 });
    expect(costGuard(6000, 100, 50)!.leftPerPiece.toFixed(2)).toBe("0.00");
  });

  it("is off without a target price or pieces", () => {
    expect(costGuard(100, 10, null)).toBeNull();
    expect(costGuard(100, 10, undefined)).toBeNull();
    expect(costGuard(100, 0, 50)).toBeNull();
    expect(costGuard(100, 10, 0)).toBeNull();
  });

  it("only alerts when the guard gets worse", () => {
    expect(guardWorsened(null, "NEAR")).toBe(true);
    expect(guardWorsened("OK", "NEAR")).toBe(true);
    expect(guardWorsened("NEAR", "OVER")).toBe(true);
    expect(guardWorsened("OK", "OVER")).toBe(true);
    expect(guardWorsened("NEAR", "NEAR")).toBe(false);
    expect(guardWorsened("OVER", "NEAR")).toBe(false);
    expect(guardWorsened(null, "OK")).toBe(false);
    expect(guardWorsened("NEAR", null)).toBe(false);
  });

  it("adds up a batch over the styles with a target price", () => {
    const guard = batchCostGuard([
      { totalCost: 3000, targetQuantity: 100, targetUnitCost: 50 }, // 5,000 allowed
      { totalCost: 2000, targetQuantity: 50, targetUnitCost: 60 }, // 3,000 allowed
      { totalCost: 9999, targetQuantity: 10, targetUnitCost: null }, // not guarded
    ])!;
    expect(guard.budget.toFixed(2)).toBe("8000.00");
    expect(guard.spent.toFixed(2)).toBe("5000.00");
    expect(guard.left.toFixed(2)).toBe("3000.00");
    expect(guard).toMatchObject({ level: "OK", percent: 62, styles: 2 });
    expect(batchCostGuard([{ totalCost: 1, targetQuantity: 1, targetUnitCost: null }])).toBeNull();
    expect(batchCostGuard([])).toBeNull();
  });
});

describe("a batch's state", () => {
  it("follows its styles", () => {
    expect(batchState([])).toBe("EMPTY");
    expect(batchState(["PLANNED", "PLANNED"])).toBe("PLANNED");
    expect(batchState(["PLANNED", "COMPLETED"])).toBe("PLANNED");
    expect(batchState(["PLANNED", "ACTIVE"])).toBe("ACTIVE");
    expect(batchState(["ON_HOLD", "COMPLETED"])).toBe("ACTIVE");
    expect(batchState(["COMPLETED", "CANCELLED"])).toBe("DONE");
    expect(batchState(["CANCELLED"])).toBe("DONE");
  });
});

describe("filling by size ratio", () => {
  const sizes = ["s", "m", "l", "xl"];

  it("reads a typed ratio against the style's sizes in order", () => {
    expect(typedRatio("1:2:2:1", sizes)).toEqual([
      { sizeId: "s", ratio: 1 },
      { sizeId: "m", ratio: 2 },
      { sizeId: "l", ratio: 2 },
      { sizeId: "xl", ratio: 1 },
    ]);
    expect(typedRatio("1 2 2", sizes)).toHaveLength(3);
    expect(typedRatio("1,2, 2/1", sizes)).toHaveLength(4);
    expect(typedRatio("1:2:2:1:1", sizes)).toBeNull();
    expect(typedRatio("0:0", sizes)).toBeNull();
    expect(typedRatio("a:b", sizes)).toBeNull();
    expect(typedRatio("", sizes)).toBeNull();
  });

  it("always adds up to the pieces given", () => {
    const split = fillByTotal(typedRatio("1:2:2:1", sizes)!, 600);
    expect(Object.fromEntries(split)).toEqual({ s: 100, m: 200, l: 200, xl: 100 });
    const odd = fillByTotal(typedRatio("1:2:2:1", sizes)!, 601);
    expect([...odd.values()].reduce((a, b) => a + b, 0)).toBe(601);
  });
});
