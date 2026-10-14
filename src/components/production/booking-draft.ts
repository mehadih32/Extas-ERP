import type {
  BookingSource,
  CollarStyle,
  DocumentLanguage,
  GarmentCategory,
  MeasurementUnit,
  RawMaterialKind,
} from "@prisma/client";

import { quantity as quantityText, readPrice, readQuantity } from "@/components/materials/labels";
import {
  collarTotals,
  fabricFor,
  type LineSpecs,
  matrixQuantity,
} from "@/modules/production/booking-math";
import {
  CATEGORY_PRESETS,
  DEFAULT_COLLAR_EXTRA,
  DEFAULT_COLLAR_SIZES,
  type DiaType,
  type LineRole,
  type SpecField,
  TRIM_FIELDS,
  type WeightUnit,
} from "@/modules/production/booking-presets";
import type {
  BookingBatchPick,
  BookingForm,
  BookingFormCollar,
  BookingFormLine,
} from "@/modules/production/booking.service";
import { standardTermsText, termLines } from "@/modules/production/booking-terms";

/*
 * The booking wizard's working copy, kept as typed text so a half-typed number
 * never jumps about, and turned into what createBookingAction takes only on
 * save. Every rule the server checks is checked here first, per step, with the
 * same field names (`lines.2.quantity`, `collar.colours.0.pieces.1`), so the
 * server's own answer lands on the same fields. Plain functions with no React,
 * so they are tested on their own.
 */

export const STEPS = ["setup", "fabric", "trims", "collar", "terms"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  setup: "Booking type",
  fabric: "Fabric",
  trims: "Trims & accessories",
  collar: "Collar & cuff",
  terms: "Terms & review",
};

/** Spec text fields, as typed. */
export type DraftSpecs = Record<SpecField, string> & {
  weightUnit: WeightUnit;
  diaType: DiaType | "";
};

export type DraftLine = {
  key: string;
  role: LineRole;
  /** A catalogue material, or null for a new one named here. */
  material: {
    id: string;
    code: string;
    name: string;
    kind: RawMaterialKind;
    unit: MeasurementUnit;
  } | null;
  name: string;
  kind: RawMaterialKind;
  unit: MeasurementUnit;
  quantity: string;
  unitPrice: string;
  description: string;
  imageId: string | null;
  specs: DraftSpecs;
  /** The fabric calculator: worked out from pieces, consumption per dozen and loss. */
  calc: { on: boolean; pieces: string; perDozen: string; loss: string };
  /** What the details field suggests (from the family's preset). */
  hint?: string;
};

export type DraftCollar = {
  on: boolean;
  style: CollarStyle;
  extraPercent: string;
  notes: string;
  sizes: Array<{
    key: string;
    label: string;
    collarLength: string;
    collarWidth: string;
    cuffLength: string;
    cuffWidth: string;
  }>;
  colours: Array<{
    key: string;
    garmentColour: string;
    collarColour: string;
    tippingColour: string;
    pieces: string[];
  }>;
};

export type Draft = {
  source: BookingSource;
  category: GarmentCategory;
  supplier: { id: string; code: string; name: string } | null;
  expectedDate: string;
  supplierRef: string;
  title: string;
  styleRef: string;
  garmentPieces: string;
  deliveryPlace: string;
  paymentTerms: string;
  termsLanguage: DocumentLanguage;
  /** One condition per entry. */
  terms: string[];
  notes: string;
  lines: DraftLine[];
  collar: DraftCollar;
  /** A market purchase bought and collected: into the store as it is saved. */
  receiveNow: boolean;
};

/** True when this draft's goods go into stock as it is saved (a market purchase only). */
export const receivesNow = (draft: Pick<Draft, "source" | "receiveNow">) =>
  draft.source === "MARKET_PURCHASE" && draft.receiveNow;

let counter = 0;
/** A key for a new row (React lists), unique within the page. */
export const newKey = (prefix = "row") => `${prefix}-${Date.now().toString(36)}-${counter++}`;

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function draftSpecs(specs: Partial<LineSpecs> = {}): DraftSpecs {
  return {
    fabricType: text(specs.fabricType),
    composition: text(specs.composition),
    colour: text(specs.colour),
    weight: text(specs.weight),
    dia: text(specs.dia),
    width: text(specs.width),
    construction: text(specs.construction),
    yarnCount: text(specs.yarnCount),
    gauge: text(specs.gauge),
    finish: text(specs.finish),
    size: text(specs.size),
    weightUnit: specs.weightUnit ?? "GSM",
    diaType: specs.diaType ?? "",
  };
}

