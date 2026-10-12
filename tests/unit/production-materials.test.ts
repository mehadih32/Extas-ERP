import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { coverNeeds } from "@/modules/production/material-need.service";
import { needFor, planNeed, roundUpFor, shareOut } from "@/modules/production/material-plan";
import { gridTable } from "@/modules/production/tech-pack.service";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const grid = [
  { colorName: "Navy", sizeName: "S", quantity: 20 },
  { colorName: "Navy", sizeName: "M", quantity: 40 },
  { colorName: "White", sizeName: "S", quantity: 10 },
  { colorName: "White", sizeName: "M", quantity: 0 },
];

describe("materials per piece", () => {
  it("rounds whole units up to whole ones and the rest up to the gram", () => {
    expect(roundUpFor("PCS", D("420.01")).toString()).toBe("421");
    expect(roundUpFor("CONE", D("2.2")).toString()).toBe("3");
    expect(roundUpFor("KG", D("29.9251")).toFixed(3)).toBe("29.926");
    expect(roundUpFor("METER", D("12")).toFixed(3)).toBe("12.000");
  });

  it("adds the wastage on top of the pieces", () => {
    const need = { perPiece: "0.285", wastagePercent: "5" };
    expect(needFor(need, "KG", 100).toFixed(3)).toBe("29.925");
    expect(needFor({ perPiece: 3, wastagePercent: 2 }, "PCS", 70).toString()).toBe("215");
    expect(needFor(need, "KG", 0).toString()).toBe("0");
  });

  it("splits a need by colour, by colour and size, or keeps one total", () => {
    const base = { perPiece: "0.5", wastagePercent: "0" };
    const total = planNeed({ ...base, split: "TOTAL" }, "KG", grid, 70);
    expect(total.parts).toEqual([
      expect.objectContaining({ colorName: null, sizeName: null, pieces: 70 }),
    ]);
    const colour = planNeed({ ...base, split: "COLOUR" }, "KG", grid, 70);
    expect(colour.parts.map((p) => [p.colorName, p.pieces, p.quantity.toString()])).toEqual([
      ["Navy", 60, "30"],
      ["White", 10, "5"],
    ]);
    const sized = planNeed({ ...base, split: "COLOUR_SIZE" }, "PCS", grid, 70);
    // Empty cells are left out; each part rounds up on its own.
    expect(sized.parts.map((p) => [p.colorName, p.sizeName, p.quantity.toString()])).toEqual([
      ["Navy", "S", "10"],
      ["Navy", "M", "20"],
      ["White", "S", "5"],
    ]);
    expect(sized.total.toString()).toBe("35");
    // Without a grid, any split is one total of the pieces.
    expect(planNeed({ ...base, split: "COLOUR" }, "KG", [], 50).parts).toHaveLength(1);
  });

  it("shares an ordered quantity out in proportion, adding up exactly", () => {
    const parts = [{ quantity: D("29.925") }, { quantity: D("11.97") }, { quantity: D("15") }];
    const shares = shareOut(D(60), parts, "KG");
    expect(shares.map((s) => s.share.toFixed(3))).toEqual(["31.558", "12.623", "15.819"]);
    expect(shares.reduce((t, s) => t.plus(s.share), D(0)).toString()).toBe("60");
    const whole = shareOut(
      D(10),
      [{ quantity: D(1) }, { quantity: D(1) }, { quantity: D(1) }],
      "PCS",
    );
    expect(whole.map((s) => s.share.toString())).toEqual(["3", "3", "4"]);
    // Nothing planned: all goes to the first part.
    expect(
      shareOut(D(5), [{ quantity: D(0) }, { quantity: D(0) }], "KG").map((s) => s.share.toString()),
    ).toEqual(["5", "0"]);
  });

  it("hands what is ordered to the needs of a material in turn", () => {
    const covered = coverNeeds(
      [
        { materialId: "rib", total: D(3) },
        { materialId: "rib", total: D(2) },
        { materialId: "btn", total: D(10) },
      ],
      (id) => (id === "rib" ? D(4) : D(0)),
    );
    expect(covered.map((c) => [c.covered.toString(), c.toOrder.toString()])).toEqual([
      ["3", "0"],
      ["1", "1"],
      ["0", "10"],
    ]);
  });

  it("prints a colour × size matrix with totals both ways", () => {
    const block = gridTable(
      "Collar",
      [
        { colorName: "Navy", sizeName: "S", value: "0.6" },
        { colorName: "Navy", sizeName: "M", value: "1.2" },
        { colorName: "White", sizeName: "M", value: "0.6" },
      ],
      (v) => v.toString(),
    );
    expect(block.kind === "table" && block.columns.map((c) => c.label)).toEqual([
      "Colour",
      "S",
      "M",
      "Total",
    ]);
    expect(block.kind === "table" && block.rows.map((r) => r.cells)).toEqual([
      ["Navy", "0.6", "1.2", "1.8"],
      ["White", "–", "0.6", "0.6"],
      ["Total", "0.6", "1.8", "2.4"],
    ]);
  });
});
