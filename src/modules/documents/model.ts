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
  "PACKING_LIST",
  "DELIVERY_CHALLAN",
  "PAYMENT_RECEIPT",
  "REFUND_VOUCHER",
  "SALES_RETURN",
  "LEDGER_STATEMENT",
  "STOCK_AVAILABILITY",
  "LETTERHEAD",
  "PAYSLIP",
  "BUYER_360",
  "SUPPLIER_360",
  "MATERIAL_CHALLAN",
] as const;

export type PrintType = (typeof PRINT_TYPES)[number];

/**
 * Documents the app prints outside the print archive and the Print buttons: a
 * signed copy of the terms of employment (hr/terms-pdf.ts), the experience and
 * clearance certificate (hr/exit-pdf.ts), the employee 360° report
 * (hr/report.service.ts), a style's tech pack (production/tech-pack.service.ts),
 * a purchase order for the supplier (materials/order-pdf.service.ts), a
 * batch's supplier or factory agreement (production/contract.service.ts), its
 * final CM settlement (production/batch-money.service.ts) and its summary
 * (production/batch-summary.service.ts), and a fabric and trims booking
 * (production/booking-pdf.service.ts), and a Business report (retail/downloads.service.ts),
 * made when asked for and not kept.
 */
export type RecordPrintType =
  | "SIGNED_TERMS"
  | "CLEARANCE_CERTIFICATE"
  | "EMPLOYEE_360"
  | "TECH_PACK"
  | "PURCHASE_ORDER"
  | "PRODUCTION_CONTRACT"
  | "SUPPLIER_REPORT_CARD"
  | "CM_SETTLEMENT"
  | "BATCH_SUMMARY"
  | "BOOKING"
  | "AI_COSTS"
  | "MEASUREMENTS"
  | "DIGITIZING_BRIEF"
  | "RETAIL_REPORT";

/**
 * Bump when the layout changes, so documents printed again get the new look.
 * 2: Bengali text prints in Noto Sans Bengali instead of "?".
 * 3: no figure is cut (smaller text, then the table is split), long names wrap to a
 *    second line instead of ending in "…", and the page number is always whole.
 */
export const LAYOUT_VERSION = 3;

export type Letterhead = {
  name: string;
  legalName: string | null;
  /** Address and contact lines shown at the top right. */
  contacts: string[];
  /** Registration numbers under the contacts ("BIN: 000123456-0101"); left out when none are on file. */
  registrations?: string[];
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
  /**
   * A column of tick boxes: on plain rows each cell is a box, ticked when it holds
   * TICK and empty (to tick by hand) otherwise. Subtotal and total rows print text.
   */
  check?: boolean;
};

/** A ticked box in a `check` column. */
export const TICK = "✓";

/** normal rows alternate shading; subtotal and total rows are bold with a rule above. */
export type RowStyle = "normal" | "subtotal" | "total";