/** The line a garment family starts its fabric (or yarn) with. */
export function fabricLine(category: GarmentCategory, garmentPieces = ""): DraftLine {
  const preset = CATEGORY_PRESETS[category];
  return {
    key: newKey("fabric"),
    role: "FABRIC",
    material: null,
    name: preset.fabricName,
    kind: "FABRIC",
    unit: preset.fabricUnit,
    quantity: "",
    unitPrice: "",
    description: "",
    imageId: null,
    specs: draftSpecs({
      weightUnit: preset.weightUnits[0] ?? "GSM",
      diaType: category === "KNITWEAR" ? "OPEN" : null,
    }),
    calc: { on: false, pieces: garmentPieces, perDozen: "", loss: String(preset.processLoss) },
  };
}

/** The trims a garment family starts with (collar, cuff, twill tape, button for knitwear). */
export function presetTrimLines(category: GarmentCategory): DraftLine[] {
  return CATEGORY_PRESETS[category].trims.map((t) => ({
    key: newKey("trim"),
    role: t.role,
    material: null,
    name: t.name,
    kind: t.kind,
    unit: t.unit,
    quantity: "",
    unitPrice: "",
    description: "",
    imageId: null,
    specs: draftSpecs(),
    calc: { on: false, pieces: "", perDozen: "", loss: "0" },
    hint: t.detailsHint,
  }));
}

/** A blank "Add custom item" row. */
export function customLine(role: LineRole = "TRIM"): DraftLine {
  return {
    key: newKey("custom"),
    role,
    material: null,
    name: "",
    kind: role === "FABRIC" ? "FABRIC" : "TRIM",
    unit: role === "FABRIC" ? "KG" : "PCS",
    quantity: "",
    unitPrice: "",
    description: "",
    imageId: null,
    specs: draftSpecs(),
    calc: { on: false, pieces: "", perDozen: "", loss: "0" },
  };
}

export function draftLine(line: BookingFormLine, garmentPieces = ""): DraftLine {
  const s = line.specs;
  const calcOn = Boolean(s.pieces && s.perDozen);
  return {
    key: newKey("line"),
    role: s.role,
    material: line.material,
    name: line.name,
    kind: line.kind,
    unit: line.unit,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    description: line.description,
    imageId: line.imageId,
    specs: draftSpecs(s),
    calc: {
      on: calcOn,
      pieces: s.pieces ? String(s.pieces) : garmentPieces,
      perDozen: s.perDozen ? String(s.perDozen) : "",
      loss: s.lossPercent != null ? String(s.lossPercent) : "0",
    },
  };
}

/** One of the batch's materials, added with a tap (the role guessed from its name and placement). */
export function lineFromPick(pick: BookingBatchPick, garmentPieces = ""): DraftLine {
  const where = `${pick.material.name} ${pick.placements.join(" ")}`;
  const role: LineRole =
    pick.material.kind === "FABRIC"
      ? "FABRIC"
      : /collar/i.test(where)
        ? "COLLAR"
        : /cuff/i.test(where)
          ? "CUFF"
          : "TRIM";
  return {
    key: newKey("pick"),
    role,
    material: {
      id: pick.material.id,
      code: pick.material.code,
      name: pick.material.name,
      kind: pick.material.kind,
      unit: pick.material.unit,
    },
    name: pick.material.name,
    kind: pick.material.kind,
    unit: pick.material.unit,
    quantity: /[1-9]/.test(pick.toOrder) ? pick.toOrder : "",
    unitPrice: "",
    description: pick.placements.join(", "),
    imageId: pick.imageId,
    specs: draftSpecs({ colour: pick.material.color }),
    calc: {
      on: false,
      pieces: garmentPieces,
      perDozen: "",
      loss: role === "FABRIC" ? "10" : "0",
    },
  };
}

export function blankCollar(): DraftCollar {
  return {
    on: false,
    style: "SOLID",
    extraPercent: String(DEFAULT_COLLAR_EXTRA),
    notes: "",
    sizes: DEFAULT_COLLAR_SIZES.map((s) => ({
      key: newKey("size"),
      label: s.label,
      collarLength: String(s.collarLength),
      collarWidth: String(s.collarWidth),
      cuffLength: String(s.cuffLength),
      cuffWidth: String(s.cuffWidth),
    })),
    colours: [blankColour(DEFAULT_COLLAR_SIZES.length)],
  };
}

