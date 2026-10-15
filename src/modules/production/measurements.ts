/*
 * A full measurement chart from a few points (the blueprint's S21): the buyer
 * gives the chest at one size, its grade and perhaps the length; the rest of
 * the base size comes from ratios of the full chest, the other sizes from grade
 * rules (never by re-applying the ratios, which drift at big sizes). Every value
 * worked out here is a rule's guess (yellow, with its source) until someone
 * confirms it; the buyer's own values stay as given and locked.
 *
 * Values are kept in the buyer's unit: inches to the nearest 1/8, centimetres
 * to the nearest 0.1. The cm sheet is inch × 2.54 per size, rounded to 0.1
 * (the grade is never converted on its own). Pure: no database.
 */

export const ITEM_KINDS = ["POLO", "TEE", "SHIRT"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_LABELS: Record<ItemKind, string> = {
  POLO: "Polo",
  TEE: "T-shirt",
  SHIRT: "Woven shirt",
};

export type MeasureUnit = "INCH" | "CM";
export type ChestBasis = "FULL" | "HALF";

/** Where a value came from: the buyer (locked), a rule (a guess until confirmed) or a person. */
export type ValueSource = "BUYER" | "RULE" | "OWNER";

export const TOP_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"] as const;

export type GradeInput = {
  item: ItemKind;
  unit: MeasureUnit;
  /** The sizes in order, smallest first. */
  sizes: readonly string[];
  /** The size the buyer's points are for. */
  baseSize: string;
  /** The chest at the base size, as the buyer measures it. */
  chest: number;
  /** Full (round) or half; "AUTO" judges it from the number. */
  chestBasis: ChestBasis | "AUTO";
  /** The chest grade per size, on the same basis; 2" full (1" half) when not given. */
  chestGrade?: number | null;
  /** The chest per size (on the same basis), instead of one grade. */
  chestBySize?: Readonly<Record<string, number>> | null;
  /** Whose per-size chests they are: the owner's own run (the default) or the buyer's. */
  chestBySizeSource?: "BUYER" | "OWNER";
  /** Body length from the HPS at the base size. */
  length?: number | null;
  /** Other points the buyer gave: they win and stay locked. */
  buyer?: ReadonlyArray<{ code: string; size: string; value: number }>;
};

export type ChartRow = {
  code: string;
  name: string;
  howTo: string;
  /** ± in the chart's unit. */
  tolerance: number;
  critical: boolean;
  /** Where the base value comes from ("0.85 × half chest", "Buyer"). */
  rule: string;
  values: Record<string, number | null>;
  sources: Record<string, ValueSource>;
};

export type GradeResult = {
  unit: MeasureUnit;
  chestBasis: ChestBasis;
  rows: ChartRow[];
  /** What the owner or the buyer must answer before the chart can be trusted. */
  questions: string[];
};

const INCH = 2.54;

/** To the nearest 1/8 inch, or 0.1 cm. */
export function roundMeasure(value: number, unit: MeasureUnit): number {
  return unit === "INCH" ? Math.round(value * 8) / 8 : Math.round(value * 10) / 10;
}

/** A tolerance: to the nearest 1/16 inch, or 0.1 cm. */
export function roundTolerance(value: number, unit: MeasureUnit): number {
  return unit === "INCH" ? Math.round(value * 16) / 16 : Math.round(value * 10) / 10;
}

/** A chart value in the other unit: cm = inch × 2.54 to 0.1; inch = cm ÷ 2.54 to 1/8. */
export function convertMeasure(value: number, from: MeasureUnit): number {
  return from === "INCH" ? Math.round(value * INCH * 10) / 10 : Math.round((value / INCH) * 8) / 8;
}

/** 8.375 → 8⅜; inches as people write them. */
export function inchText(value: number): string {
  const eighths = Math.round(Math.abs(value) * 8);
  const whole = Math.floor(eighths / 8);
  const part = eighths % 8;
  const FRACTIONS = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];
  const sign = value < 0 ? "−" : "";
  if (part === 0) return `${sign}${whole}`;
  return `${sign}${whole === 0 ? "" : whole}${FRACTIONS[part]}`;
}

/** A tolerance as people write it: ⅛ steps, or sixteenths (3/16) where needed; cm to 0.1. */
export function toleranceText(value: number, unit: MeasureUnit): string {
  if (unit === "CM") return value.toFixed(1).replace(/\.0$/, "");
  const sixteenths = Math.round(value * 16);
  if (sixteenths % 2 === 0) return inchText(value);
  const whole = Math.floor(sixteenths / 16);
  return `${whole > 0 ? `${whole} ` : ""}${sixteenths % 16}/16`;
}

