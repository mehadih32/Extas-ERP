import type { GarmentCategory, MeasurementUnit } from "@prisma/client";

import {
  CATEGORY_PRESETS,
  DIA_LABELS,
  type DiaType,
  type LineRole,
  WEIGHT_LABELS,
  type WeightUnit,
} from "@/modules/production/booking-presets";

/*
 * The sums on a booking, worked out the same way on the screen, in the service
 * and on the PDF: the fabric a number of pieces takes (consumption per dozen
 * plus the process loss, rounded up so the order never falls short), the
 * collar and cuff sets of each colour and size group (the pieces plus the extra,
 * rounded up), and their totals. In whole numbers of thousandths, so 0.1 + 0.2
 * never comes to 0.30000000000000004.
 */

/** Units counted whole (as materials/valuation.ts). */
const WHOLE: readonly MeasurementUnit[] = ["PCS", "ROLL", "CONE", "SET"];

/** Rounds up to what can be ordered in the unit: whole units, or 3 decimals. */
export function roundUpQuantity(value: number, unit: MeasurementUnit): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // To the millionth first, so float noise (12.0000000001) does not round a whole gram up.
  const micro = Math.round(value * 1e6);
  if (WHOLE.includes(unit)) return Math.ceil(micro / 1e6);
  return Math.ceil(micro / 1e3) / 1e3;
}

/**
 * What `pieces` garments take of a fabric: consumption per dozen × dozens, plus
 * the process loss (dyeing, finishing, cutting) on top, rounded up for the unit.
 */
export function fabricFor(
  pieces: number,
  perDozen: number,
  lossPercent: number,
  unit: MeasurementUnit,
): number {
  if (!(pieces > 0) || !(perDozen > 0) || lossPercent < 0) return 0;
  return roundUpQuantity(((pieces / 12) * perDozen * (100 + lossPercent)) / 100, unit);
}

/** Collar and cuff sets for `pieces` garments with `extraPercent` booked over them. */
export function setsFor(pieces: number, extraPercent: number): number {
  if (!Number.isInteger(pieces) || pieces <= 0) return 0;
  const bp = Math.round(Math.max(0, extraPercent) * 100); // hundredths of a percent
  return Math.ceil((pieces * (10_000 + bp)) / 10_000);
}

/** Cuffs on the cuff line: two a set in pieces, one a set in sets (pairs). */
export const cuffsFor = (sets: number, unit: MeasurementUnit) => (unit === "SET" ? sets : sets * 2);

/** The collar and cuff matrix: pieces per garment colour (rows) and size group (columns). */
export type CollarGrid = {
  extraPercent: number;
  sizes: ReadonlyArray<{ label: string }>;
  colours: ReadonlyArray<{ pieces: ReadonlyArray<number> }>;
};

/** Every cell's sets, the totals of each size group and colour, and the grand totals. */
export function collarTotals(grid: CollarGrid) {
  const sets = grid.colours.map((c) =>
    grid.sizes.map((_, i) => setsFor(c.pieces[i] ?? 0, grid.extraPercent)),
  );
  const bySize = grid.sizes.map((_, i) => sets.reduce((t, row) => t + (row[i] ?? 0), 0));
  const byColour = sets.map((row) => row.reduce((t, n) => t + n, 0));
  const piecesBySize = grid.sizes.map((_, i) =>
    grid.colours.reduce((t, c) => t + (c.pieces[i] ?? 0), 0),
  );
  const totalPieces = piecesBySize.reduce((t, n) => t + n, 0);
  const totalSets = byColour.reduce((t, n) => t + n, 0);
  return { sets, bySize, byColour, piecesBySize, totalPieces, totalSets };
}

/** What a line's quantity is when the collar matrix sets it, or null when it is typed. */
export function matrixQuantity(
  role: LineRole,
  unit: MeasurementUnit,
  totalSets: number | null,
): number | null {
  if (totalSets === null) return null;
  if (role === "COLLAR") return totalSets;
  if (role === "CUFF") return cuffsFor(totalSets, unit);
  return null;
}

/** A line's specification as stored (booking-schemas.ts checks it). */
export type LineSpecs = {
  role: LineRole;
  fabricType?: string | null;
  composition?: string | null;
  colour?: string | null;
  weight?: number | null;
  weightUnit?: WeightUnit | null;
  dia?: number | null;
  diaType?: DiaType | null;
  width?: number | null;
  construction?: string | null;
  yarnCount?: string | null;
  gauge?: number | null;
  finish?: string | null;
  size?: string | null;
  /** The fabric calculator: garment pieces, consumption per dozen and process loss (%). */
  pieces?: number | null;
  perDozen?: number | null;
  lossPercent?: number | null;
};

const num = (n: number) => String(Number(n.toFixed(3)));

/** "180 GSM", "6.5 oz/yd²" */
export function weightText(specs: Pick<LineSpecs, "weight" | "weightUnit">): string | null {
  if (!specs.weight) return null;
  return `${num(specs.weight)} ${WEIGHT_LABELS[specs.weightUnit ?? "GSM"]}`;
}

/** "36\" open" */
export function diaText(specs: Pick<LineSpecs, "dia" | "diaType">): string | null {
  if (!specs.dia && !specs.diaType) return null;
  return [specs.dia ? `${num(specs.dia)}"` : null, specs.diaType ? DIA_LABELS[specs.diaType] : null]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/^(.)/, (c) => c.toUpperCase());
}

/**
 * The specification in one line, in the family's field order: "Single jersey ·
 * 100% cotton · 180 GSM · 36" open · Enzyme". The colour is left out (it has a
 * column of its own); it is the material's specification when a booking adds it.
 */
export function specsText(specs: LineSpecs, category: GarmentCategory): string {
  const fields =
    specs.role === "FABRIC" ? CATEGORY_PRESETS[category].fabricFields : (["size"] as const);
  const parts: string[] = [];
  for (const f of fields) {
    switch (f) {
      case "weight": {
        const w = weightText(specs);
        if (w) parts.push(w);
        break;
      }
      case "dia": {
        const d = diaText(specs);
        if (d) parts.push(`DIA ${d}`);
        break;
      }
      case "width":
        if (specs.width) parts.push(`${num(specs.width)}" wide`);
        break;
      case "gauge":
        if (specs.gauge) parts.push(`${num(specs.gauge)} GG`);
        break;
      case "yarnCount":
        if (specs.yarnCount) parts.push(`Count ${specs.yarnCount}`);
        break;
      case "colour":
        break;
      default: {
        const v = specs[f];
        if (typeof v === "string" && v.trim()) parts.push(v.trim());
      }
    }
  }
  return parts.join(" · ");
}
