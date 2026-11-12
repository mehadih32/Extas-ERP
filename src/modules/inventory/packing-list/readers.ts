import "server-only";

import { unzipSync } from "fflate";

import { AppError } from "@/lib/errors";

import { type PlacedWord, type Sheet, type SheetCell, wordsToRows } from "./layout";

/*
 * Turns an uploaded packing list into tables of cells, all on our own server
 * with no AI and no outside service:
 *   Excel (.xlsx)       the sheets' cells (merged cells filled in)
 *   CSV / TXT           comma, semicolon or tab separated
 *   PDF with text       the words with their place on the page, into rows and columns
 *   photo or scan       shown beside the grid; the person types the lines
 * An old .xls is refused with what to do instead.
 */

export type PackingFileType = "XLSX" | "CSV" | "PDF" | "IMAGE";

/** At most this many PDF pages or scanned pages are read. */
export const MAX_PAGES = 10;

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/** What the file is, by its first bytes (and its name for CSV). */
export function packingFileType(bytes: Uint8Array, fileName: string): PackingFileType {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "PDF";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "IMAGE";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "IMAGE";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return "IMAGE";
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "XLSX";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new AppError(
      "VALIDATION",
      "This is an old Excel file (.xls). Open it in Excel and save it as .xlsx or CSV, then upload that.",
    );
  }
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) return "CSV";
  if (looksLikeText(bytes)) return "CSV";
  throw new AppError(
    "VALIDATION",
    "Upload the packing list as Excel (.xlsx), CSV, PDF or a photo (JPG or PNG).",
  );
}

function looksLikeText(bytes: Uint8Array) {
  const sample = bytes.subarray(0, 2048);
  if (sample.length === 0) return false;
  let odd = 0;
  for (const b of sample) if (b === 0 || (b < 9 && b !== 0)) odd++;
  return odd === 0;
}

// =============================================================================
// Excel
// =============================================================================

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** All the text runs of a shared or inline string (phonetic guides left out). */
const runsOf = (xml: string) =>
  decodeXml(
    [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((m) => m[1])
      .join(""),
  );

const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** "BC12" -> column 54, row 11 (both from 0). */
function cellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

const MAX_ROWS = 5000;
const MAX_COLS = 200;

/** Numbers as Excel shows them, without float noise (12.000000001 is 12). */
function numberText(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return String(Math.round(n * 1e6) / 1e6);
}

function readWorksheet(xml: string, shared: string[]): SheetCell[][] {
  const grid: string[][] = [];
  const put = (row: number, col: number, text: string) => {
    if (row >= MAX_ROWS || col >= MAX_COLS) return;
    (grid[row] ??= [])[col] = text;
  };
  let nextRow = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = attr(rowMatch[1] ?? "", "r");
    const row = rowNumber ? Number(rowNumber) - 1 : nextRow;
    nextRow = row + 1;
    let nextCol = 0;
    for (const c of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = c[1] ?? "";
      const body = c[2] ?? "";
      const ref = attr(tag, "r");
      const at = ref ? cellRef(ref) : null;
      const col = at?.col ?? nextCol;
      nextCol = col + 1;
      const type = attr(tag, "t");
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "s") text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = runsOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str" || type === "e") text = decodeXml(value ?? "");
      else if (type === "b") text = value === "1" ? "TRUE" : "FALSE";
      else if (value !== undefined) text = numberText(value);
      if (text.trim()) put(row, col, text.trim());
    }
  }
  // A merged cell (a colour over several size rows, "SIZE" over the size columns)
  // gives its text to every cell it covers.
  for (const m of xml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const from = cellRef(m[1]!);
    const to = cellRef(m[2]!);
    if (!from || !to) continue;
    const text = grid[from.row]?.[from.col];
    if (!text) continue;
    for (let r = from.row; r <= Math.min(to.row, MAX_ROWS - 1); r++) {
      for (let c = from.col; c <= Math.min(to.col, MAX_COLS - 1); c++) {
        if (!grid[r]?.[c]) put(r, c, text);
      }
    }
  }
  const width = grid.reduce((w, row) => Math.max(w, row?.length ?? 0), 0);
  return Array.from({ length: grid.length }, (_, r) =>
    Array.from({ length: width }, (_, c) => ({ text: grid[r]?.[c] ?? "" })),
  );
}

