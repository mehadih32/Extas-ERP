import { describe, expect, it } from "vitest";

import { byMark, identifyPartial, piecesOf } from "@/modules/retail/partial";

/* The examples of plan v6 sec 8.2: 3 pieces at 850, 1190 and 980. */
const three = piecesOf([
  { lineId: "A", quantity: 1, price: 850 },
  { lineId: "B", quantity: 1, price: 1190 },
  { lineId: "C", quantity: 1, price: 980 },
]);

describe("which pieces a customer kept (plan v6 sec 8.2)", () => {
  it("finds one answer: kept the 1190 (charge 120)", () => {
    expect(identifyPartial({ pieces: three, collected: 1310 })).toEqual({
      match: "GREEN",
      returning: ["A", "C"],
    });
  });

  it("takes a discount only when the site wrote it", () => {
    expect(identifyPartial({ pieces: three, collected: 1110, discount: 200 })).toEqual({
      match: "GREEN",
      returning: ["A", "C"],
    });
    // Without it the engine takes the 980 as kept (charge 130); it never guesses a discount.
    expect(identifyPartial({ pieces: three, collected: 1110 })).toEqual({
      match: "GREEN",
      returning: ["A", "B"],
    });
  });

  it("knows the count but not the colour for a combo of equal pieces (YELLOW)", () => {
    const combo = piecesOf([
      { lineId: "BLACK", quantity: 1, price: 530 },
      { lineId: "WHITE", quantity: 1, price: 530 },
      { lineId: "NAVY", quantity: 1, price: 530 },
    ]);
    const found = identifyPartial({ pieces: combo, collected: 660 });
    expect(found.match).toBe("YELLOW");
    expect(found.returning).toHaveLength(2);
  });

  it("treats two pieces of one line as one answer", () => {
    const two = piecesOf([{ lineId: "A", quantity: 2, price: 700 }]);
    expect(identifyPartial({ pieces: two, collected: 800 })).toEqual({
      match: "GREEN",
      returning: ["A"],
    });
  });

  it("takes a small amount below the cheapest piece as a full return", () => {
    expect(identifyPartial({ pieces: three, collected: 120 })).toEqual({
      match: "GREEN",
      returning: ["A", "B", "C"],
    });
  });

  it("goes on Hold when sets with different prices fit, or none does", () => {
    const close = piecesOf([
      { lineId: "A", quantity: 1, price: 1000 },
      { lineId: "B", quantity: 1, price: 1050 },
    ]);
    expect(identifyPartial({ pieces: close, collected: 1150 }).match).toBe("ORANGE");
    expect(identifyPartial({ pieces: three, collected: 5000 })).toEqual({
      match: "ORANGE",
      returning: null,
    });
  });

  it("follows the site's mark of kept lines", () => {
    expect(byMark(three, ["B"])).toEqual({ match: "GREEN", returning: ["A", "C"] });
  });
});
