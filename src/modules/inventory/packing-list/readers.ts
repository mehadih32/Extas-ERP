import "server-only";

import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { unzipSync, zlibSync } from "fflate";

import { AppError } from "@/lib/errors";

import {
  handLines,
  handwritingText,
  type HandRead,
  preferHandwriting,
  printedIsWeak,
} from "./handwriting";
import { photoText, type PlacedWord, type Sheet, type SheetCell, wordsToRows } from "./layout";

/*
 * Turns an uploaded packing list into tables of cells, all on our own server
 * with no AI and no outside service:
 *   Excel (.xlsx)       the sheets' cells (merged cells filled in)
 *   CSV / TXT           comma, semicolon or tab separated
 *   PDF with text       the words with their place on the page, into rows and columns
 *   photo or scan       read by the OCR engine bundled with the app (English),
 *                       each cell with how sure the engine is; when it reads
 *                       little (handwriting), the handwriting reader too
 *                       (PaddleOCR's models, also on our own server)
 * An old .xls is refused with what to do instead.
 */

export type PackingFileType = "XLSX" | "CSV" | "PDF" | "IMAGE";

/** At most this many PDF pages or scanned pages are read. */
export const MAX_PAGES = 10;
/** PDF.js decodes no picture bigger than this (a PDF made to fill the memory). */
const MAX_PDF_IMAGE = 25e6;
/** A photo or a scanned page is read up to this many pixels (a phone photo is about 12 Mpx). */
const MAX_PIXELS = 20e6;
/** A PDF's words are read up to this many (a packing list has a few hundred). */
const MAX_PDF_WORDS = 20_000;

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

/** An .xlsx is a zip: at most this many files in it, and this many bytes unpacked. */
const MAX_ZIP_ENTRIES = 2000;
const MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;
const TOO_BIG_XLSX =
  "This Excel file is too large to read. Copy only the packing list into a new file and upload that.";

/** Every visible sheet of an .xlsx workbook, in the workbook's order. */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  let entries = 0;
  let declared = 0;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        // A zip bomb (a tiny file that unpacks to gigabytes) is refused before unpacking.
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) throw new AppError("VALIDATION", TOO_BIG_XLSX);
        const wanted =
          f.name === "xl/workbook.xml" ||
          f.name === "xl/_rels/workbook.xml.rels" ||
          f.name === "xl/sharedStrings.xml" ||
          f.name.startsWith("xl/worksheets/sheet");
        if (wanted) declared += f.originalSize;
        if (declared > MAX_UNZIPPED_BYTES) throw new AppError("VALIDATION", TOO_BIG_XLSX);
        return wanted;
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "VALIDATION",
      "This Excel file could not be opened. Save it again and retry.",
    );
  }
  // The sizes a zip declares can lie: the unpacked bytes are counted too.
  const unpacked = Object.values(files).reduce((n, f) => n + f.length, 0);
  if (unpacked > MAX_UNZIPPED_BYTES) throw new AppError("VALIDATION", TOO_BIG_XLSX);
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
      if (row.length < MAX_COLS) row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (row.length < MAX_COLS) row.push(cell);
      rows.push(row.map((t) => ({ text: t.trim() })));
      row = [];
      cell = "";
      if (rows.length >= MAX_ROWS) break;
    } else cell += ch;
  }
  if (cell || row.length) {
    if (row.length < MAX_COLS) row.push(cell);
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
    // A picture bigger than this is not decoded (a PDF made to fill the memory).
    return await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: MAX_PDF_IMAGE });
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
          if (words.length >= MAX_PDF_WORDS) break;
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

/** The pictures on a scanned PDF's pages, as PNG files for the OCR engine. */
export async function pdfPageImages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const { extractImages } = await import("unpdf");
  const pdf = await openPdf(bytes);
  try {
    const images: Uint8Array[] = [];
    for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
      const found = await extractImages(pdf, p);
      // The biggest picture on the page is the scan; logos and stamps are left out.
      const scan = found.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (
        scan &&
        scan.width >= 200 &&
        scan.height >= 100 &&
        scan.width * scan.height <= MAX_PIXELS
      ) {
        // The pixels come as RGBA (the count says how many values each pixel has).
        const channels = Math.round(scan.data.length / (scan.width * scan.height));
        images.push(encodePng(scan.data, scan.width, scan.height, channels));
      }
    }
    return images;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

