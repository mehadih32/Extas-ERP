import { z } from "zod";

/*
 * Cutting, worked out in plain numbers so the screens, the alerts and the
 * tests agree: pieces cut by colour and size, the cutting and sewing
 * milestones, and the cross-checks of what was cut against the fabric (pieces
 * a kg), the collars and cuffs ordered for each colour and size, and the
 * accessories issued. A check only speaks once cutting has started.
 */

/** One cell of a cutting report or an embroidery job: null colour and size for a style without a grid. */
export const cutLineSchema = z.object({
  colorName: z.string().trim().min(1).max(60).nullish(),
  sizeName: z.string().trim().min(1).max(30).nullish(),
  quantity: z.number().int().min(0).max(1_000_000),
});
export type CutLine = { colorName: string | null; sizeName: string | null; quantity: number };

export const fabricUsedSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.number().positive().max(100_000_000).multipleOf(0.001),
});
export type FabricUsed = { materialId: string; quantity: number };

export const embroideryLineSchema = z.object({
  colorName: z.string().nullish(),
  sizeName: z.string().nullish(),
  sent: z.number().int().min(0),
  received: z.number().int().min(0),
  spoiled: z.number().int().min(0),
});
export type EmbroideryLine = {
  colorName: string | null;
  sizeName: string | null;
  sent: number;
  received: number;
  spoiled: number;
};

/** "Navy|M": a cell's key ("|" for a style without a grid). */
export const cellKey = (
  colorName: string | null | undefined,
  sizeName: string | null | undefined,
) => `${colorName ?? ""}|${sizeName ?? ""}`;

/** Reads stored lines back (a row written by an older shape is skipped, never thrown on). */
export function readCutLines(value: unknown): CutLine[] {
  const parsed = z.array(cutLineSchema).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.map((l) => ({
    colorName: l.colorName ?? null,
    sizeName: l.sizeName ?? null,
    quantity: l.quantity,
  }));
}