/** Every visible sheet of an .xlsx workbook, in the workbook's order. */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        f.name === "xl/workbook.xml" ||
        f.name === "xl/_rels/workbook.xml.rels" ||
        f.name === "xl/sharedStrings.xml" ||
        f.name.startsWith("xl/worksheets/sheet"),
    });
  } catch {
    throw new AppError(
      "VALIDATION",
      "This Excel file could not be opened. Save it again and retry.",
    );
  }
  const text = (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : "");
  const workbook = text("xl/workbook.xml");
  if (!workbook) {
    throw new AppError(
      "VALIDATION",
      "This is not an Excel workbook. Upload an .xlsx, CSV, PDF or photo.",
    );
  }
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(
    (m) => runsOf(m[1] ?? ""),
  );
  const targets = new Map(
    [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      attr(m[0], "Id") ?? "",
      (attr(m[0], "Target") ?? "").replace(/^\/?(xl\/)?/, "xl/"),
    ]),
  );
  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    if (attr(m[0], "state") === "hidden" || attr(m[0], "state") === "veryHidden") continue;
    const target = targets.get(attr(m[0], "r:id") ?? "");
    const xml = target ? text(target) : "";
    if (!xml) continue;
    const rows = readWorksheet(xml, shared);
    if (rows.some((r) => r.some((c) => c.text))) {
      sheets.push({ kind: "EXCEL", rows, notes: [] });
    }
  }
  if (sheets.length === 0) throw new AppError("VALIDATION", "This Excel file has no filled sheet.");
  return sheets;
}

// =============================================================================
// CSV
// =============================================================================

/** A CSV (or semicolon / tab separated) file as rows of cells; quotes are understood. */
export function readCsv(bytes: Uint8Array): Sheet {
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, "");
  const firstLines = text.split(/\r?\n/).slice(0, 10).join("\n");
  const delimiter = [",", ";", "\t"]
    .map((d) => ({ d, n: firstLines.split(d).length }))
    .sort((a, b) => b.n - a.n)[0]!.d;
  const rows: SheetCell[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row.map((t) => ({ text: t.trim() })));
      row = [];
      cell = "";
      if (rows.length >= MAX_ROWS) break;
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row.map((t) => ({ text: t.trim() })));
  }
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return {
    kind: "CSV",
    rows: rows.map((r) => [
      ...r,
      ...Array.from({ length: width - r.length }, () => ({ text: "" })),
    ]),
    notes: [],
  };
}

// =============================================================================
// PDF
// =============================================================================

type PdfDocument = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;

async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  const { getDocumentProxy } = await import("unpdf");
  try {
    return await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new AppError("VALIDATION", "This PDF could not be opened. Save it again and retry.");
  }
}

/**
 * A PDF's printed words as rows and columns. Null when it has (almost) no text:
 * a scan, read as photos instead.
 */
export async function readPdfText(bytes: Uint8Array): Promise<Sheet | null> {
  const pdf = await openPdf(bytes);
  try {
    const words: PlacedWord[] = [];
    const notes: string[] = [];
    let offset = 0;
    const pages = Math.min(pdf.numPages, MAX_PAGES);
    if (pdf.numPages > MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} pages were read.`);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [, , , d, x, y] = item.transform as number[];
        const h = Math.abs(item.height || d || 10);
        const top = offset + (height - (y ?? 0)) - h;
        // One text run can hold several columns ("Navy   10   20"): split at wide gaps.
        const perChar = item.str.length ? item.width / item.str.length : 0;
        for (const part of item.str.matchAll(/\S+(?: \S+)*/g)) {
          const start = (x ?? 0) + perChar * (part.index ?? 0);
          words.push({
            text: part[0],
            x0: start,
            x1: start + perChar * part[0].length,
            y0: top,
            y1: top + h,
          });
        }
      }
      offset += height + 50;
    }
    if (words.map((w) => w.text).join("").length < 8) return null;
    return { kind: "PDF", rows: wordsToRows(words, 0.35), notes };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

// =============================================================================
// Any file
// =============================================================================

export type FileRead = {
  /** The tables: one per Excel sheet, one for any other file. */
  sheets: Sheet[];
  /** A photo's (or scan's) lines as text, to correct beside the picture. */
  photoText: string | null;
};

/** A photo (or a scanned PDF) is typed by the person beside the picture. */
const photoToType = (): Sheet => ({
  kind: "PHOTO",
  rows: [],
  notes: ["Type the lines as written on the paper, beside the photo."],
});

/** Reads an uploaded packing list. A photo or a scan is typed beside the picture. */
export async function readPackingFile(file: {
  bytes: Uint8Array;
  fileName: string;
}): Promise<FileRead> {
  const type = packingFileType(file.bytes, file.fileName);
  if (type === "XLSX") return { sheets: readXlsx(file.bytes), photoText: null };
  if (type === "CSV") return { sheets: [readCsv(file.bytes)], photoText: null };
  if (type === "IMAGE") return { sheets: [photoToType()], photoText: "" };
  const text = await readPdfText(file.bytes);
  if (text) return { sheets: [text], photoText: null };
  return {
    sheets: [
      {
        ...photoToType(),
        notes: ["This PDF is a scan. Type the lines as written on the paper, beside it."],
      },
    ],
    photoText: "",
  };
}
