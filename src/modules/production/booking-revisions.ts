import type { BookingStage, DocumentLanguage, MeasurementUnit } from "@prisma/client";

import { UNIT_LABELS } from "@/components/materials/labels";
import {
  COLLAR_STYLE_LABELS,
  LANGUAGE_LABELS,
  type LineRole,
} from "@/modules/production/booking-presets";

/*
 * Booking revisions: a booking is approved as R0; a change after that makes a
 * draft R1 (then R2...), which needs approval again. Each approved revision is
 * kept as a snapshot (BookingRevision), and a draft revision lists what changed
 * from the last approved one. When that one had already been sent, the fabric
 * on lines that changed or went is "at risk": the mill may have started on it.
 * What the supplier is told counts as much as the items: the in-house date,
 * the delivery place, the payment terms, the terms and conditions and the
 * master batch it is for. Plain data and functions, tested on their own.
 */

/** "R0", "R1"... */
export const revisionLabel = (revision: number) => `R${revision}`;

/** "PO-2026-00007-R1": the booking number as printed. */
export const bookingDocNo = (number: string, revision: number) =>
  `${number}-${revisionLabel(revision)}`;

export const STAGE_LABELS: Record<BookingStage, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  SENT: "Sent",
};

/** The paperwork printed on a booking for its supplier. */
export type BookingPaperwork = {
  deliveryPlace: string | null;
  paymentTerms: string | null;
  termsLanguage: DocumentLanguage;
  terms: string | null;
};

/** What a booking said when it was approved: enough to list what changed since. */
export type BookingSnapshot = {
  number: string;
  supplier: { id: string; name: string };
  expectedDate: string | null;
  garmentPieces: number | null;
  lines: Array<{
    code: string;
    name: string;
    unit: MeasurementUnit;
    quantity: string;
    unitPrice: string;
    priceLater: boolean;
    role: LineRole;
    /** The specification as printed ("220 GSM · 72\" open · 30/1"). */
    specs: string;
    /** The quantity for each style and colour it is shared out to ("PRD-2026-00009 · Navy"). */
    shares: Array<{ label: string; quantity: string }>;
  }>;
  collar: {
    style: string;
    extraPercent: number;
    totalSets: number;
    cells: Array<{ label: string; sets: number }>;
  } | null;
  /** The master batch it is for (its code; null: on its own). Kept from v6.3 on. */
  batch?: string | null;
  /** The paperwork printed on it. Kept from v6.3 on. */
  paperwork?: BookingPaperwork;
};

export type RevisionChange = {
  item: string;
  was: string;
  now: string;
  /** A price: shown only to people who may see material prices. */
  cost?: boolean;
};

export type RevisionChanges = {
  /** The approved revision it changed from. */
  from: number;
  /** Whether that revision had been sent to the supplier. */
  wasSent: boolean;
  changes: RevisionChange[];
  /** Fabric the supplier may have started on: the lines that changed or went, as booked. */
  atRisk: Array<{ unit: MeasurementUnit; quantity: string }>;
};

const unitText = (unit: MeasurementUnit) => UNIT_LABELS[unit] ?? unit.toLowerCase();
const amountOf = (quantity: string, unit: MeasurementUnit) => `${quantity} ${unitText(unit)}`;
const num = (n: number) => String(Number(n.toFixed(3)));