export function blankColour(sizes: number): DraftCollar["colours"][number] {
  return {
    key: newKey("colour"),
    garmentColour: "",
    collarColour: "",
    tippingColour: "",
    pieces: Array.from({ length: sizes }, () => ""),
  };
}

export function draftCollar(collar: BookingFormCollar | null): DraftCollar {
  if (!collar) return blankCollar();
  return {
    on: true,
    style: collar.style,
    extraPercent: String(collar.extraPercent),
    notes: collar.notes,
    sizes: collar.sizes.map((s) => ({
      key: newKey("size"),
      label: s.label,
      collarLength: String(s.collarLength),
      collarWidth: String(s.collarWidth),
      cuffLength: s.cuffLength === null ? "" : String(s.cuffLength),
      cuffWidth: s.cuffWidth === null ? "" : String(s.cuffWidth),
    })),
    colours: collar.colours.map((c) => ({
      key: newKey("colour"),
      garmentColour: c.garmentColour,
      collarColour: c.collarColour === c.garmentColour ? "" : c.collarColour,
      tippingColour: c.tippingColour,
      pieces: c.pieces.map((p) => (p ? String(p) : "")),
    })),
  };
}

/** The standard terms, one condition per entry. */
export const standardTermList = (
  source: BookingSource,
  category: GarmentCategory,
  language: DocumentLanguage,
  collar: boolean,
) => termLines(standardTermsText(source, category, language, { collar }));

/** The wizard's starting copy: the booking to change, or a new one with its family's presets. */
export function startDraft(form: BookingForm): Draft {
  const v = form.values;
  const pieces = v.garmentPieces ? String(v.garmentPieces) : "";
  const editing = Boolean(form.booking);
  let lines = v.lines.map((l) => draftLine(l, pieces));
  const collar = draftCollar(v.collar);
  if (!editing) {
    if (!lines.some((l) => l.role === "FABRIC")) lines = [fabricLine(v.category, pieces), ...lines];
    if (!form.batch) {
      lines = [...lines, ...presetTrimLines(v.category)];
    } else if (collar.on && !lines.some((l) => l.role === "COLLAR" || l.role === "CUFF")) {
      // A batch's knitwear books its collars and cuffs by the matrix: start with both.
      lines = [
        ...lines,
        ...presetTrimLines(v.category).filter((l) => l.role === "COLLAR" || l.role === "CUFF"),
      ];
    }
    if (!collar.on && CATEGORY_PRESETS[v.category].collarMatrix) collar.on = true;
  }
  const terms = v.terms
    ? termLines(v.terms)
    : standardTermList(v.source, v.category, v.termsLanguage, collar.on);
  return {
    source: v.source,
    category: v.category,
    supplier: v.supplier,
    expectedDate: v.expectedDate,
    supplierRef: v.supplierRef,
    title: v.title,
    styleRef: v.styleRef,
    garmentPieces: pieces,
    deliveryPlace: v.deliveryPlace,
    paymentTerms: v.paymentTerms,
    termsLanguage: v.termsLanguage,
    terms,
    notes: v.notes,
    lines,
    collar,
    receiveNow: false,
  };
}

/** True when the items are still the family's untouched presets (safe to swap for another family's). */
export function untouchedItems(draft: Draft): boolean {
  return draft.lines.every(
    (l) =>
      !l.material &&
      !l.quantity.trim() &&
      !l.unitPrice.trim() &&
      !l.description.trim() &&
      Object.entries(l.specs).every(
        ([k, v]) => k === "weightUnit" || k === "diaType" || !String(v).trim(),
      ),
  );
}

/** Swaps the items for a garment family's presets, keeping the pieces for the calculator. */
export function itemsFor(category: GarmentCategory, garmentPieces: string): DraftLine[] {
  return [fabricLine(category, garmentPieces), ...presetTrimLines(category)];
}

// =============================================================================
// Reading numbers
// =============================================================================

/** A number typed in a form, or the message to show: up to `decimals` places, within `max`. */
export function readNumber(
  value: string,
  { decimals = 2, max = 1_000_000, allowZero = false, label = "a number" } = {},
): number | string {
  const v = value.trim().replace(/,/g, "");
  if (!v) return `Enter ${label}.`;
  const pattern = decimals > 0 ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
  if (!pattern.test(v)) {
    return decimals > 0
      ? `Enter ${label} with up to ${decimals} decimals.`
      : `Enter ${label} as a whole number.`;
  }
  const n = Number(v);
  if (n > max) return `That is more than ${max.toLocaleString("en")}.`;
  if (!allowZero && n <= 0) return "Enter more than zero.";
  return n;
}

