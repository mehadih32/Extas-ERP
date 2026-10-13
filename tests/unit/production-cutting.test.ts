import { describe, expect, it } from "vitest";

import {
  addUp,
  type CheckNeed,
  crossCheck,
  milestone,
  milestoneWarning,
  readCutLines,
  readEmbroideryLines,
} from "@/modules/production/cutting";

const material = (kind: string, unit: string, code = "M-1", name = "Material") => ({
  id: code,
  code,
  name,
  kind,
  unit,
});

describe("cutting milestones", () => {
  it("says done, late, due soon, on track or not set", () => {
    expect(milestone(null, false, "2026-10-13")).toEqual({ level: "UNSET", dueOn: null, days: 0 });
    expect(milestone("2026-10-10", true, "2026-10-13").level).toBe("DONE");
    expect(milestone("2026-10-10", false, "2026-10-13")).toEqual({
      level: "LATE",
      dueOn: "2026-10-10",
      days: 3,
    });
    expect(milestone("2026-10-13", false, "2026-10-13")).toMatchObject({
      level: "DUE_SOON",
      days: 0,
    });
    expect(milestone("2026-10-16", false, "2026-10-13")).toMatchObject({
      level: "DUE_SOON",
      days: 3,
    });
    expect(milestone("2026-10-17", false, "2026-10-13")).toMatchObject({
      level: "ON_TRACK",
      days: 4,
    });
  });

  it("puts a milestone that needs attention in plain words", () => {
    const late = milestone("2026-10-12", false, "2026-10-13");
    expect(milestoneWarning("Cutting", late, "40 of 140 pieces cut")).toEqual({
      level: "LATE",
      text: "Cutting is 1 day late: 40 of 140 pieces cut.",
    });
    expect(milestoneWarning("Sewing", milestone("2026-10-13", false, "2026-10-13"))).toEqual({
      level: "DUE_SOON",
      text: "Sewing is due today.",
    });
    expect(milestoneWarning("Sewing", milestone("2026-10-30", false, "2026-10-13"))).toBeNull();
  });
});

describe("cutting lines", () => {
  it("reads stored lines back, skipping an old shape rather than failing", () => {
    expect(readCutLines([{ colorName: "Navy", sizeName: "M", quantity: 4 }])).toEqual([
      { colorName: "Navy", sizeName: "M", quantity: 4 },
    ]);
    expect(readCutLines([{ quantity: 4 }])).toEqual([
      { colorName: null, sizeName: null, quantity: 4 },
    ]);
    expect(readCutLines({ pieces: 4 })).toEqual([]);
    expect(
      readEmbroideryLines([{ colorName: "Navy", sizeName: "M", sent: 5, received: 1 }]),
    ).toEqual([]);
  });

  it("adds pieces up by colour and size", () => {
    const total = addUp([
      [
        { colorName: "Navy", sizeName: "M", quantity: 4 },
        { colorName: "Navy", sizeName: "L", quantity: 2 },
      ],
      [{ colorName: "Navy", sizeName: "M", quantity: 6 }],
    ]);
    expect([...total]).toEqual([
      ["Navy|M", 10],
      ["Navy|L", 2],
    ]);
  });
});