/** The changes from one approved snapshot to the booking as it is now. */
export function diffSnapshots(was: BookingSnapshot, now: BookingSnapshot): RevisionChange[] {
  const changes: RevisionChange[] = [];
  if (was.supplier.id !== now.supplier.id) {
    changes.push({ item: "Supplier", was: was.supplier.name, now: now.supplier.name });
  }
  if (was.expectedDate !== now.expectedDate) {
    changes.push({
      item: "In-house date",
      was: was.expectedDate ?? "Not set",
      now: now.expectedDate ?? "Not set",
    });
  }
  if (was.garmentPieces !== now.garmentPieces) {
    changes.push({
      item: "Garment pieces",
      was: was.garmentPieces === null ? "Not set" : String(was.garmentPieces),
      now: now.garmentPieces === null ? "Not set" : String(now.garmentPieces),
    });
  }
  if (was.batch !== undefined && now.batch !== undefined && was.batch !== now.batch) {
    changes.push({ item: "Master batch", was: was.batch ?? "None", now: now.batch ?? "None" });
  }
  if (was.paperwork && now.paperwork)
    changes.push(...paperworkChanges(was.paperwork, now.paperwork));
  const before = new Map(was.lines.map((l) => [l.code, l]));
  const after = new Map(now.lines.map((l) => [l.code, l]));
  for (const [code, old] of before) {
    const line = after.get(code);
    const name = `${code} ${old.name}`;
    if (!line) {
      changes.push({ item: name, was: amountOf(old.quantity, old.unit), now: "Taken off" });
      continue;
    }
    if (old.quantity !== line.quantity || old.unit !== line.unit) {
      changes.push({
        item: `${name}: quantity`,
        was: amountOf(old.quantity, old.unit),
        now: amountOf(line.quantity, line.unit),
      });
    }
    if (old.specs !== line.specs) {
      changes.push({
        item: `${name}: specification`,
        was: old.specs || "None",
        now: line.specs || "None",
      });
    }
    if (old.unitPrice !== line.unitPrice || old.priceLater !== line.priceLater) {
      changes.push({
        item: `${name}: price`,
        was: old.priceLater ? "At receive" : old.unitPrice,
        now: line.priceLater ? "At receive" : line.unitPrice,
        cost: true,
      });
    }
    const oldShares = new Map(old.shares.map((s) => [s.label, s.quantity]));
    const newShares = new Map(line.shares.map((s) => [s.label, s.quantity]));
    for (const label of new Set([...oldShares.keys(), ...newShares.keys()])) {
      const a = oldShares.get(label);
      const b = newShares.get(label);
      if (a === b) continue;
      changes.push({
        item: `${name}: ${label}`,
        was: a === undefined ? "None" : amountOf(a, old.unit),
        now: b === undefined ? "None" : amountOf(b, line.unit),
      });
    }
  }
  for (const [code, line] of after) {
    if (before.has(code)) continue;
    changes.push({
      item: `${code} ${line.name}`,
      was: "Not booked",
      now: amountOf(line.quantity, line.unit),
    });
  }
  const oc = was.collar;
  const nc = now.collar;
  if (oc || nc) {
    const style = (c: BookingSnapshot["collar"]) =>
      c ? (COLLAR_STYLE_LABELS[c.style as keyof typeof COLLAR_STYLE_LABELS] ?? c.style) : "None";
    if (oc?.style !== nc?.style) {
      changes.push({ item: "Collar and cuff style", was: style(oc), now: style(nc) });
    }
    if (oc && nc && oc.extraPercent !== nc.extraPercent) {
      changes.push({
        item: "Collar and cuff extra",
        was: `${num(oc.extraPercent)}%`,
        now: `${num(nc.extraPercent)}%`,
      });
    }
    const oldCells = new Map(oc?.cells.map((c) => [c.label, c.sets]) ?? []);
    const newCells = new Map(nc?.cells.map((c) => [c.label, c.sets]) ?? []);
    const cellChanges = [...new Set([...oldCells.keys(), ...newCells.keys()])].filter(
      (label) => oldCells.get(label) !== newCells.get(label),
    );
    for (const label of cellChanges) {
      changes.push({
        item: `Collar sets: ${label}`,
        was: String(oldCells.get(label) ?? 0),
        now: String(newCells.get(label) ?? 0),
      });
    }
  }
  return changes;
}

const orNotSet = (text: string | null) => text?.trim() || "Not set";