const optional = (v: string) => (v.trim() ? v.trim() : null);

/** Pieces of each colour and size group as numbers (empty or wrong counts as 0). */
export const piecesOf = (collar: DraftCollar) =>
  collar.colours.map((c) =>
    collar.sizes.map((_, i) => {
      const n = Number((c.pieces[i] ?? "").replace(/,/g, ""));
      return Number.isInteger(n) && n > 0 ? n : 0;
    }),
  );

/** The matrix's live totals for the screen. */
export function liveCollarTotals(collar: DraftCollar) {
  const extra = Number(collar.extraPercent.replace(/,/g, ""));
  return collarTotals({
    extraPercent: Number.isFinite(extra) && extra >= 0 ? extra : 0,
    sizes: collar.sizes,
    colours: piecesOf(collar).map((pieces) => ({ pieces })),
  });
}

/** What a line's quantity comes to now: from the matrix, the calculator, or as typed. */
export function lineQuantity(
  line: DraftLine,
  collar: DraftCollar,
): { source: "matrix" | "calculator" | "typed"; value: number | null } {
  if (collar.on && (line.role === "COLLAR" || line.role === "CUFF")) {
    const sets = liveCollarTotals(collar).totalSets;
    return { source: "matrix", value: matrixQuantity(line.role, line.unit, sets) };
  }
  if (line.calc.on) {
    const pieces = Number(line.calc.pieces.replace(/,/g, ""));
    const perDozen = Number(line.calc.perDozen.replace(/,/g, ""));
    const loss = Number(line.calc.loss.replace(/,/g, "") || "0");
    const value =
      pieces > 0 && perDozen > 0 && loss >= 0 ? fabricFor(pieces, perDozen, loss, line.unit) : 0;
    return { source: "calculator", value: value || null };
  }
  const typed = Number(line.quantity.replace(/,/g, ""));
  return { source: "typed", value: line.quantity.trim() && typed > 0 ? typed : null };
}

// =============================================================================
// Checking and building what the server takes
// =============================================================================

type Problems = Record<string, string>;

const NUMERIC: Partial<Record<SpecField, { decimals: number; max: number; label: string }>> = {
  weight: { decimals: 2, max: 10_000, label: "the weight" },
  dia: { decimals: 2, max: 200, label: "the DIA" },
  width: { decimals: 2, max: 500, label: "the width" },
  gauge: { decimals: 2, max: 100, label: "the gauge" },
};

/** The fields a line shows: the family's for fabric, colour and details for the rest. */
export const fieldsOf = (line: DraftLine, category: GarmentCategory): readonly SpecField[] =>
  line.role === "FABRIC" ? CATEGORY_PRESETS[category].fabricFields : TRIM_FIELDS;

function lineInput(
  line: DraftLine,
  i: number,
  draft: Draft,
  problems: Problems,
): Record<string, unknown> {
  const at = (field: string) => `lines.${i}.${field}`;
  const specs: Record<string, unknown> = { role: line.role };
  for (const field of fieldsOf(line, draft.category)) {
    const value = line.specs[field].trim();
    if (!value) continue;
    const numeric = NUMERIC[field];
    if (numeric) {
      const n = readNumber(value, numeric);
      if (typeof n === "string") problems[at(`specs.${field}`)] = n;
      else specs[field] = n;
    } else {
      specs[field] = value;
    }
  }
  if (specs.weight !== undefined) specs.weightUnit = line.specs.weightUnit;
  if (line.role === "FABRIC" && draft.category === "KNITWEAR" && line.specs.diaType) {
    specs.diaType = line.specs.diaType;
  }
  if (!line.material) {
    if (line.name.trim().length < 2) problems[at("name")] = "Name the item (2 letters or more).";
  }
  const fromMatrix = draft.collar.on && (line.role === "COLLAR" || line.role === "CUFF");
  let quantity: number | null = null;
  if (fromMatrix) {
    if (line.unit !== "PCS" && line.unit !== "SET") {
      problems[at("unit")] = "Count collars and cuffs in pieces or sets.";
    }
  } else if (line.calc.on) {
    const pieces = readNumber(line.calc.pieces, {
      decimals: 0,
      max: 10_000_000,
      label: "the pieces",
    });
    const perDozen = readNumber(line.calc.perDozen, {
      decimals: 3,
      max: 100_000,
      label: "the consumption per dozen",
    });
    const loss = readNumber(line.calc.loss || "0", {
      decimals: 2,
      max: 100,
      allowZero: true,
      label: "the process loss",
    });
    if (typeof pieces === "string") problems[at("specs.pieces")] = pieces;
    if (typeof perDozen === "string") problems[at("specs.perDozen")] = perDozen;
    if (typeof loss === "string") problems[at("specs.lossPercent")] = loss;
    if (typeof pieces === "number" && typeof perDozen === "number" && typeof loss === "number") {
      specs.pieces = pieces;
      specs.perDozen = perDozen;
      specs.lossPercent = loss;
    }
  } else {
    const q = readQuantity(line.quantity, line.unit);
    if (typeof q === "string") {
      problems[at("quantity")] = line.quantity.trim()
        ? q
        : "Enter the quantity, or remove the item.";
    } else quantity = q;
  }
  let unitPrice: number | null = null;
  if (line.unitPrice.trim()) {
    const p = readPrice(line.unitPrice);
    if (typeof p === "string") problems[at("unitPrice")] = p;
    else unitPrice = p;
  } else if (receivesNow(draft)) {
    problems[at("unitPrice")] = "Enter the price paid: the goods go into stock now.";
  }
  return {
    ...(line.material
      ? { materialId: line.material.id }
      : { name: line.name.trim(), kind: line.kind, unit: line.unit }),
    ...(quantity !== null ? { quantity } : {}),
    unitPrice,
    description: optional(line.description),
    imageId: line.imageId,
    specs,
  };
}

