import { describe, expect, it } from "vitest";

import { pastCmTerms } from "@/modules/costing/costing-labels";
import {
  type CostLineInput,
  costLine,
  costSheet,
  grossUp,
  type PercentLines,
  profitAt,
} from "@/modules/costing/costing-math";
import {
  daysBetween,
  judgeFactory,
  judgePayment,
  judgePrice,
  judgeRisks,
  judgeTime,
} from "@/modules/costing/order-check";

/* The v6.2 costing rules (K3 4.1) and the Order check card's five checks. */

const percents = (over: Partial<PercentLines> = {}): PercentLines => ({
  sourceTax: 0,
  bankCharge: 0,
  commission: 0,
  profit: null,
  ...over,
});

const line = (over: Partial<CostLineInput> = {}): CostLineInput => ({
  quantity: 1200,
  consumption: 2.2,
  fabricPrice: 3.5,
  trimsPerDozen: 3,
  valueAddPerDozen: 2,
  otherPerDozen: 0.5,
  cmAmount: 1.2,
  cmPer: "PIECE",
  buyerPrice: null,
  ...over,
});

describe("the costing sheet's sums", () => {
  it("grosses the K3 example up: 38.77 a dozen at 1% + 0.15% + 7% profit is about 42.21", () => {
    const p = percents({ sourceTax: 1, bankCharge: 0.15, profit: 7 });
    expect(grossUp(38.77, p)! / 1).toBeCloseTo(38.77 / 0.9185, 6);
    expect(Number(grossUp(38.77, p)!.toFixed(2))).toBe(42.21);
  });

  it("has no price at profit without the owner's profit %, and none when the lines take it all", () => {
    expect(grossUp(38.77, percents())).toBeNull();
    expect(grossUp(38.77, percents({ sourceTax: 40, profit: 60 }))).toBeNull();
  });

  it("costs a style per dozen: fabric per kg × consumption, CM per piece × 12, no overhead", () => {
    const c = costLine(line(), percents({ profit: 10 }));
    expect(c.fabric).toBe(7.7);
    expect(c.cm).toBe(14.4);
    expect(c.direct).toBe(27.6);
    expect(c.costPerPiece).toBe(2.3);
    expect(c.missing).toEqual([]);
    // 27.6 ÷ 0.9 = 30.6667 a dozen, 2.5556 a piece.
    expect(c.priceAtProfit).toBe(2.5556);
    expect(c.buyerProfit).toBeNull();
  });

  it("takes the CM as it is when it is fixed per dozen", () => {
    expect(costLine(line({ cmAmount: 14.4, cmPer: "DOZEN" }), percents()).cm).toBe(14.4);
  });

  it("names what is missing and leaves it out of the cost", () => {
    const c = costLine(line({ fabricPrice: null, cmAmount: null }), percents());
    expect(c.missing).toEqual(["fabric price", "CM"]);
    expect(c.fabric).toBeNull();
    expect(c.cm).toBeNull();
    expect(c.direct).toBe(5.5);
    expect(costLine(line({ consumption: null }), percents()).missing).toEqual([
      "fabric consumption",
    ]);
  });

  it("gives the profit % the buyer's price leaves after the percent lines", () => {
    const p = percents({ sourceTax: 1, bankCharge: 0.15 });
    // At 2.80 a piece (33.60 a dozen): 1 − 0.0115 − 27.6 / 33.6 = 16.71%.
    expect(costLine(line({ buyerPrice: 2.8 }), p).buyerProfit).toBe(16.71);
    expect(profitAt(27.6, 0, p)).toBeNull();
    // Below the cost: a loss.
    expect(costLine(line({ buyerPrice: 2 }), p).buyerProfit!).toBeLessThan(0);
  });

  it("adds the styles up for the whole order", () => {
    const p = percents({ sourceTax: 1, profit: 10 });
    const sheet = costSheet(
      [line({ buyerPrice: 2.8 }), line({ quantity: 600, consumption: 3, buyerPrice: 3.2 })],
      p,
    );
    expect(sheet.pieces).toBe(1800);
    // 2.30 × 1200 + (30.4 ÷ 12 = 2.5333) × 600.
    expect(sheet.cost).toBe(4280);
    expect(sheet.valueAtBuyerPrice).toBe(5280);
    expect(sheet.profitAtBuyerPrice).toBe(Number((5280 * 0.99 - 4280).toFixed(2)));
    // (27.6 × 1200 + 30.4 × 600) ÷ 12 ÷ (1 − 0.11).
    expect(sheet.valueAtProfit).toBe(Number((4280 / 0.89).toFixed(2)));
    // One style without a buyer price: no value at the buyer's price.
    expect(costSheet([line(), line({ buyerPrice: 3 })], p).valueAtBuyerPrice).toBeNull();
    // No profit %: no value at profit.
    expect(costSheet([line()], percents()).valueAtProfit).toBeNull();
  });
});