export function readFabricUsed(value: unknown): FabricUsed[] {
  const parsed = z.array(fabricUsedSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function readEmbroideryLines(value: unknown): EmbroideryLine[] {
  const parsed = z.array(embroideryLineSchema).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.map((l) => ({
    ...l,
    colorName: l.colorName ?? null,
    sizeName: l.sizeName ?? null,
  }));
}

/** Pieces by cell, added up over several lists of lines. */
export function addUp(lists: ReadonlyArray<ReadonlyArray<CutLine>>) {
  const total = new Map<string, number>();
  for (const lines of lists) {
    for (const l of lines) {
      const key = cellKey(l.colorName, l.sizeName);
      total.set(key, (total.get(key) ?? 0) + l.quantity);
    }
  }
  return total;
}

// --- Milestones --------------------------------------------------------------------------

export type MilestoneLevel = "DONE" | "LATE" | "DUE_SOON" | "ON_TRACK" | "UNSET";

/** Days from a to b, both "2026-10-08". */
function daysFrom(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Where a milestone stands today: done, late (by days), due within `soonDays`, or on track. */
export function milestone(dueOn: string | null, done: boolean, today: string, soonDays = 3) {
  if (!dueOn) return { level: (done ? "DONE" : "UNSET") as MilestoneLevel, dueOn, days: 0 };
  if (done) return { level: "DONE" as MilestoneLevel, dueOn, days: 0 };
  const left = daysFrom(today, dueOn);
  if (left < 0) return { level: "LATE" as MilestoneLevel, dueOn, days: -left };
  return {
    level: (left <= soonDays ? "DUE_SOON" : "ON_TRACK") as MilestoneLevel,
    dueOn,
    days: left,
  };
}

export type Milestone = ReturnType<typeof milestone>;

/** Plain words for a milestone that needs attention, or null. */
export function milestoneWarning(what: "Cutting" | "Sewing", m: Milestone, progress?: string) {
  if (m.level === "LATE") {
    return {
      level: "LATE" as const,
      text: `${what} is ${m.days} ${m.days === 1 ? "day" : "days"} late${progress ? `: ${progress}` : ""}.`,
    };
  }
  if (m.level === "DUE_SOON") {
    return {
      level: "DUE_SOON" as const,
      text: `${what} is due ${m.days === 0 ? "today" : `in ${m.days} ${m.days === 1 ? "day" : "days"}`}${progress ? `: ${progress}` : ""}.`,
    };
  }
  return null;
}

// --- Cross-checks ------------------------------------------------------------------------

export type CheckLevel = "OK" | "WARN" | "SHORT";

/** A material per piece as the checks need it: plain numbers, wastage included. */
export type CheckNeed = {
  material: { id: string; code: string; name: string; kind: string; unit: string };
  placement: string | null;
  split: "TOTAL" | "COLOUR" | "COLOUR_SIZE";
  /** Per piece with the wastage on top. */
  perPiece: number;
  /** The pieces each part is for (a total, a colour, or a colour and size). */
  parts: Array<{ colorName: string | null; sizeName: string | null; pieces: number }>;
  /** What the style holds of it from the store (issued less returned). */
  held: number;
  /** For collars and cuffs: what the style's orders give each colour and size. */
  ordered?: Map<string, number>;
};

export type CheckRow = {
  colorName: string | null;
  sizeName: string | null;
  cut: number;
  need: number;
  have: number;
  short: number;
};

export type CrossCheck = {
  material: CheckNeed["material"];
  /** What is checked: the fabric (pieces a kg), collars and cuffs, or an accessory. */
  about: "FABRIC" | "COLLAR_CUFF" | "ACCESSORY";
  level: CheckLevel;
  /** One plain sentence. */
  text: string;
  /** Collars and cuffs short by colour and size. */
  rows: CheckRow[];
  /** Fabric: pieces a kg (or a unit) planned and, once usage is given, actual. */
  piecesPerUnit?: { plan: number; actual: number | null };
};

const WHOLE = ["PCS", "ROLL", "CONE", "SET"];
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const roundFor = (unit: string, n: number) =>
  WHOLE.includes(unit) ? Math.ceil(n - 1e-9) : Math.ceil(n * 1000 - 1e-6) / 1000;
const unitWord = (unit: string) =>
  ({
    PCS: "pcs",
    METER: "m",
    YARD: "yd",
    KG: "kg",
    GRAM: "g",
    ROLL: "rolls",
    DOZEN: "dozen",
    GROSS: "gross",
    CONE: "cones",
    SET: "sets",
    LB: "lb",
  })[unit] ?? unit.toLowerCase();
const q = (n: number, unit: string) => `${round3(n)} ${unitWord(unit)}`;
const cellName = (c: { colorName: string | null; sizeName: string | null }) =>
  [c.colorName, c.sizeName].filter(Boolean).join(" ") || "All";

/** Pieces cut in the cells a part covers (a null colour or size covers them all). */
function cutFor(
  part: { colorName: string | null; sizeName: string | null },
  cuts: ReadonlyMap<string, number>,
) {
  let total = 0;
  for (const [key, pieces] of cuts) {
    const [colour, size] = key.split("|");
    if (part.colorName !== null && colour !== part.colorName) continue;
    if (part.sizeName !== null && size !== part.sizeName) continue;
    total += pieces;
  }
  return total;
}

/**
 * Each material per piece against what was cut:
 * - fabric: pieces a kg used against the tech pack (once usage is given), and
 *   whether what is left of the fabric issued covers the pieces still to cut;
 * - collars and cuffs (by colour and size): what the cut pieces need against
 *   what was ordered for each colour and size, and against what was issued;
 * - accessories: what the cut pieces need against what was issued.
 * `usage` is the fabric used as given on cutting reports, with the pieces those
 * reports cut in the need's colours.
 */
export function crossCheck(
  need: CheckNeed,
  cuts: ReadonlyMap<string, number>,
  usage?: { used: number; pieces: number },
): CrossCheck | null {
  const unit = need.material.unit;
  const cut = need.parts.reduce((t, p) => t + cutFor(p, cuts), 0);
  if (cut === 0 || need.perPiece <= 0) return null;
  const target = need.parts.reduce((t, p) => t + p.pieces, 0);
  const base = { material: need.material, rows: [] as CheckRow[] };

  if (need.split === "COLOUR_SIZE") {
    const rows: CheckRow[] = need.parts.map((p) => {
      const pieces = cutFor(p, cuts);
      const required = roundFor(unit, pieces * need.perPiece);
      const have = need.ordered?.get(cellKey(p.colorName, p.sizeName)) ?? 0;
      return {
        ...p,
        cut: pieces,
        need: required,
        have,
        short: round3(Math.max(required - have, 0)),
      };
    });
    const short = rows.filter((r) => r.short > 0);
    const required = rows.reduce((t, r) => t + r.need, 0);
    const name = need.placement ?? need.material.name;
    if (short.length > 0) {
      return {
        ...base,
        about: "COLLAR_CUFF",
        level: "SHORT",
        rows: short,
        text:
          `${name} (${need.material.code}) is short for what was cut: ` +
          short
            .map(
              (r) =>
                `${cellName(r)} ${r.cut} cut need ${q(r.need, unit)}, ${q(r.have, unit)} ordered`,
            )
            .join("; ") +
          ".",
      };
    }
    if (need.held + 1e-9 < required) {
      return {
        ...base,
        about: "COLLAR_CUFF",
        level: "WARN",
        text: `${name} (${need.material.code}): ${cut} pieces cut need ${q(required, unit)}; ${q(need.held, unit)} issued so far. Issue the rest before sewing.`,
      };
    }
    return {
      ...base,
      about: "COLLAR_CUFF",
      level: "OK",
      text: `${name} (${need.material.code}) covers every colour and size cut.`,
    };
  }

  if (need.material.kind === "FABRIC") {
    const plan = need.perPiece;
    const actualPerPiece =
      usage && usage.pieces > 0 && usage.used > 0 ? usage.used / usage.pieces : null;
    const piecesPerUnit = {
      plan: round3(1 / plan),
      actual: actualPerPiece ? round3(1 / actualPerPiece) : null,
    };
    // Fabric gone: as given on the reports that say, at the plan for the rest.
    const reported = usage?.pieces ?? 0;
    const used = (usage?.used ?? 0) + Math.max(cut - reported, 0) * plan;
    const left = need.held - used;
    const stillToCut = Math.max(target - cut, 0);
    const forRest = stillToCut * (actualPerPiece ?? plan);
    const name = `${need.material.name} (${need.material.code})`;
    if (stillToCut > 0 && left + 1e-9 < forRest) {
      const short = roundFor(unit, forRest - Math.max(left, 0));
      return {
        ...base,
        about: "FABRIC",
        level: "SHORT",
        piecesPerUnit,
        text: `${name} is ${q(short, unit)} short for the ${stillToCut} pieces still to cut: ${q(Math.max(left, 0), unit)} left of ${q(need.held, unit)} issued, at ${q(actualPerPiece ?? plan, unit)} a piece.`,
      };
    }
    if (actualPerPiece !== null && actualPerPiece > plan * 1.03) {
      return {
        ...base,
        about: "FABRIC",
        level: "WARN",
        piecesPerUnit,
        text: `${name} cuts ${piecesPerUnit.actual} pieces a ${unitWord(unit).replace(/s$/, "")} against ${piecesPerUnit.plan} in the tech pack (${Math.round((actualPerPiece / plan - 1) * 100)}% more fabric a piece).`,
      };
    }
    return {
      ...base,
      about: "FABRIC",
      level: "OK",
      piecesPerUnit,
      text:
        actualPerPiece !== null
          ? `${name} cuts ${piecesPerUnit.actual} pieces a ${unitWord(unit).replace(/s$/, "")}, plan ${piecesPerUnit.plan}.`
          : `${name}: ${cut} pieces cut, ${q(Math.max(left, 0), unit)} left of ${q(need.held, unit)} issued.`,
    };
  }

  const required = roundFor(unit, cut * need.perPiece);
  const name = `${need.material.name} (${need.material.code})`;
  if (need.held + 1e-9 < required) {
    const short = round3(required - need.held);
    return {
      ...base,
      about: "ACCESSORY",
      level: "SHORT",
      text: `${name} is ${q(short, unit)} short: ${cut} pieces cut need ${q(required, unit)}, ${q(need.held, unit)} issued.`,
    };
  }
  return {
    ...base,
    about: "ACCESSORY",
    level: "OK",
    text: `${name}: ${q(need.held, unit)} issued covers the ${cut} pieces cut.`,
  };
}