function collarInput(draft: Draft, problems: Problems) {
  const c = draft.collar;
  if (!c.on) return null;
  const extra = readNumber(c.extraPercent || "0", {
    decimals: 2,
    max: 50,
    allowZero: true,
    label: "the extra percent",
  });
  if (typeof extra === "string") problems["collar.extraPercent"] = extra;
  const labels = new Set<string>();
  const cm = (value: string, key: string, label: string, required: boolean) => {
    if (!value.trim()) {
      if (required) problems[key] = `Enter the ${label}.`;
      return null;
    }
    const n = readNumber(value, { decimals: 2, max: 500, label: `the ${label}` });
    if (typeof n === "string") {
      problems[key] = n;
      return null;
    }
    return n;
  };
  if (c.sizes.length === 0) problems["collar.sizes"] = "Add at least one size group.";
  const sizes = c.sizes.map((s, i) => {
    const at = `collar.sizes.${i}`;
    const label = s.label.trim();
    if (!label) problems[`${at}.label`] = "Name the size group, like S-M.";
    else if (labels.has(label.toUpperCase()))
      problems[`${at}.label`] = "This size group is given twice.";
    labels.add(label.toUpperCase());
    const cuffLength = cm(s.cuffLength, `${at}.cuffLength`, "cuff length", false);
    const cuffWidth = cm(s.cuffWidth, `${at}.cuffWidth`, "cuff width", false);
    if ((cuffLength === null) !== (cuffWidth === null) && !problems[`${at}.cuffWidth`]) {
      problems[`${at}.cuffWidth`] = "Give both cuff measurements, or neither.";
    }
    return {
      label,
      collarLength: cm(s.collarLength, `${at}.collarLength`, "collar length", true),
      collarWidth: cm(s.collarWidth, `${at}.collarWidth`, "collar width", true),
      cuffLength,
      cuffWidth,
    };
  });
  const colourNames = new Set<string>();
  if (c.colours.length === 0) problems["collar.colours"] = "Add at least one garment colour.";
  const colours = c.colours.map((row, i) => {
    const at = `collar.colours.${i}`;
    const name = row.garmentColour.trim();
    if (!name) problems[`${at}.garmentColour`] = "Name the garment colour.";
    else if (colourNames.has(name.toUpperCase())) {
      problems[`${at}.garmentColour`] = "This colour is given twice.";
    }
    colourNames.add(name.toUpperCase());
    const pieces = c.sizes.map((_, j) => {
      const v = (row.pieces[j] ?? "").trim();
      if (!v) return 0;
      const n = readNumber(v, {
        decimals: 0,
        max: 1_000_000,
        allowZero: true,
        label: "the pieces",
      });
      if (typeof n === "string") {
        problems[`${at}.pieces.${j}`] = n;
        return 0;
      }
      return n;
    });
    return {
      garmentColour: name,
      collarColour: optional(row.collarColour),
      tippingColour: c.style === "TIPPING" ? optional(row.tippingColour) : null,
      pieces,
    };
  });
  if (
    colours.length > 0 &&
    colours.every((row) => row.pieces.every((p) => p === 0)) &&
    !Object.keys(problems).some((k) => k.startsWith("collar.colours"))
  ) {
    problems["collar.colours"] = "Enter the garment pieces to book collars and cuffs for.";
  }
  if (!draft.lines.some((l) => l.role === "COLLAR" || l.role === "CUFF")) {
    problems.collar = "Add a Collar or Cuff item on the trims step, or turn the matrix off.";
  }
  return {
    style: c.style,
    extraPercent: typeof extra === "number" ? extra : 0,
    notes: optional(c.notes),
    sizes,
    colours,
  };
}