/** The first line two texts differ on, with how many more lines differ ("…, +2 more lines"). */
export function firstDifference(was: string, now: string): { was: string; now: string } | null {
  const a = was.trim().split(/\r?\n/);
  const b = now.trim().split(/\r?\n/);
  const differ: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? "").trim() !== (b[i] ?? "").trim()) differ.push(i);
  }
  if (differ.length === 0) return null;
  const at = differ[0]!;
  const line = (text: string | undefined) => text?.trim() || "None";
  const more =
    differ.length > 1 ? ` (+${differ.length - 1} more line${differ.length > 2 ? "s" : ""})` : "";
  return { was: `Line ${at + 1}: ${line(a[at])}`, now: `Line ${at + 1}: ${line(b[at])}${more}` };
}

/** What changed in the paperwork the supplier is sent. */
export function paperworkChanges(was: BookingPaperwork, now: BookingPaperwork): RevisionChange[] {
  const changes: RevisionChange[] = [];
  if (orNotSet(was.deliveryPlace) !== orNotSet(now.deliveryPlace)) {
    changes.push({
      item: "Delivery place",
      was: orNotSet(was.deliveryPlace),
      now: orNotSet(now.deliveryPlace),
    });
  }
  if (orNotSet(was.paymentTerms) !== orNotSet(now.paymentTerms)) {
    changes.push({
      item: "Payment terms",
      was: orNotSet(was.paymentTerms),
      now: orNotSet(now.paymentTerms),
    });
  }
  if (was.termsLanguage !== now.termsLanguage) {
    changes.push({
      item: "Terms language",
      was: LANGUAGE_LABELS[was.termsLanguage] ?? was.termsLanguage,
      now: LANGUAGE_LABELS[now.termsLanguage] ?? now.termsLanguage,
    });
  }
  const terms = firstDifference(was.terms ?? "", now.terms ?? "");
  if (terms) changes.push({ item: "Terms and conditions", ...terms });
  return changes;
}

/**
 * Fabric the supplier may have started on when an approved booking it had been
 * sent changes: each fabric line of the sent revision that is taken off, or
 * whose quantity, unit or specification changed, at its booked quantity.
 */
export function fabricAtRisk(
  was: BookingSnapshot,
  now: BookingSnapshot,
): Array<{ unit: MeasurementUnit; quantity: string }> {
  const after = new Map(now.lines.map((l) => [l.code, l]));
  const byUnit = new Map<MeasurementUnit, number>();
  for (const old of was.lines) {
    if (old.role !== "FABRIC") continue;
    const line = after.get(old.code);
    const changed =
      !line ||
      line.quantity !== old.quantity ||
      line.unit !== old.unit ||
      line.specs !== old.specs ||
      JSON.stringify(line.shares) !== JSON.stringify(old.shares);
    if (!changed) continue;
    byUnit.set(old.unit, (byUnit.get(old.unit) ?? 0) + Number(old.quantity));
  }
  return [...byUnit].map(([unit, total]) => ({ unit, quantity: num(total) }));
}

/** The changes of a draft revision, for someone who may or may not see prices. */
export function visibleChanges(
  changes: RevisionChanges | null,
  seeCosts: boolean,
): RevisionChanges | null {
  if (!changes) return null;
  return seeCosts ? changes : { ...changes, changes: changes.changes.filter((c) => !c.cost) };
}

/** Reads the stored changes of a draft revision (null when there are none or they cannot be read). */
export function readRevisionChanges(json: unknown): RevisionChanges | null {
  if (!json || typeof json !== "object") return null;
  const value = json as Partial<RevisionChanges>;
  if (typeof value.from !== "number" || !Array.isArray(value.changes)) return null;
  return {
    from: value.from,
    wasSent: Boolean(value.wasSent),
    changes: value.changes.filter(
      (c): c is RevisionChange =>
        Boolean(c) &&
        typeof c.item === "string" &&
        typeof c.was === "string" &&
        typeof c.now === "string",
    ),
    atRisk: Array.isArray(value.atRisk) ? value.atRisk : [],
  };
}

/** "124 kg + 30 yd", or "none". */
export function atRiskText(atRisk: RevisionChanges["atRisk"]): string {
  return atRisk.length === 0 ? "none" : atRisk.map((a) => amountOf(a.quantity, a.unit)).join(" + ");
}