// --- A small PNG writer (RGBA, RGB or grey pixels from a PDF) -----------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: Uint8Array[]) {
  let c = 0xffffffff;
  for (const part of parts) for (const b of part) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const name = new TextEncoder().encode(type);
  out.set(name, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([name, data]));
  return out;
}

export function encodePng(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
) {
  const colourType = channels === 4 ? 6 : channels === 3 ? 2 : channels === 2 ? 4 : 0;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, colourType, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// =============================================================================
// Photos and scans: OCR on our own server
// =============================================================================

/**
 * Where the English reading data ships: inside the app's own packages, so the
 * server never fetches it from the internet.
 */
export function ocrLanguagePath() {
  return path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int");
}

/** What the OCR engine read: a table by the words' places, and the lines as text. */
export type PhotoRead = { sheet: Sheet; text: string };

/**
 * Reads photos (JPG, PNG, WEBP) of a printed or handwritten list. Printed
 * tables come out well. Handwriting is read as far as it goes by the
 * handwriting reader, so the text is a start for the person to check against
 * the photo (the review screen shows the totals that do not add up).
 */
export function readImages(images: Uint8Array[]): Promise<PhotoRead> {
  return oneAtATime(() => readImagesNow(images));
}

/** The OCR engine takes a lot of memory: one photo is read at a time on the server. */
let ocrQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const run = ocrQueue.then(job, job);
  ocrQueue = run.catch(() => undefined);
  return run;
}

/** A PNG's, JPEG's or WEBP's width x height from its header, without decoding it. */
export function imagePixels(bytes: Uint8Array): number | null {
  const u16 = (i: number) => (bytes[i]! << 8) | bytes[i + 1]!;
  const u32 = (i: number) => ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | u16(i + 2)) >>> 0;
  const le16 = (i: number) => bytes[i]! | (bytes[i + 1]! << 8);
  const le24 = (i: number) => le16(i) | (bytes[i + 2]! << 16);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return u32(16) * u32(20);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      // A start-of-frame marker holds the size (not DHT c4, JPG c8 or DAC cc).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return u16(i + 5) * u16(i + 7);
      }
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === "VP8X") return (le24(24) + 1) * (le24(27) + 1);
    if (kind === "VP8 ") return (le16(26) & 0x3fff) * (le16(28) & 0x3fff);
    if (kind === "VP8L") {
      const b = bytes.subarray(21, 25);
      const w = 1 + (((b[1]! & 0x3f) << 8) | b[0]!);
      const h = 1 + (((b[3]! & 0x0f) << 10) | (b[2]! << 2) | ((b[1]! & 0xc0) >> 6));
      return w * h;
    }
  }
  return null;
}

async function readImagesNow(images: Uint8Array[]): Promise<PhotoRead> {
  const tooBig = images.some((image) => (imagePixels(image) ?? 0) > MAX_PIXELS);
  if (tooBig) {
    return {
      sheet: {
        kind: "PHOTO",
        rows: [],
        notes: [
          "The photo is too big to read here. Type the lines as written on the paper, beside the photo.",
        ],
      },
      text: "",
    };
  }
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    langPath: ocrLanguagePath(),
    gzip: true,
    cacheMethod: "none",
    // A photo it cannot read rejects that one job; without a handler the worker
    // would also throw where nothing catches it and stop the whole server.
    errorHandler: () => {},
  });
  try {
    // One column of lines of different sizes: reads the factories' tables best.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
    const rows: SheetCell[][] = [];
    const texts: string[] = [];
    let total = 0;
    let sum = 0;
    let handwritten = false;
    for (const image of images) {
      const { data } = await worker.recognize(Buffer.from(image), {}, { blocks: true });
      const words: PlacedWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words) {
              if (!w.text.trim()) continue;
              words.push({ text: w.text, ...w.bbox, confidence: w.confidence });
            }
          }
        }
      }
      // Printed text read well stays as it is; otherwise the handwriting reader
      // tries too, and its lines are used when it found more (and surer) numbers.
      const hand = printedIsWeak(words) ? await readHandwriting(image) : null;
      if (hand && preferHandwriting(words, hand)) {
        handwritten = true;
        texts.push(hand.text);
        total += hand.confidences.length;
        sum += hand.confidences.reduce((s, c) => s + c, 0);
        continue;
      }
      rows.push(...wordsToRows(words, 0.9));
      texts.push(photoText(words));
      total += words.length;
      sum += words.reduce((s, w) => s + (w.confidence ?? 0), 0);
    }
    const notes: string[] = [];
    if (handwritten) {
      notes.push(
        "The handwriting was read as far as it could be. Check every number and every total against the paper.",
      );
    }
    if (total === 0) {
      notes.push(
        "No writing was found in the photo. Take it again in good light, flat and straight.",
      );
    } else if (sum / total < 70) {
      notes.push(
        "The photo was hard to read (handwriting, a fold or a blurred picture). Type the lines as written on the paper, beside the photo.",
      );
    }
    return { sheet: { kind: "PHOTO", rows, notes }, text: texts.join("\n\n") };
  } finally {
    await worker.terminate();
  }
}