/** The booking as createBookingAction / updateBookingAction take it, with the problems found. */
export function buildInput(draft: Draft, today: string) {
  const problems: Problems = {};
  if (!draft.supplier) {
    problems.supplierId =
      draft.source === "MARKET_PURCHASE" ? "Choose the shop or seller." : "Choose the supplier.";
  }
  const intoStock = receivesNow(draft);
  if (draft.expectedDate && draft.expectedDate < today && !intoStock) {
    problems.expectedDate = "Choose today or a later day.";
  }
  let garmentPieces: number | null = null;
  if (draft.garmentPieces.trim()) {
    const n = readNumber(draft.garmentPieces, {
      decimals: 0,
      max: 10_000_000,
      label: "the garment pieces",
    });
    if (typeof n === "string") problems.garmentPieces = n;
    else garmentPieces = n;
  }
  if (draft.lines.length === 0) problems.lines = "Add at least one item to book.";
  if (draft.lines.length > 60) problems.lines = "A booking takes up to 60 items.";
  const lines = draft.lines.map((l, i) => lineInput(l, i, draft, problems));
  const collar = collarInput(draft, problems);
  const terms = draft.terms.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (terms.join("\n").length > 12_000)
    problems.terms = "The terms are too long (12,000 letters at most).";
  return {
    input: {
      source: draft.source,
      category: draft.category,
      supplierId: draft.supplier?.id ?? "",
      expectedDate: intoStock ? null : draft.expectedDate || null,
      supplierRef: optional(draft.supplierRef),
      title: optional(draft.title),
      styleRef: optional(draft.styleRef),
      garmentPieces,
      deliveryPlace: optional(draft.deliveryPlace),
      paymentTerms: optional(draft.paymentTerms),
      termsLanguage: draft.termsLanguage,
      terms: terms.length > 0 ? terms.join("\n") : null,
      notes: optional(draft.notes),
      collar,
      lines,
      receiveNow: intoStock,
    },
    problems,
  };
}

/** The paperwork alone (updateBookingPaperworkAction), for a booking whose items are fixed. */
export function buildPaperwork(draft: Draft, orderDate: string) {
  const problems: Problems = {};
  if (draft.expectedDate && draft.expectedDate < orderDate) {
    problems.expectedDate = "Choose a day on or after the booking date.";
  }
  const terms = draft.terms.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  return {
    input: {
      expectedDate: draft.expectedDate || null,
      supplierRef: optional(draft.supplierRef),
      title: optional(draft.title),
      styleRef: optional(draft.styleRef),
      deliveryPlace: optional(draft.deliveryPlace),
      paymentTerms: optional(draft.paymentTerms),
      termsLanguage: draft.termsLanguage,
      terms: terms.length > 0 ? terms.join("\n") : null,
      notes: optional(draft.notes),
    },
    problems,
  };
}

/** The step a field's problem shows on. */
export function stepOf(field: string, draft: Draft): Step {
  const line = /^lines\.(\d+)\./.exec(field);
  if (line) return draft.lines[Number(line[1])]?.role === "FABRIC" ? "fabric" : "trims";
  if (field === "lines") return "fabric";
  if (field.startsWith("collar")) return "collar";
  if (/^(terms|termsLanguage|paymentTerms|deliveryPlace|notes)/.test(field)) return "terms";
  return "setup";
}

/** The steps this booking shows (the collar step only where collars are booked by matrix). */
export function stepsFor(draft: Pick<Draft, "category" | "collar">): Step[] {
  return STEPS.filter(
    (s) => s !== "collar" || CATEGORY_PRESETS[draft.category].collarMatrix || draft.collar.on,
  );
}

/** "1,234.5 kg" for a quantity worked out on the screen. */
export const quantityLabel = (value: number, unit: MeasurementUnit, currency: string) =>
  quantityText(String(Number(value.toFixed(3))), unit, currency);
