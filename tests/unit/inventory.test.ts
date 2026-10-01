import { describe, expect, it } from "vitest";

import { buildSku, colorSkuCode } from "@/modules/inventory/matrix.service";
import { capToAvailable, fillByPacks, fillByTotal } from "@/modules/inventory/ratio";
import { weightedAverageCost } from "@/modules/inventory/stock.service";

const ratio = [
  { sizeId: "S", ratio: 1 },
  { sizeId: "M", ratio: 2 },
  { sizeId: "L", ratio: 2 },
  { sizeId: "XL", ratio: 1 },
];

describe("ratio fill", () => {
  it("multiplies ratios by packs", () => {
    expect(Object.fromEntries(fillByPacks(ratio, 10))).toEqual({ S: 10, M: 20, L: 20, XL: 10 });
  });

  it("splits a total exactly, giving leftovers to the largest remainders", () => {
    const result = fillByTotal(ratio, 100); // exact: 16.67, 33.33, 33.33, 16.67
    expect([...result.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.fromEntries(result)).toEqual({ S: 17, M: 33, L: 33, XL: 17 });
  });

  it("handles small totals and zero ratios", () => {
    expect(Object.fromEntries(fillByTotal(ratio, 3))).toEqual({ S: 1, M: 1, L: 1, XL: 0 }); // ties: first size wins
    expect(Object.fromEntries(fillByTotal([{ sizeId: "S", ratio: 0 }], 5))).toEqual({ S: 0 });
  });

  it("caps to available stock and never goes below zero", () => {
    expect(capToAvailable(20, 7)).toBe(7);
    expect(capToAvailable(5, 7)).toBe(5);
    expect(capToAvailable(5, -3)).toBe(0);
  });
});

describe("SKU codes", () => {
  it("builds readable SKUs from style, color and size", () => {
    expect(buildSku("EX-PL-001", "Navy Blue", "XL")).toBe("EX-PL-001-NAVYBL-XL");
    expect(buildSku("EX-PL-001", "Off-White", "3XL")).toBe("EX-PL-001-OFFWHI-3XL");
    expect(colorSkuCode("!!")).toBe("CLR");
  });
});

describe("weighted average cost", () => {
  it("blends existing stock with the new receipt", () => {
    expect(weightedAverageCost(10, 100, 10, 200)).toBe(150);
  });

  it("uses the new cost when there was no stock (or negative stock)", () => {
    expect(weightedAverageCost(0, 0, 5, 250)).toBe(250);
    expect(weightedAverageCost(-3, 90, 5, 250)).toBe(250);
  });
});
