import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { gradeCost, gradeCostData, removeAtCost } from "@/modules/inventory/costs";
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

describe("grade costs", () => {
  const costs = { avgCost: new Prisma.Decimal(400), bGradeAvgCost: new Prisma.Decimal(150) };
  const fixed = (removal: { average: Prisma.Decimal; removed: Prisma.Decimal }) => [
    removal.average.toFixed(4),
    removal.removed.toFixed(4),
  ];

  it("keeps one average cost per grade, to 4 decimals", () => {
    expect(gradeCost(costs, "A_GRADE").toFixed(2)).toBe("400.00");
    expect(gradeCost(costs, "B_GRADE").toFixed(2)).toBe("150.00");
    const a = gradeCostData("A_GRADE", 85.123456);
    expect(Object.keys(a)).toEqual(["avgCost"]);
    expect(a.avgCost?.toFixed(4)).toBe("85.1235");
    const b = gradeCostData("B_GRADE", "52.38095");
    expect(Object.keys(b)).toEqual(["bGradeAvgCost"]);
    expect(b.bGradeAvgCost?.toFixed(4)).toBe("52.3810");
  });

  it("takes pieces back out at the cost they came in at, restoring the average", () => {
    // 10 on hand at 40, then 30 came in at 100 (average 85): taking the 30 out leaves 40.
    expect(fixed(removeAtCost(40, 85, 30, 100))).toEqual(["40.0000", "3000.0000"]);
  });

  it("takes all the value when no pieces are left, keeping the last average", () => {
    expect(fixed(removeAtCost(10, 55, 10, 100))).toEqual(["55.0000", "550.0000"]);
    // Sold past zero: nothing is valued, nothing leaves.
    expect(fixed(removeAtCost(-2, 50, 3, 40))).toEqual(["50.0000", "0.0000"]);
  });

  it("never leaves a negative value: the pieces left keep cost 0", () => {
    // 15 on hand at 55 (825) cannot give back 10 pieces at 100 (1,000).
    expect(fixed(removeAtCost(15, 55, 10, 100))).toEqual(["0.0000", "825.0000"]);
  });
});