export type Row = {
  cells: string[];
  style?: RowStyle;
  /** Smaller lines under the first wide text cell (fabric, sizes, SKU...). */
  details?: string[];
  /** A colour swatch before the first cell ("#1F2A44"). */
  swatch?: string;
  /**
   * A reference picture (its file id) printed as a small thumbnail at the start of
   * the cell that holds the details. The writer is handed the pictures' bytes.
   */
  image?: string;
  /**
   * The row's least height in points, for a row left blank to be filled by hand (a
   * fabric swatch is pasted into a row about 15 mm tall).
   */
  height?: number;
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
  | {
      kind: "list";
      title: string;
      items: Array<{ label?: string; text: string }>;
      /** 1. 2. 3. instead of bullets (terms and conditions). */
      numbered?: boolean;
    }
  | { kind: "note"; text: string }
  /** A heading opening a part of the document on its own page (an invoice's packing list). */
  | { kind: "heading"; title: string; subtitle?: string }
  /** Signature lines at the foot of this page, for a part that is signed on its own. */
  | { kind: "signatures"; labels: string[] }
  | { kind: "pageBreak" }
  /**
   * A part of a book (a booking book's fabric booking for one mill) starting on a
   * page of its own: `title` is printed as the page title, and `label` ("FABRIC ·
   * FS-1") shows in the header of each of its pages. On letterhead it prints as a
   * heading on a new page.
   */
  | {
      kind: "section";
      title: string;
      label?: string;
      subtitle?: string;
      /** Names the part, so the pages it runs over can be listed (a booking book's cover). */
      key?: string;
    }
  /** Address boxes inside the document ("Supplier", "Deliver to"), as at the top. */
  | { kind: "parties"; parties: Array<{ heading: string; lines: string[] }> }
  /**
   * A bar chart of one or two series (a business report's profit by month): a
   * pair of bars per row, losses below the line, the figures in the table that
   * goes with it.
   */
  | {
      kind: "bars";
      title: string;
      series: [string] | [string, string];
      rows: Array<{ label: string; values: number[] }>;
    };

/** Which way round an A4 page prints. */
export type Orientation = "portrait" | "landscape";

/**
 * The book frame (a booking book, a booking for the supplier) instead of the
 * letterhead: A4 either way round, a blank strip 15 mm tall at the top of every
 * page for binding, then on every page the header in three columns (the company
 * and its tagline; the document's title and the part it is in; DOC NO, BUYER,
 * DATE, PREPARED BY), navy tables, and the footer with the company's contacts
 * and "PAGE 2 OF 9".
 */
export type BookFrame = {
  orientation: Orientation;
  /** Under the company's name ("Manufacturing | Sourcing | Export"). */
  tagline: string;
  /**
   * The header's right column in small capitals; an empty value prints a line to
   * write on. `sign`: a signature line beside the value (PREPARED BY and its name).
   */
  fields: Array<{ label: string; value: string; sign?: boolean }>;
  /** The footer: "EXTAS | +8801764751616 | info@extas.com.bd | House-17, Road-08, Dhaka". */
  contact: string;
};

export type Stamp = {
  text: string;
  /** danger: a faint diagonal watermark on every page (VOID); success: a badge (PAID). */
  tone: "danger" | "success";
};

export type PrintDocument = {
  type: PrintType | RecordPrintType;
  /** "Commercial Invoice"; empty for the blank letterhead. */
  title: string;
  /** A line under the title ("Rahim Traders", "Brand: Extas Men"). */
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
  /** Printed to be bound: a wider left margin on every page for the spiral's holes. */
  binding?: boolean;
  /** A QR code beside the title (a link to the record), with a caption under it. */
  qr?: { data: string; caption?: string };
  /** A line for initials at the foot of every page ("Supplier's initials"). */
  initials?: string;
  /** Printed in the book frame instead of on letterhead (see BookFrame). */
  frame?: BookFrame;
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

/**
 * SHA-256 of everything that ends up on the page: the model, the logo and the layout version,
 * and for a document only some people may open (a buyer's 360° profile), who those are, so
 * the same pages printed for another set of readers are kept apart. Without readers the
 * hash is what it always was (stableJson leaves out undefined).
 */
export function contentHash(
  doc: PrintDocument,
  logoChecksum: string | null,
  readers?: unknown,
): string {
  return createHash("sha256")
    .update(stableJson({ layout: LAYOUT_VERSION, logo: logoChecksum, doc, readers }))
    .digest("hex");
}

/** "Extas - Invoice INV-2026-00042.pdf", without characters file systems refuse. */
export function documentFileName(companyName: string, label: string, ext = ".pdf"): string {
  const clean = (s: string) =>
    s
      .replace(/[\u0000-\u001f\u007f"<>|*?:\\/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${clean(companyName).slice(0, 60)} - ${clean(label).slice(0, 120)}${ext}`;
}