// --- Handwriting: PaddleOCR's models, run on our own server -------------------------

/** The handwriting reader's part used here (`@gutenye/ocr-node`). */
type HandReader = { detect(imagePath: string): Promise<unknown> };

/** Loading the reader's models takes seconds: it is made once and kept. */
let handReader: Promise<HandReader> | null = null;

function handwritingReader(): Promise<HandReader> {
  handReader ??= (async () => {
    const { default: Ocr } = await import("@gutenye/ocr-node");
    // No memory pool kept between photos: a photo's working memory goes back at once.
    const reader: HandReader = await Ocr.create({
      onnxOptions: { enableCpuMemArena: false, executionMode: "sequential" },
    });
    return reader;
  })();
  const loading = handReader;
  // A reader that failed to load is tried again with the next photo.
  loading.catch(() => {
    if (handReader === loading) handReader = null;
  });
  return loading;
}

/** Tests only: forgets the loaded handwriting reader. */
export function forgetHandwritingReader() {
  handReader = null;
}

/**
 * Reads one photo with the handwriting reader. Null when it cannot run here
 * (not installed, or it failed on this photo): the printed-text reader's
 * result is used then, and the upload never stops for it.
 */
export async function readHandwriting(image: Uint8Array): Promise<HandRead | null> {
  // The reader opens the photo by its path: a private file that is always removed.
  const file = path.join(os.tmpdir(), `extras-packing-list-${randomUUID()}`);
  try {
    const reader = await handwritingReader();
    await writeFile(file, image, { mode: 0o600 });
    return handwritingText(handLines(await reader.detect(file)));
  } catch (err) {
    console.warn(
      "[packing-list] the handwriting reader could not read the photo; the printed-text reader's result is used:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}

// =============================================================================
// Any file
// =============================================================================

export type FileRead = {
  /** The tables: one per Excel sheet, one for any other file. */
  sheets: Sheet[];
  /** A photo's (or scan's) lines as text, when it was read by OCR. */
  photoText: string | null;
};

/**
 * Reads photos with OCR, but never stops the upload: when the reader fails, the
 * person still gets the photo beside an empty paper box to type into.
 */
async function readImagesSafely(images: Uint8Array[]): Promise<PhotoRead> {
  try {
    return await readImages(images);
  } catch (err) {
    console.error("[packing-list] photo reading failed", err);
    return {
      sheet: {
        kind: "PHOTO",
        rows: [],
        notes: [
          "The photo could not be read here. Type the lines as written on the paper, beside the photo.",
        ],
      },
      text: "",
    };
  }
}

/** Reads an uploaded packing list. A PDF without text (a scan) is read as photos. */
export async function readPackingFile(file: {
  bytes: Uint8Array;
  fileName: string;
}): Promise<FileRead> {
  const type = packingFileType(file.bytes, file.fileName);
  if (type === "XLSX") return { sheets: readXlsx(file.bytes), photoText: null };
  if (type === "CSV") return { sheets: [readCsv(file.bytes)], photoText: null };
  if (type === "IMAGE") {
    const read = await readImagesSafely([file.bytes]);
    return { sheets: [read.sheet], photoText: read.text };
  }
  const text = await readPdfText(file.bytes);
  if (text) return { sheets: [text], photoText: null };
  const images = await pdfPageImages(file.bytes);
  if (images.length === 0) {
    throw new AppError("VALIDATION", "This PDF has no text and no scanned page to read.");
  }
  const read = await readImagesSafely(images);
  return {
    sheets: [
      {
        ...read.sheet,
        notes: ["This PDF is a scan; it was read like a photo.", ...read.sheet.notes],
      },
    ],
    photoText: read.text,
  };
}