type Pom = {
  code: string;
  name: string;
  howTo: string;
  items: readonly ItemKind[];
  /** ± in inches (7.6). */
  tolerance: number;
  critical?: boolean;
  /** Grade per 2" of full chest, in inches (7.5); 0 = the same at every size. */
  grade: number;
  /** The base value in inches from the full chest C (and the length L when given), or null when unknown. */
  base: (C: number, L: number | null) => number | null;
  rule: string;
};

const ALL: readonly ItemKind[] = ["POLO", "TEE", "SHIRT"];
const KNIT: readonly ItemKind[] = ["POLO", "TEE"];

/*
 * The points worked out for each item (7.3 to 7.8). Chest and length are the
 * buyer's; the base values are the ratios of 7.4 and the owner's defaults of
 * 7.8, the grades those of 7.5 for a 2" full-chest step, the tolerances 7.6.
 */
const POMS: readonly Pom[] = [
  {
    code: "LENGTH",
    name: "Body length from HPS (back)",
    howTo: "From the high point shoulder straight down to the hem, at the back.",
    items: ALL,
    tolerance: 0.5,
    critical: true,
    grade: 0.5,
    base: (_C, L) => L,
    rule: "Buyer",
  },
  {
    code: "FRONT_LENGTH",
    name: "Front length from HPS",
    howTo: "From the high point shoulder down to the front hem.",
    items: ["POLO"],
    tolerance: 0.5,
    grade: 0.5,
    base: (_C, L) => (L === null ? null : L - 1.5),
    rule: 'Back length − 1½" (tennis tail)',
  },
  {
    code: "SHOULDER",
    name: "Across shoulder",
    howTo: "Shoulder point to shoulder point, straight across the back.",
    items: ALL,
    tolerance: 0.25,
    grade: 0.5,
    base: (C) => 0.85 * (C / 2),
    rule: "0.85 × half chest",
  },
  {
    code: "SWEEP",
    name: "Sweep (hem), full",
    howTo: "Along the bottom edge, all the way round.",
    items: ALL,
    tolerance: 0.5,
    grade: 2,
    base: (C) => C,
    rule: "Same as the chest (straight body)",
  },
  {
    code: "ARMHOLE",
    name: "Armhole, straight",
    howTo: "From the shoulder point straight to the underarm.",
    items: KNIT,
    tolerance: 0.25,
    grade: 0.25,
    base: (C) => 0.21875 * C,
    rule: "0.21 to 0.22 × full chest",
  },
  {
    code: "ARMHOLE_CURVED",
    name: "Armhole, curved, full",
    howTo: "Along the armhole seam, all the way round.",
    items: ["SHIRT"],
    tolerance: 0.375,
    grade: 0.875,
    base: (C) => 0.45 * C,
    rule: "0.45 × full chest",
  },
  {
    code: "BICEP",
    name: "Bicep, half",
    howTo: '1" below the armhole, edge to edge.',
    items: ALL,
    tolerance: 0.25,
    grade: 0.25,
    base: (C) => 0.21875 * C - 0.25,
    rule: 'Straight armhole − ¼"',
  },
  {
    code: "SLEEVE",
    name: "Short sleeve length",
    howTo: "From the shoulder point to the sleeve edge, cuff included.",
    items: KNIT,
    tolerance: 0.375,
    grade: 0.25,
    base: (C) => 0.21875 * C,
    rule: "About the straight armhole (common practice)",
  },
  {
    code: "SLEEVE_OPENING",
    name: "Sleeve opening, half",
    howTo: "At the sleeve edge, edge to edge.",
    items: KNIT,
    tolerance: 0.375,
    grade: 0.25,
    base: (C) => 0.175 * C,
    rule: "0.17 to 0.175 × full chest",
  },
  {
    code: "NECK_WIDTH",
    name: "Neck width, seam to seam",
    howTo: "From one high point shoulder to the other, seam to seam.",
    items: ALL,
    tolerance: 0.25,
    grade: 0.25,
    base: (C) => 6.5 + ((C - 40) / 2) * 0.25,
    rule: 'About 6½" at a 40" chest',
  },
  {
    code: "FRONT_NECK_DROP",
    name: "Front neck drop",
    howTo: "From the HPS line straight down to the front neck seam.",
    items: KNIT,
    tolerance: 0.125,
    grade: 0.125,
    base: (C) => 3.5 + ((C - 40) / 2) * 0.125,
    rule: 'About 3½" at a 40" chest (low trust)',
  },
  {
    code: "BACK_NECK_DROP",
    name: "Back neck drop",
    howTo: "From the HPS line straight down to the back neck seam.",
    items: ALL,
    tolerance: 0.125,
    grade: 0,
    base: () => 0.75,
    rule: 'About ¾" (2 cm), the same at every size',
  },
  {
    code: "COLLAR_LENGTH",
    name: "Collar length (attach edge)",
    howTo: "Along the edge sewn to the body, end to end, not stretched.",
    items: ["POLO"],
    tolerance: 0.125,
    critical: true,
    grade: 0.625,
    base: (C) => 15.75 + ((C - 40) / 2) * 0.625,
    rule: 'Neckline − placket − ¼" ease, about 15¾" at a 40" chest; confirm on the proto pattern before booking the collar',
  },
  {
    code: "COLLAR_LENGTH",
    name: "Collar length (attach edge)",
    howTo: "Along the band edge sewn to the body, end to end.",
    items: ["SHIRT"],
    tolerance: 0.125,
    critical: true,
    grade: 0.5,
    base: (C) => 14.5 + ((C - 40) / 2) * 0.5,
    rule: 'Shirt basis 14½" at a 40" chest',
  },
  {
    code: "COLLAR_HEIGHT",
    name: "Collar height at CB",
    howTo: "At the centre back, from the attach edge to the outer edge, tipping included.",
    items: ["POLO"],
    tolerance: 0.0625,
    grade: 0,
    base: () => 3,
    rule: 'Owner\'s default 3" (jacquard 3¼"), not graded',
  },
  {
    code: "PLACKET_LENGTH",
    name: "Placket length",
    howTo: "From the neck seam to the bottom of the placket.",
    items: ["POLO"],
    tolerance: 0.25,
    grade: 0,
    base: () => 4.5,
    rule: 'About 4½", not graded; buyer to confirm',
  },
  {
    code: "CUFF_LENGTH",
    name: "Cuff length",
    howTo: "The rib cuff laid flat, end to end.",
    items: ["POLO"],
    tolerance: 0.25,
    grade: 0.5,
    base: (C) => 2 * (0.175 * C) + 0.75,
    rule: '2 × half sleeve opening + 2 × ⅜" seam allowance',
  },
  {
    code: "CUFF_HEIGHT",
    name: "Cuff height",
    howTo: "The rib cuff, from the sleeve seam to the edge.",
    items: ["POLO"],
    tolerance: 0.0625,
    grade: 0,
    base: () => 1.25,
    rule: "Owner's default 1¼\", not graded",
  },
];

