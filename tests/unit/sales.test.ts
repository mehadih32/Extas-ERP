import { describe, expect, it } from "vitest";

import {
  advanceAmount,
  collectOrderLines,
  invoiceStatusFor,
  orderTotals,
  quotationLineQuantity,
  quotationTotals,
} from "@/modules/sales/totals";

describe("quotation totals", () => {
  it("takes the quantity from the size breakdown", () => {
    expect(quotationLineQuantity({ sizeBreakdown: { S: 20, M: 40, L: 40 } })).toBe(100);
    expect(quotationLineQuantity({ quantity: 7 })).toBe(7);
  });

  it("totals lines, discount and tax without floating-point drift", () => {
    const t = quotationTotals(
      [
        { quantity: 3, unitPrice: 0.1 },
        { quantity: 600, unitPrice: 2.5 },
      ],
      0.3,
      15,
    );
    expect(t.lineTotals.map((l) => l.toFixed(2))).toEqual(["0.30", "1500.00"]);
    expect(t.total.toFixed(2)).toBe("1515.00");
  });

  it("refuses a discount above the subtotal", () => {
    expect(() => quotationTotals([{ quantity: 1, unitPrice: 10 }], 10.01)).toThrow(/discount/);
  });
});

describe("order lines and totals", () => {
  it("expands matrix cells, skips zeros and merges repeated SKUs", () => {
    const { lines, matrixStyles } = collectOrderLines({
      lines: [{ variantId: "v1", quantity: 2 }],
      matrix: [{ styleId: "s1", unitPrice: 900, quantities: { v1: 3, v2: 0, v3: 5 } }],
    });
    expect(lines).toEqual([
      { variantId: "v1", quantity: 5, unitPrice: 900, discount: undefined },
      { variantId: "v3", quantity: 5, unitPrice: 900 },
    ]);
    expect(matrixStyles.get("v3")).toBe("s1");
  });

  it("rejects the same SKU at two prices and empty orders", () => {
    expect(() =>
      collectOrderLines({
        lines: [
          { variantId: "v1", quantity: 1, unitPrice: 100 },
          { variantId: "v1", quantity: 1, unitPrice: 90 },
        ],
      }),
    ).toThrow(/different prices/);
    expect(() => collectOrderLines({ matrix: [{ styleId: "s", quantities: { v1: 0 } }] })).toThrow(
      /at least one item/,
    );
  });

  it("applies line discounts, order discount, delivery and VAT", () => {
    const t = orderTotals(
      [
        { variantId: "a", quantity: 2, unitPrice: 1450, discount: 100 },
        { variantId: "b", quantity: 3, unitPrice: 999.99 },
      ],
      { discount: 200, shippingCharge: 120, tax: 50.5 },
    );
    expect(t.lineTotals.map((l) => l.toFixed(2))).toEqual(["2800.00", "2999.97"]);
    expect(t.netSales.toFixed(2)).toBe("5599.97");
    expect(t.total.toFixed(2)).toBe("5770.47");
    expect(() =>
      orderTotals([{ variantId: "a", quantity: 1, unitPrice: 10, discount: 11 }]),
    ).toThrow();
  });
});

describe("advance and invoice status", () => {
  it("computes the advance and rounds to the paisa", () => {
    expect(advanceAmount(12000, 30).toFixed(2)).toBe("3600.00");
    expect(advanceAmount(999.99, 33.33).toFixed(2)).toBe("333.30");
  });

  it("derives unpaid / partly paid / paid", () => {
    expect(invoiceStatusFor(100, 0)).toBe("UNPAID");
    expect(invoiceStatusFor(100, 99.99)).toBe("PARTIALLY_PAID");
    expect(invoiceStatusFor(100, 100)).toBe("PAID");
  });
});
