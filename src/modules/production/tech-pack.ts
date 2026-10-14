import type { MaterialSplit, MeasurementUnit } from "@prisma/client";

import { UNIT_LABELS } from "@/components/materials/labels";

/*
 * A style's fabric part: what its fabric bookings are made from. It is read from
 * the style in production (its project): each fabric it uses (quality and
 * specification, colour, use per piece, wastage, how it is split) and the pieces
 * of each colour and size. A tech pack locks it (Fabric first), and a booking
 * keeps it when approved, so a change afterwards shows: a booking already sent
 * is marked with what changed and the fabric at risk, and changes only by a new
 * revision the owner approves. Plain data and functions, tested on their own.
 */

export type FabricPart = {
  fabrics: Array<{
    code: string;
    name: string;
    specification: string | null;
    colour: string | null;
    unit: MeasurementUnit;
    perPiece: string;
    wastagePercent: string;
    split: MaterialSplit;
    placement: string | null;
  }>;
  /** Garment pieces of each colour and size. */
  pieces: Array<{ colour: string; size: string; quantity: number }>;
};

export type FabricChange = { item: string; was: string; now: string };

const SPLIT_TEXT: Record<MaterialSplit, string> = {
  TOTAL: "one total",
  COLOUR: "by colour",
  COLOUR_SIZE: "by colour and size",
};

/** "0.285 kg + 5% wastage" */
const usageText = (f: FabricPart["fabrics"][number]) =>
  `${f.perPiece} ${UNIT_LABELS[f.unit] ?? f.unit} a piece + ${f.wastagePercent}% wastage`;

/** What changed in a fabric part since it was locked or approved; empty when nothing did. */
export function diffFabricParts(was: FabricPart, now: FabricPart): FabricChange[] {
  const changes: FabricChange[] = [];
  const before = new Map(was.fabrics.map((f) => [f.code, f]));
  const after = new Map(now.fabrics.map((f) => [f.code, f]));
  for (const [code, old] of before) {
    const f = after.get(code);
    const name = `${code} ${old.name}`;
    if (!f) {
      changes.push({ item: name, was: usageText(old), now: "Taken off" });
      continue;
    }
    if (old.name !== f.name) changes.push({ item: `${code}: quality`, was: old.name, now: f.name });
    if ((old.specification ?? "") !== (f.specification ?? "")) {
      changes.push({
        item: `${name}: specification`,
        was: old.specification || "None",
        now: f.specification || "None",
      });
    }
    if ((old.colour ?? "") !== (f.colour ?? "")) {
      changes.push({ item: `${name}: colour`, was: old.colour || "None", now: f.colour || "None" });
    }
    if (
      old.perPiece !== f.perPiece ||
      old.wastagePercent !== f.wastagePercent ||
      old.unit !== f.unit
    ) {
      changes.push({ item: `${name}: use`, was: usageText(old), now: usageText(f) });
    }
    if (old.split !== f.split) {
      changes.push({
        item: `${name}: split`,
        was: SPLIT_TEXT[old.split],
        now: SPLIT_TEXT[f.split],
      });
    }
    if ((old.placement ?? "") !== (f.placement ?? "")) {
      changes.push({
        item: `${name}: placement`,
        was: old.placement || "None",
        now: f.placement || "None",
      });
    }
  }
  for (const [code, f] of after) {
    if (!before.has(code))
      changes.push({ item: `${code} ${f.name}`, was: "Not used", now: usageText(f) });
  }
  const key = (p: { colour: string; size: string }) => `${p.colour} · ${p.size}`;
  const oldPieces = new Map(was.pieces.map((p) => [key(p), p.quantity]));
  const newPieces = new Map(now.pieces.map((p) => [key(p), p.quantity]));
  for (const cell of new Set([...oldPieces.keys(), ...newPieces.keys()])) {
    const a = oldPieces.get(cell) ?? 0;
    const b = newPieces.get(cell) ?? 0;
    if (a !== b) changes.push({ item: `Pieces ${cell}`, was: String(a), now: String(b) });
  }
  return changes;
}

/** Reads a stored fabric part (null when there is none or it cannot be read). */
export function readFabricPart(json: unknown): FabricPart | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Partial<FabricPart>;
  if (!Array.isArray(value.fabrics) || !Array.isArray(value.pieces)) return null;
  return { fabrics: value.fabrics, pieces: value.pieces };
}

/** Reads the fabric parts a booking kept when approved, by project id. */
export function readFabricBasis(json: unknown): Map<string, FabricPart> {
  const parts = new Map<string, FabricPart>();
  if (!json || typeof json !== "object" || Array.isArray(json)) return parts;
  for (const [projectId, value] of Object.entries(json as Record<string, unknown>)) {
    const part = readFabricPart(value);
    if (part) parts.set(projectId, part);
  }
  return parts;
}

/** A style's code in an order: A, B ... Z, then AA, AB. */
export function styleCode(index: number): string {
  let n = index;
  let code = "";
  do {
    code = String.fromCharCode(65 + (n % 26)) + code;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return code;
}

/** A style's colour code: "A-01", "A-02". */
export const colourCode = (style: string, index: number) =>
  `${style}-${String(index + 1).padStart(2, "0")}`;