const CHEST_NAME = { FULL: "Chest, full (round)", HALF: "Chest, half" } as const;

/** Men's tops: above 30" (76 cm) the chest is full; 18 to 28" (46 to 71 cm) half. */
export function judgeChestBasis(chest: number, unit: MeasureUnit): ChestBasis | null {
  const inches = unit === "INCH" ? chest : chest / INCH;
  if (inches > 30) return "FULL";
  if (inches >= 18 && inches <= 28) return "HALF";
  return null;
}

/** The chart for a style from the buyer's few points. */
export function gradeChart(input: GradeInput): GradeResult {
  const { unit, sizes } = input;
  const questions: string[] = [];
  const baseIndex = sizes.indexOf(input.baseSize);
  if (baseIndex < 0) throw new Error(`The base size ${input.baseSize} is not in the size run.`);
  const toIn = (v: number) => (unit === "INCH" ? v : v / INCH);
  const fromIn = (v: number) => (unit === "INCH" ? v : v * INCH);
  const q = (v: number) => roundMeasure(v, unit);
  const tol = (v: number) => roundTolerance(v, unit);

  // 1. Clean the input: half or full, and the grade.
  let basis: ChestBasis;
  if (input.chestBasis === "AUTO") {
    const judged = judgeChestBasis(input.chest, unit);
    basis = judged ?? "FULL";
    if (!judged) {
      questions.push(
        `Is the chest of ${input.chest}${unit === "INCH" ? '"' : " cm"} measured full (round) or half? Full is assumed.`,
      );
    }
  } else {
    basis = input.chestBasis;
  }
  const full = (v: number) => (basis === "HALF" ? v * 2 : v);
  const onBasis = (v: number) => (basis === "HALF" ? v / 2 : v);
  const givenGrade = input.chestGrade ?? null;
  const gradeFull = givenGrade !== null ? full(givenGrade) : fromIn(2);
  if (givenGrade === null && !input.chestBySize) {
    questions.push(
      `No chest grade was given: ${unit === "INCH" ? '2"' : "5 cm"} on the full chest per size is used.`,
    );
  }

  // The full chest at each size: the owner's own per size, else the grade from the base.
  const chestAt = sizes.map((size, i) => {
    const own = input.chestBySize?.[size];
    if (own !== undefined && own !== null) return full(own);
    return full(input.chest) + (i - baseIndex) * gradeFull;
  });
  const C = toIn(chestAt[baseIndex]!);
  const L = input.length !== null && input.length !== undefined ? toIn(input.length) : null;
  if (L === null)
    questions.push("The body length was not given: ask the buyer for it at one size.");

  // Big sizes: a 2" full-chest grade makes a small 3XL.
  const bigIndex = sizes.findIndex((s) => s === "3XL" || s === "XXXL");
  if (bigIndex >= 0 && !input.chestBySize && (input.item === "POLO" || input.item === "TEE")) {
    const big = toIn(chestAt[bigIndex]!);
    if (big < 54) {
      questions.push(
        `3XL comes out at ${inchText(big)}" full chest, while a market ${input.item === "POLO" ? "polo" : "T-shirt"} 3XL is about 56". Is the grade on the half chest (twice as much on the full), or does 3XL get a bigger step?`,
      );
    }
  }

  const sourcesAll = (source: ValueSource) =>
    Object.fromEntries(sizes.map((s) => [s, source])) as Record<string, ValueSource>;

  // The chest row itself, on the buyer's basis. Its tolerance stays below half
  // the grade, so neighbouring sizes cannot overlap.
  const chestTolerance = Math.min(
    fromIn(basis === "HALF" ? 0.25 : 0.5),
    onBasis(gradeFull) / 2 - fromIn(1 / 16),
  );
  const perSize = input.chestBySizeSource ?? "OWNER";
  const chestRow: ChartRow = {
    code: "CHEST",
    name: CHEST_NAME[basis],
    howTo: '1" below the armhole, edge to edge (full: all the way round).',
    tolerance: tol(Math.max(chestTolerance, fromIn(1 / 8))),
    critical: true,
    rule: "Buyer",
    values: Object.fromEntries(sizes.map((s, i) => [s, q(onBasis(chestAt[i]!))])),
    sources: Object.fromEntries(
      sizes.map((s) => [
        s,
        s === input.baseSize ? "BUYER" : input.chestBySize?.[s] !== undefined ? perSize : "RULE",
      ]),
    ) as Record<string, ValueSource>,
  };

  // 2 to 4. The base size from the ratios, the other sizes by grade rules.
  const rows: ChartRow[] = [chestRow];
  for (const pom of POMS) {
    if (!pom.items.includes(input.item)) continue;
    const base = pom.base(C, L);
    const values: Record<string, number | null> = {};
    sizes.forEach((size, i) => {
      if (base === null) {
        values[size] = null;
        return;
      }
      // Grade by how much the full chest grew from the base, per 2".
      const grown = (toIn(chestAt[i]!) - C) / 2;
      values[size] = q(fromIn(base + pom.grade * grown));
    });
    const sources = sourcesAll("RULE");
    if (pom.code === "LENGTH" && L !== null) sources[input.baseSize] = "BUYER";
    rows.push({
      code: pom.code,
      name: pom.name,
      howTo: pom.howTo,
      tolerance: tol(fromIn(pom.tolerance)),
      critical: pom.critical ?? false,
      rule: pom.rule,
      values,
      sources,
    });
  }

  // The buyer's other points win: at the base size they move the whole row.
  for (const point of input.buyer ?? []) {
    const row = rows.find((r) => r.code === point.code);
    if (!row || !(point.size in row.values)) continue;
    const before = row.values[point.size];
    if (point.size === input.baseSize && before !== null && before !== undefined) {
      const shift = point.value - before;
      for (const s of sizes) {
        if (row.sources[s] === "RULE" && row.values[s] !== null) {
          row.values[s] = q(row.values[s]! + shift);
        }
      }
    }
    row.values[point.size] = point.value;
    row.sources[point.size] = "BUYER";
    row.rule = row.rule === "Buyer" ? row.rule : `Buyer at ${point.size}; ${row.rule}`;
  }

  return { unit, chestBasis: basis, rows, questions };
}

/** How sure the chart is: confirmed (buyer or person) against rule-made and missing values. */
export function chartSignals(rows: ReadonlyArray<Pick<ChartRow, "values" | "sources">>) {
  let green = 0;
  let yellow = 0;
  let red = 0;
  for (const row of rows) {
    for (const [size, value] of Object.entries(row.values)) {
      if (value === null || value === undefined) red += 1;
      else if (row.sources[size] === "RULE") yellow += 1;
      else green += 1;
    }
  }
  return { green, yellow, red };
}
