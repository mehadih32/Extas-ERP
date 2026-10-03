import { createHash } from "node:crypto";

/*
 * A printed document as plain data: every word and number on the page, already
 * formatted. The builders (builders.ts) fill it from the sales, ledger and stock
 * data; the writer (render.ts) only lays it out on letterhead. Because the model
 * holds everything printed, its hash says whether a stored PDF still shows the
 * same thing, so an unchanged document is never made twice.
 */

/** The documents that can be printed (a subset of the DocumentType enum). */
export const PRINT_TYPES = [
  "QUOTATION",
  "PROFORMA_INVOICE",
  "COMMERCIAL_INVOICE",
  "DELIVERY_CHALLAN",
  "LEDGER_STATEMENT",
  "STOCK_AVAILABILITY",
  "LETTERHEAD",
] as const;

export type PrintType = (typeof PRINT_TYPES)[number];

/**
 * Bump when the layout changes, so documents printed again get the new look.
 * 2: Bengali text prints in Noto Sans Bengali instead of "?".
 */
export const LAYOUT_VERSION = 2;

export type Letterhead = {
  name: string;
  legalName: string | null;
  /** Address and contact lines shown at the top right. */
  contacts: string[];
  /** The footer line (company setting, or the name and website). */
  footer: string;
  primaryColor: string;
  accentColor: string;
};

export type Align = "left" | "right" | "center";

export type Column = {
  label: string;
  align?: Align;
  /** Relative width (default 1). */
  weight?: number;
};

/** normal rows alternate shading; subtotal and total rows are bold with a rule above. */
export type RowStyle = "normal" | "subtotal" | "total";

export type Row = {
  cells: string[];
  style?: RowStyle;
  /** Smaller lines under the first wide text cell (fabric, sizes, SKU...). */
  details?: string[];
  /** A colour swatch before the first cell ("#1F2A44"). */
  swatch?: string;
};

export type Block =
  | { kind: "table"; title?: string; columns: Column[]; rows: Row[]; empty?: string }
  | {
      kind: "totals";
      rows: Array<{ label: string; value: string; strong?: boolean }>;
      /** "Taka Twelve Thousand Five Hundred Only" */
      words?: string;
    }
  | { kind: "figures"; figures: Array<{ label: string; value: string; hint?: string }> }
  | { kind: "text"; title: string; paragraphs: string[] }
  | { kind: "list"; title: string; items: Array<{ label?: string; text: string }> }
  | { kind: "note"; text: string }
  | { kind: "pageBreak" };

export type Stamp = {
  text: string;
  /** danger: a faint diagonal watermark on every page (VOID); success: a badge (PAID). */
  tone: "danger" | "success";
};

export type PrintDocument = {
  type: PrintType;
  /** "Commercial Invoice"; empty for the blank letterhead. */
  title: string;
  /** A line under the title ("Rahim Traders", "Brand: Extras Men"). */
  subtitle?: string;
  /** The document number or short reference, shown in footers ("INV-2026-00042"). */
  reference?: string;
  letterhead: Letterhead;
  stamp?: Stamp;
  /** Label / value pairs beside the title: number, dates, order... */
  meta: Array<{ label: string; value: string }>;
  /** Address boxes: "Bill to", "Deliver to"... */
  parties: Array<{ heading: string; lines: string[] }>;
  blocks: Block[];
  /** Signature lines at the end ("Authorised signature"). */
  signatures: string[];
};

/** Recursively key-sorted JSON, so the hash never depends on key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of everything that ends up on the page: the model, the logo and the layout version. */
export function contentHash(doc: PrintDocument, logoChecksum: string | null): string {
  return createHash("sha256")
    .update(stableJson({ layout: LAYOUT_VERSION, logo: logoChecksum, doc }))
    .digest("hex");
}

/** "Extras - Invoice INV-2026-00042.pdf", without characters file systems refuse. */
export function documentFileName(companyName: string, label: string, ext = ".pdf"): string {
  const clean = (s: string) =>
    s
      .replace(/[\u0000-\u001f\u007f"<>|*?:\\/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${clean(companyName).slice(0, 60)} - ${clean(label).slice(0, 120)}${ext}`;
}