describe("the Order check card", () => {
  const priced = (over: Partial<Parameters<typeof judgePrice>[0][number]> = {}) => ({
    ref: "PL-01",
    costPerPiece: 2.3,
    missing: [] as string[],
    buyerPrice: 2.8 as number | null,
    buyerProfit: 16.71 as number | null,
    ...over,
  });

  it("price: red below the cost, yellow below the profit % or without one, green above", () => {
    expect(judgePrice([priced({ buyerPrice: 2, buyerProfit: -16 })], 7).signal).toBe("red");
    expect(judgePrice([priced({ buyerPrice: 2, buyerProfit: -16 })], 7).reason).toContain(
      "below the cost",
    );
    expect(judgePrice([priced()], 20).signal).toBe("yellow");
    expect(judgePrice([priced()], null)).toMatchObject({
      signal: "yellow",
      reason: expect.stringContaining("Profit % not set"),
    });
    expect(judgePrice([priced()], 10)).toMatchObject({
      signal: "green",
      label: "Price vs cost",
    });
    expect(judgePrice([], 10).signal).toBe("yellow");
    expect(judgePrice([priced({ missing: ["CM"] })], 10).reason).toContain("no CM");
    expect(
      judgePrice([priced(), priced({ ref: "PL-02", buyerPrice: null, buyerProfit: null })], 10),
    ).toMatchObject({ signal: "yellow", reason: "PL-02 has no buyer price yet." });
  });

  it("time: fabric 30 + making 25 + 7 days unless given; red short, yellow with under 7 to spare", () => {
    expect(daysBetween("2026-10-14", "2026-12-15")).toBe(62);
    const t = (shipDate: string | null, fabricDays: number | null = null, makingDays = null) =>
      judgeTime({ today: "2026-10-14", shipDate, fabricDays, makingDays });
    expect(t(null).signal).toBe("yellow");
    expect(t("2026-10-01").signal).toBe("red");
    expect(t("2026-11-30")).toMatchObject({ signal: "red" }); // 47 days < 62
    expect(t("2026-12-17").signal).toBe("yellow"); // 64 days: 2 to spare
    expect(t("2026-12-30")).toMatchObject({
      signal: "green",
      reason: "77 days are left; about 62 are needed (fabric 30 and making 25 days assumed).",
    });
    expect(t("2026-12-01", 20).reason).toContain("making 25 days assumed");
  });

  it("factory: red over its monthly capacity, yellow above 85% or unset, room shown when none is picked", () => {
    const f = (booked: number, capacity: number | null) =>
      judgeFactory({
        factory: { name: "Rahim Knit", monthlyCapacity: capacity },
        booked,
        pieces: 3000,
        months: 2,
        others: [],
      });
    expect(f(8000, 5000).signal).toBe("red");
    expect(f(6000, 5000).signal).toBe("yellow"); // 9,000 of 10,000
    expect(f(5000, 5000).signal).toBe("green"); // 8,000 of 10,000
    expect(f(1000, 5000).signal).toBe("green");
    expect(f(1000, null).signal).toBe("yellow");
    expect(
      judgeFactory({
        factory: null,
        booked: 0,
        pieces: 3000,
        months: 1,
        others: [
          { name: "Full Ltd", room: -200 },
          { name: "Open Ltd", room: 4000 },
        ],
      }),
    ).toMatchObject({
      signal: "yellow",
      reason: expect.stringContaining("Open Ltd (4,000 pieces)"),
    });
  });

  it("payment: red with money overdue, yellow for a new buyer or a late invoice, green on time", () => {
    const p = (over: Partial<Parameters<typeof judgePayment>[0]>) =>
      judgePayment({
        buyer: "Nordic AB",
        invoices: 4,
        late: 0,
        overdue: null,
        currency: "BDT",
        ...over,
      });
    expect(p({ overdue: { amount: 50_000, count: 1, days: 12 } })).toMatchObject({
      signal: "red",
      reason: "BDT 50,000.00 overdue on 1 invoice(s), the oldest by 12 days.",
    });
    expect(p({ invoices: 0 }).reason).toContain("New buyer");
    expect(p({ late: 1 }).signal).toBe("yellow");
    expect(p({}).signal).toBe("green");
    expect(p({ buyer: null }).signal).toBe("yellow");
  });

  it("risks: green with none, yellow for one or two, red for three or Eid close to shipping", () => {
    expect(judgeRisks({ risks: [], eidClose: false }).signal).toBe("green");
    expect(judgeRisks({ risks: ["New buyer"], eidClose: false }).signal).toBe("yellow");
    expect(judgeRisks({ risks: ["a", "b", "c"], eidClose: false }).signal).toBe("red");
    expect(judgeRisks({ risks: ["Eid ul-Fitr on 2027-03-20"], eidClose: true }).signal).toBe("red");
  });
});

describe("The CM agreed before, beside a style", () => {
  it("shows and fills a dozen agreement as the dozen price, not the piece share", () => {
    // 125 a dozen is stored as 10.42 a piece for the money maths; the hint shows 125 a dozen.
    expect(pastCmTerms({ cm: 10.42, cmPer: "DOZEN", cmPerDozen: 125 })).toEqual({
      amount: 125,
      per: "DOZEN",
    });
    expect(pastCmTerms({ cm: 45.5, cmPer: "PIECE", cmPerDozen: null })).toEqual({
      amount: 45.5,
      per: "PIECE",
    });
    // An odd row marked per dozen without a dozen price falls back to the piece price.
    expect(pastCmTerms({ cm: 12, cmPer: "DOZEN", cmPerDozen: null })).toEqual({
      amount: 12,
      per: "PIECE",
    });
  });
});
