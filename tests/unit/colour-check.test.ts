import { describe, expect, it } from "vitest";

import {
  adviseRounds,
  checkOption,
  deltaCmc,
  deltaE76,
  visualOnly,
} from "@/modules/production/colour-check";

/* The lab dip colour check (X06), against the blueprint's worked navy example. */

describe("lab dip colour check", () => {
  it("gives the blueprint's ΔE CMC 2:1 and ΔE*ab for the navy example", () => {
    const std = { L: 22, a: 1.5, b: -22 };
    const batch = { L: 22.6, a: 1.2, b: -21 };
    const cmc = deltaCmc(std, batch);
    expect(cmc.dE).toBeCloseTo(0.78, 2);
    expect(cmc.dL).toBeCloseTo(0.6, 5);
    expect(cmc.dC).toBeCloseTo(-1.02, 2);
    expect(deltaE76(std, batch)).toBeCloseTo(1.2, 2);
    // The same pair passes CMC 2:1 at 1.0 but would fail a plain ΔE*ab limit of 1.0.
    expect(checkOption({ deltaE: cmc.dE }, 1).verdict).toBe("PASS");
  });

  it("fails above the limit, fails a metamerism index above 1, and warns from 0.5", () => {
    expect(checkOption({ deltaE: 1.2 }, 1)).toMatchObject({ verdict: "FAIL" });
    expect(checkOption({ deltaE: 0.6, mi: 1.3 }, 1).verdict).toBe("FAIL");
    expect(checkOption({ deltaE: 0.6, mi: 1.3 }, 1).why).toContain("change the recipe");
    const doubtful = checkOption({ deltaE: 0.6, mi: 0.7 }, 1);
    expect(doubtful.verdict).toBe("PASS");
    expect(doubtful.warning).toContain("second light");
    expect(checkOption({ deltaE: 0.6, mi: 0.2 }, 1).warning).toBeNull();
    // A tighter buyer limit.
    expect(checkOption({ deltaE: 0.78 }, 0.5).verdict).toBe("FAIL");
  });

  it("picks the closest option, sends up to three passing ones and asks for BCD after two failed rounds", () => {
    const round1 = [
      { round: 1, letter: "A", deltaE: 1.4 },
      { round: 1, letter: "B", deltaE: 0.62 },
      { round: 1, letter: "C", deltaE: 0.9, mi: 1.2 },
      { round: 1, letter: "D", deltaE: 0.85 },
      { round: 1, letter: "E", deltaE: 0.4 },
      { round: 1, letter: "F", deltaE: 0.95 },
    ];
    const advice = adviseRounds(round1, 1);
    expect(advice.closest).toBe("E");
    expect(advice.send).toEqual(["E", "B", "D"]);
    expect(advice.next).toContain("No bulk dyeing");

    const failed1 = [
      { round: 1, letter: "A", deltaE: 1.6 },
      { round: 1, letter: "B", deltaE: 1.3 },
    ];
    expect(adviseRounds(failed1, 1).next).toContain("round 2, closer to B");
    const failed2 = [...failed1, { round: 2, letter: "A", deltaE: 1.1 }];
    expect(adviseRounds(failed2, 1).next).toContain("best can do (BCD)");
    expect(adviseRounds([], 1).next).toContain("ΔE CMC 2:1");
  });

  it("keeps heather, white, neon and French terry for the eye only", () => {
    expect(visualOnly("Grey Heather")).toBe(true);
    expect(visualOnly("Optic White")).toBe(true);
    expect(visualOnly("Neon Green")).toBe(true);
    expect(visualOnly("Navy French Terry")).toBe(true);
    expect(visualOnly("Navy")).toBe(false);
    expect(adviseRounds([{ round: 1, letter: "A", deltaE: 0.3 }], 1, "Grey Heather").send).toEqual(
      [],
    );
  });
});
