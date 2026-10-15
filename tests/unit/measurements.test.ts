import { describe, expect, it } from "vitest";

import {
  chartSignals,
  convertMeasure,
  gradeChart,
  inchText,
  judgeChestBasis,
  roundMeasure,
} from "@/modules/production/measurements";

/* The full chart from a few points (S21), checked against the blueprint's worked examples. */

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
const row = (chart: ReturnType<typeof gradeChart>, code: string) =>
  chart.rows.find((r) => r.code === code)!;
const values = (chart: ReturnType<typeof gradeChart>, code: string) =>
  SIZES.map((s) => row(chart, code).values[s]);

describe("full measurement chart from a few points", () => {
  it("grades the regular polo of the worked example (S chest 40 full, grade 2, length 28)", () => {
    const chart = gradeChart({
      item: "POLO",
      unit: "INCH",
      sizes: SIZES,
      baseSize: "S",
      chest: 40,
      chestBasis: "AUTO",
      chestGrade: 2,
      length: 28,
    });
    expect(chart.chestBasis).toBe("FULL");
    expect(values(chart, "CHEST")).toEqual([40, 42, 44, 46, 48, 50]);
    expect(values(chart, "LENGTH")).toEqual([28, 28.5, 29, 29.5, 30, 30.5]);
    expect(values(chart, "SHOULDER")).toEqual([17, 17.5, 18, 18.5, 19, 19.5]);
    expect(values(chart, "ARMHOLE")).toEqual([8.75, 9, 9.25, 9.5, 9.75, 10]);
    expect(values(chart, "BICEP")).toEqual([8.5, 8.75, 9, 9.25, 9.5, 9.75]);
    expect(values(chart, "SLEEVE")).toEqual([8.75, 9, 9.25, 9.5, 9.75, 10]);
    expect(values(chart, "SLEEVE_OPENING")).toEqual([7, 7.25, 7.5, 7.75, 8, 8.25]);
    expect(values(chart, "NECK_WIDTH")).toEqual([6.5, 6.75, 7, 7.25, 7.5, 7.75]);
    expect(values(chart, "FRONT_NECK_DROP")).toEqual([3.5, 3.625, 3.75, 3.875, 4, 4.125]);
    expect(values(chart, "PLACKET_LENGTH")).toEqual([4.5, 4.5, 4.5, 4.5, 4.5, 4.5]);
    // The polo collar follows the neckline (v4 fix), not the shirt basis.
    expect(values(chart, "COLLAR_LENGTH")).toEqual([15.75, 16.375, 17, 17.625, 18.25, 18.875]);
    // Collar height, placket and cuff height are the same at every size.
    expect(new Set(values(chart, "COLLAR_HEIGHT"))).toEqual(new Set([3]));
    expect(values(chart, "FRONT_LENGTH")).toEqual([26.5, 27, 27.5, 28, 28.5, 29]);
    // Cuff length = 2 × half opening + ¾" (L: 2 × 7.5 + 0.75 = 15.75).
    expect(row(chart, "CUFF_LENGTH").values.L).toBe(15.75);

    // The buyer's points are locked; the rest is the rules' guess.
    expect(row(chart, "CHEST").sources).toMatchObject({ S: "BUYER", M: "RULE" });
    expect(row(chart, "LENGTH").sources).toMatchObject({ S: "BUYER", L: "RULE" });
    expect(row(chart, "SHOULDER").rule).toBe("0.85 × half chest");
    // The mandatory question about 3XL.
    expect(chart.questions).toEqual([
      expect.stringMatching(/^3XL comes out at 50" full chest.*about 56"/),
    ]);
    // Tolerances (7.6); the chest stays below half its grade.
    expect(row(chart, "CHEST").tolerance).toBe(0.5);
    expect(row(chart, "COLLAR_HEIGHT").tolerance).toBe(0.0625);
    expect(row(chart, "SLEEVE").tolerance).toBe(0.375);
  });

  it("uses the owner's own chest run and grades the rest by how much the chest grows", () => {
    const chart = gradeChart({
      item: "POLO",
      unit: "INCH",
      sizes: SIZES,
      baseSize: "S",
      chest: 40,
      chestBasis: "FULL",
      chestBySize: { S: 40, M: 42.5, L: 45, XL: 47.5, "2XL": 50, "3XL": 52 },
      length: 28,
    });
    expect(values(chart, "CHEST")).toEqual([40, 42.5, 45, 47.5, 50, 52]);
    expect(row(chart, "CHEST").sources).toMatchObject({ S: "BUYER", M: "OWNER", "3XL": "OWNER" });
    // Shoulder ½" per 2" of chest: +0.625 per 2.5" step, rounded to ⅛.
    expect(values(chart, "SHOULDER")).toEqual([17, 17.625, 18.25, 18.875, 19.5, 20]);
    // No 3XL question: the owner chose the run.
    expect(chart.questions).toEqual([]);
  });

  it("reads a half chest, works in centimetres and asks for what is missing", () => {
    const half = gradeChart({
      item: "TEE",
      unit: "INCH",
      sizes: ["S", "M", "L"],
      baseSize: "M",
      chest: 21,
      chestBasis: "AUTO",
      chestGrade: 1,
    });
    expect(half.chestBasis).toBe("HALF");
    expect(half.rows[0]!.name).toBe("Chest, half");
    expect(half.rows[0]!.values).toEqual({ S: 20, M: 21, L: 22 });
    // Shoulder from the full chest of 42": 0.85 × 21 = 17.85 → 17⅞.
    expect(half.rows.find((r) => r.code === "SHOULDER")!.values.M).toBe(17.875);
    // No length: the row is missing (red) and asked for.
    expect(half.rows.find((r) => r.code === "LENGTH")!.values).toEqual({
      S: null,
      M: null,
      L: null,
    });
    expect(half.questions).toContain(
      "The body length was not given: ask the buyer for it at one size.",
    );
    expect(chartSignals(half.rows).red).toBe(3);

    const cm = gradeChart({
      item: "POLO",
      unit: "CM",
      sizes: ["S", "M"],
      baseSize: "S",
      chest: 101.6,
      chestBasis: "AUTO",
      chestGrade: 5.08,
      length: 71.1,
    });
    expect(cm.chestBasis).toBe("FULL");
    expect(cm.rows.find((r) => r.code === "SHOULDER")!.values).toEqual({ S: 43.2, M: 44.5 });
    expect(cm.rows.find((r) => r.code === "COLLAR_HEIGHT")!.values.S).toBe(7.6);
    expect(cm.rows.find((r) => r.code === "COLLAR_HEIGHT")!.tolerance).toBe(0.2);

    const unsure = gradeChart({
      item: "POLO",
      unit: "INCH",
      sizes: ["S"],
      baseSize: "S",
      chest: 29,
      chestBasis: "AUTO",
      length: 27,
    });
    expect(unsure.questions[0]).toMatch(/full \(round\) or half\? Full is assumed/);
    expect(unsure.questions[1]).toMatch(/No chest grade was given/);
  });

  it("lets the buyer's points win, moving the graded sizes with them", () => {
    const chart = gradeChart({
      item: "POLO",
      unit: "INCH",
      sizes: SIZES,
      baseSize: "S",
      chest: 40,
      chestBasis: "FULL",
      chestGrade: 2,
      length: 28,
      buyer: [
        { code: "SHOULDER", size: "S", value: 17.5 },
        { code: "SLEEVE", size: "XL", value: 10 },
      ],
    });
    expect(values(chart, "SHOULDER")).toEqual([17.5, 18, 18.5, 19, 19.5, 20]);
    expect(row(chart, "SHOULDER").sources.S).toBe("BUYER");
    expect(row(chart, "SHOULDER").sources.M).toBe("RULE");
    expect(values(chart, "SLEEVE")).toEqual([8.75, 9, 9.25, 10, 9.75, 10]);
    expect(row(chart, "SLEEVE").sources.XL).toBe("BUYER");
  });

  it("rounds, converts and writes inches as people do", () => {
    expect(roundMeasure(8.81, "INCH")).toBe(8.75);
    expect(roundMeasure(43.18, "CM")).toBe(43.2);
    expect(convertMeasure(40, "INCH")).toBe(101.6);
    expect(convertMeasure(28.5, "INCH")).toBe(72.4);
    expect(convertMeasure(101.6, "CM")).toBe(40);
    expect(inchText(8.375)).toBe("8⅜");
    expect(inchText(0.5)).toBe("½");
    expect(inchText(40)).toBe("40");
    expect(judgeChestBasis(40, "INCH")).toBe("FULL");
    expect(judgeChestBasis(52, "CM")).toBe("HALF");
    expect(judgeChestBasis(29, "INCH")).toBeNull();
  });
});