describe("cutting cross-checks", () => {
  const cuts = addUp([
    [
      { colorName: "Navy", sizeName: "M", quantity: 40 },
      { colorName: "Navy", sizeName: "L", quantity: 20 },
    ],
  ]);

  it("stays quiet until something is cut", () => {
    const need: CheckNeed = {
      material: material("TRIM", "PCS"),
      placement: null,
      split: "TOTAL",
      perPiece: 3,
      parts: [{ colorName: null, sizeName: null, pieces: 100 }],
      held: 0,
    };
    expect(crossCheck(need, new Map())).toBeNull();
  });

  it("checks the fabric in pieces a kg against the tech pack and the pieces still to cut", () => {
    const need: CheckNeed = {
      material: material("FABRIC", "KG", "FAB-1", "Jersey"),
      placement: "Body",
      split: "COLOUR",
      perPiece: 0.25,
      parts: [
        { colorName: "Navy", sizeName: null, pieces: 100 },
        { colorName: "White", sizeName: null, pieces: 40 },
      ],
      held: 40,
    };
    // At the plan: 60 pieces use 15 kg of 40; 25 kg left cuts the other 80.
    expect(crossCheck(need, cuts)).toMatchObject({
      about: "FABRIC",
      level: "OK",
      text: "Jersey (FAB-1): 60 pieces cut, 25 kg left of 40 kg issued.",
    });
    // 16 kg for 60: 3.75 a kg against 4, 6.7% more a piece; still enough left.
    expect(crossCheck(need, cuts, { used: 16, pieces: 60 })).toMatchObject({
      level: "WARN",
      piecesPerUnit: { plan: 4, actual: 3.75 },
      text: "Jersey (FAB-1) cuts 3.75 pieces a kg against 4 in the tech pack (7% more fabric a piece).",
    });
    // Too little left for the rest.
    const short = crossCheck({ ...need, held: 20 }, cuts, { used: 16, pieces: 60 })!;
    expect(short.level).toBe("SHORT");
    expect(short.text).toBe(
      "Jersey (FAB-1) is 17.334 kg short for the 80 pieces still to cut: 4 kg left of 20 kg issued, at 0.267 kg a piece.",
    );
  });

  it("checks collars and cuffs by colour and size against what was ordered for each", () => {
    const need: CheckNeed = {
      material: material("FABRIC", "KG", "RIB-1", "Rib"),
      placement: "Collar",
      split: "COLOUR_SIZE",
      perPiece: 0.03,
      parts: [
        { colorName: "Navy", sizeName: "M", pieces: 40 },
        { colorName: "Navy", sizeName: "L", pieces: 40 },
      ],
      held: 0.5,
      ordered: new Map([
        ["Navy|M", 1.2],
        ["Navy|L", 0.5],
      ]),
    };
    const check = crossCheck(need, cuts)!;
    expect(check).toMatchObject({ about: "COLLAR_CUFF", level: "SHORT" });
    expect(check.rows).toEqual([
      { colorName: "Navy", sizeName: "L", pieces: 40, cut: 20, need: 0.6, have: 0.5, short: 0.1 },
    ]);
    expect(check.text).toBe(
      "Collar (RIB-1) is short for what was cut: Navy L 20 cut need 0.6 kg, 0.5 kg ordered.",
    );
    // Ordered enough, but not issued yet: a warning to issue the rest.
    const issued = crossCheck(
      {
        ...need,
        ordered: new Map([
          ["Navy|M", 2],
          ["Navy|L", 2],
        ]),
      },
      cuts,
    )!;
    expect(issued).toMatchObject({ level: "WARN" });
    expect(issued.text).toMatch(/60 pieces cut need 1\.8 kg; 0\.5 kg issued so far/);
    expect(
      crossCheck(
        {
          ...need,
          held: 2,
          ordered: new Map([
            ["Navy|M", 2],
            ["Navy|L", 2],
          ]),
        },
        cuts,
      )!.level,
    ).toBe("OK");
  });

  it("checks accessories against what was issued, in whole pieces", () => {
    const need: CheckNeed = {
      material: material("TRIM", "PCS", "BTN-1", "Button"),
      placement: null,
      split: "TOTAL",
      perPiece: 3.1,
      parts: [{ colorName: null, sizeName: null, pieces: 100 }],
      held: 150,
    };
    expect(crossCheck(need, cuts)).toMatchObject({
      about: "ACCESSORY",
      level: "SHORT",
      text: "Button (BTN-1) is 36 pcs short: 60 pieces cut need 186 pcs, 150 pcs issued.",
    });
    expect(crossCheck({ ...need, held: 200 }, cuts)!.level).toBe("OK");
  });
});
