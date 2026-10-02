import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  averageCost,
  costPerUnit,
  formatQuantity,
  type Holding,
  money,
  orderStatus,
  pendingQuantity,
  removeAtValue,
  unitProblem,
  valueOut,
} from "@/modules/materials/valuation";

const d = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const holding = (quantity: Prisma.Decimal.Value, value: Prisma.Decimal.Value): Holding => ({
  quantity: d(quantity),
  value: d(value),
});

describe("moving average valuation", () => {
  it("takes goods out at the average cost, to the paisa", () => {
    // 120 m bought for 21,000.00 (175.00 a metre); 45.5 m issued.
    expect(valueOut(holding(120, 21000), d(45.5)).toFixed(2)).toBe("7962.50");
    expect(valueOut(holding(3, 10), d(1)).toFixed(2)).toBe("3.33");
  });

  it("lets the last of the stock take whatever value is left", () => {
    // 3 m worth 10.00 issued a metre at a time: 3.33 + 3.34 + 3.33 = 10.00 exactly.
    let h = holding(3, 10);
    const taken: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const value = valueOut(h, d(1));
      taken.push(value.toFixed(2));
      h = { quantity: h.quantity.minus(1), value: h.value.minus(value) };
    }
    expect(taken).toEqual(["3.33", "3.34", "3.33"]);
    expect(h.value.toFixed(2)).toBe("0.00");
  });

  it("refuses more than is on hand, or nothing at all", () => {
    expect(() => valueOut(holding(10, 100), d(10.001))).toThrow(RangeError);
    expect(() => valueOut(holding(10, 100), d(0))).toThrow(RangeError);
  });

  it("sends goods back at the bill price and reports the cost difference", () => {
    // Bought 100 m at 10 and 100 m at 20: 200 m worth 3,000. Send back the 10-a-metre lot.
    expect(removeAtValue(holding(200, 3000), d(100), d(1000))).toEqual({
      removed: d(1000),
      difference: d(0),
    });
    // The stock carries less than the bill price: it gives up what it has.
    expect(removeAtValue(holding(150, 862.5), d(100), d(2000))).toEqual({
      removed: d(862.5),
      difference: d(1137.5),
    });
    // The last of the stock always takes all the value that is left.
    expect(removeAtValue(holding(100, 2000), d(100), d(1000))).toEqual({
      removed: d(2000),
      difference: d(-1000),
    });
  });

  it("works out average and unit costs", () => {
    expect(averageCost(holding(120, 21000), d(0)).toFixed(4)).toBe("175.0000");
    expect(averageCost(holding(3, 10), d(0)).toFixed(4)).toBe("3.3333");
    // Nothing on hand: the last known average stays.
    expect(averageCost(holding(0, 0), d(175)).toFixed(4)).toBe("175.0000");
    expect(costPerUnit(d(-7962.5), d(-45.5), d(0)).toFixed(4)).toBe("175.0000");
    expect(costPerUnit(d(0), d(0), d(12.5)).toFixed(4)).toBe("12.5000");
    expect(money(d("10.005")).toFixed(2)).toBe("10.01");
  });
});

describe("units", () => {
  it("counts pieces, rolls, cones and sets whole", () => {
    expect(unitProblem("PCS", d(2.5))).toBe("pcs are counted whole; 2.5 is not a whole number.");
    expect(unitProblem("CONE", d(12))).toBeNull();
    expect(unitProblem("METER", d(120.25))).toBeNull();
    expect(unitProblem("KG", d(3.125))).toBeNull();
  });

  it("formats quantities with their unit", () => {
    expect(formatQuantity(d(120.5), "METER")).toBe("120.5 m");
    expect(formatQuantity("500", "PCS")).toBe("500 pcs");
    expect(formatQuantity(2, "DOZEN")).toBe("2 dozen");
  });
});

describe("purchase order status", () => {
  const line = (quantity: number, receivedQty: number) => ({
    quantity: d(quantity),
    receivedQty: d(receivedQty),
  });

  it("follows what has arrived", () => {
    expect(orderStatus("OPEN", [line(100, 0), line(50, 0)])).toBe("OPEN");
    expect(orderStatus("OPEN", [line(100, 40), line(50, 0)])).toBe("PARTIALLY_RECEIVED");
    expect(orderStatus("PARTIALLY_RECEIVED", [line(100, 100), line(50, 52)])).toBe("RECEIVED");
    // A void bill can take an order back to open.
    expect(orderStatus("RECEIVED", [line(100, 0)])).toBe("OPEN");
  });

  it("keeps closed and cancelled orders as they are", () => {
    expect(orderStatus("CLOSED", [line(100, 100)])).toBe("CLOSED");
    expect(orderStatus("CANCELLED", [line(100, 0)])).toBe("CANCELLED");
  });

  it("never shows less than nothing still to come", () => {
    expect(pendingQuantity(line(100, 40)).toString()).toBe("60");
    expect(pendingQuantity(line(100, 104.5)).toString()).toBe("0");
  });
});
