import type { PaperBlock, PaperRow } from "./paper";

/*
 * Reading a packing list WITHOUT AI (2026-11-12): the file (Excel, CSV, a PDF's
 * text or a photo read on our own server) becomes a plain table of cells; this
 * module finds where its colours, sizes and pieces are and turns the rows into
 * lines. Two layouts are common:
 *   GRID  one row per colour, the sizes as columns (S | M | L | XL ...)
 *   LIST  one row per colour and size, with a pieces column
 * Nothing here touches the database or the server, so the review screen runs the
 * same code when the person changes which column is which.
 */

/** One cell of the file. `confidence` (0-100) comes only from a photo's reader. */
export type SheetCell = { text: string; confidence?: number };

export type SheetKind = "EXCEL" | "CSV" | "PDF" | "PHOTO";

export type Sheet = {
  kind: SheetKind;
  rows: SheetCell[][];
  /** Things the reader wants the person to know (pages skipped, a hard photo). */
  notes: string[];
};

export type LayoutKind = "GRID" | "LIST";

/** Which column holds what, by column number (0 = the first). */
export type PackingLayout = {
  kind: LayoutKind;
  /** The row with the column names; the lines are the rows below it. */
  headerRow: number;
  style: number | null;
  colour: number | null;
  /** LIST: the size column. */
  size: number | null;
  /** LIST: the pieces column. */
  pieces: number | null;
  /** GRID: the columns that are sizes (their name is in the header row). */
  sizeColumns: number[];
  /** A style code printed above the table ("Style: EX-101"), used for lines without one. */
  defaultStyle: string | null;
};

/**
 * What is remembered for a factory or supplier: the column NAMES, not their
 * numbers, so the next list finds its header row even when it starts lower.
 */
export type SavedLayout = {
  kind: LayoutKind;
  style: string | null;
  colour: string | null;
  size: string | null;
  pieces: string | null;
  sizeHeaders: string[];
};

/** A cell read from a photo below this confidence is shown yellow. */
export const SURE_CONFIDENCE = 80;

const MAX_HEADER_SCAN = 60;

/** "Colour / Shade" -> "COLOUR SHADE": compares names whatever their punctuation. */
export const headerKey = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/** A photo's reader mixes up 0/O, 1/I and 5/S in words; undo that before matching names. */
const wordKey = (text: string) =>
  headerKey(text).replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S");

const COLOUR_WORDS = /\b(COLOU?RS?|COLOU?R ?WAYS?|CLR|SHADES?)\b/;
const STYLE_WORDS = /\b(STYLES?|ARTICLES?|ART|MODEL|ITEM CODE|ITEM NO|STYLE NO|DESIGN)\b/;
const SIZE_WORDS = /\b(SIZES?|SZ)\b/;
const PIECE_WORDS = /\b(QTY|QUANTITY|QNTY|PCS|PIECES?|PC|NOS|UNITS?)\b/;
const PER_CARTON = /\b(CTN|CTNS|CARTONS?|BOX|BOXES|PER|PACKS?)\b/;
const TOTAL_WORDS = /^(TOTAL|TTL|SUB ?TOTAL|GRAND ?TOTAL|G TOTAL)\b/;

/** A word that names the role of a header cell, or null. */
export function headerRole(text: string): "style" | "colour" | "size" | "pieces" | null {
  const key = wordKey(text);
  if (!key) return null;
  if (COLOUR_WORDS.test(key)) return "colour";
  if (SIZE_WORDS.test(key) && !PIECE_WORDS.test(key)) return "size";
  if (PIECE_WORDS.test(key)) return "pieces";
  if (STYLE_WORDS.test(key)) return "style";
  return null;
}

/** How good a pieces column's name is: the total pieces beat pieces per carton. */
function piecesScore(text: string) {
  const key = wordKey(text);
  if (!PIECE_WORDS.test(key)) return 0;
  let score = 2;
  if (/\bTOTAL\b/.test(key)) score += 2;
  if (PER_CARTON.test(key)) score -= 2;
  return score;
}

const SIZE_ALIASES: Record<string, string> = {
  SMALL: "S",
  MEDIUM: "M",
  MED: "M",
  LARGE: "L",
  XLARGE: "XL",
  EXTRALARGE: "XL",
  "2XL": "XXL",
  XXLARGE: "XXL",
  XXXL: "3XL",
  XXXXL: "4XL",
  "2XS": "XXS",
  XXXS: "3XS",
};

/** "Extra Large" -> XL, "2XL" -> XXL, "xxxl" -> 3XL, so printed sizes meet ours. */
export function canonicalSize(size: string): string {
  const n = size.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return SIZE_ALIASES[n] ?? n;
}

const LETTER_SIZE = /^(\d?X{0,4}[SL]|M|XXS|XS|FREE|FS|ONESIZE|OS)$/;
const KIDS_SIZE = /^(\d{1,2}(Y|YR|YRS|M|MTH|MTHS|MONTHS?)|\d{1,2}\d{1,2}(Y|YR|YRS|M|MTH|MTHS))$/;

/**
 * Whether a header cell looks like a size: S, M, XL, 3XL, Free; kids' 2-3Y or
 * 6M; a waist or chest number (1 to 60); or one of the company's own sizes.
 */
export function isSizeName(text: string, known: ReadonlySet<string> = new Set()) {
  const size = canonicalSize(text);
  if (!size || size.length > 8) return false;
  if (known.has(size)) return true;
  if (LETTER_SIZE.test(size) || KIDS_SIZE.test(size)) return true;
  const n = Number(size);
  return /^\d{1,2}$/.test(size) && n >= 1 && n <= 60;
}

const isTotal = (text: string) => TOTAL_WORDS.test(headerKey(text));

/** "Style No: EX-101" (in one cell, or the name and the code side by side). */
function styleAbove(rows: SheetCell[][], before: number): string | null {
  for (let r = Math.min(before, rows.length) - 1; r >= 0; r--) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const text = row[c]?.text.trim() ?? "";
      const inline =
        /^(STYLE|ARTICLE|ART|MODEL)\s*(NO|CODE|#|NUMBER)?\.?\s*[:\-#]\s*(\S.{0,39})$/i.exec(text);
      if (inline?.[3]) return inline[3].trim();
      if (/^(STYLE|ARTICLE|ART|MODEL)\s*(NO|CODE|#|NUMBER)?\.?\s*:?$/i.test(text)) {
        const next = row.slice(c + 1).find((cell) => cell.text.trim());
        if (next) return next.text.trim().slice(0, 40);
      }
    }
  }
  return null;
}

/** A title over the table ("RL Sweater"): the nearest line above it with one name alone. */
function titleAbove(rows: SheetCell[][], before: number): string | null {
  for (let r = Math.min(before, rows.length) - 1; r >= 0 && r >= before - 4; r--) {
    const filled = (rows[r] ?? []).map((c) => c?.text.trim() ?? "").filter(Boolean);
    if (filled.some((t) => headerRole(t) || isTotal(t))) continue;
    if (filled.length === 1 && /[A-Za-z]{2}/.test(filled[0]!)) return filled[0]!.slice(0, 60);
  }
  return null;
}

/**
 * Finds the header row and what each column holds. Tries every row near the
 * top; a row with a colour column and two or more sizes is a GRID, one with
 * colour, size and pieces columns a LIST. Null when nothing fits: the person
 * then picks the columns on the review screen.
 */
export function detectLayout(
  sheet: Sheet,
  knownSizes: readonly string[] = [],
): PackingLayout | null {
  const known = new Set(knownSizes.map(canonicalSize));
  let best: { score: number; layout: PackingLayout } | null = null;
  const rows = sheet.rows.slice(0, MAX_HEADER_SCAN);
  rows.forEach((row, r) => {
    const texts = row.map((c) => c?.text.trim() ?? "");
    let colour: number | null = null;
    let style: number | null = null;
    let size: number | null = null;
    let pieces: number | null = null;
    let piecesBest = 0;
    const sizeColumns: number[] = [];
    texts.forEach((text, c) => {
      if (!text) return;
      const role = headerRole(text);
      if (role === "colour" && colour === null) colour = c;
      else if (role === "style" && style === null) style = c;
      else if (role === "size" && size === null) size = c;
      else if (role === "pieces") {
        const score = piecesScore(text);
        if (score > piecesBest) {
          piecesBest = score;
          pieces = c;
        }
      } else if (role === null && isSizeName(text, known) && !isTotal(text)) sizeColumns.push(c);
    });
    // "Colour" written over two rows (merged above the sizes' row) still names its column.
    const onlySizes = texts.every((t, c) => !t || sizeColumns.includes(c) || isTotal(t));
    if (colour === null && r > 0 && onlySizes) {
      const above = rows[r - 1] ?? [];
      const c = above.findIndex((cell) => headerRole(cell?.text ?? "") === "colour");
      if (c >= 0 && !sizeColumns.includes(c)) colour = c;
    }
    // A grid's sizes are to the right of the colour; a lone number elsewhere is not a size.
    const sizes = sizeColumns.filter((c) => c !== colour && c !== style && (colour ?? -1) < c);
    // Numbers alone (20, 40) are more often pieces than sizes, unless they are the company's.
    const numbersOnly = sizes.every((c) => {
      const name = canonicalSize(texts[c] ?? "");
      return /^\d+$/.test(name) && !known.has(name);
    });
    let candidate: { score: number; layout: PackingLayout } | null = null;
    if (sizes.length >= 2) {
      // No "Colour" heading: the nearest text column to the left of the sizes.
      const colourCol = colour ?? (sizes[0]! > 0 ? sizes[0]! - 1 : null);
      const score = (colour !== null ? 10 : 4) + sizes.length - (numbersOnly ? 4 : 0);
      if (colourCol !== null && score >= 6) {
        candidate = {
          score,
          layout: {
            kind: "GRID",
            headerRow: r,
            style,
            colour: colourCol,
            size: null,
            pieces: null,
            sizeColumns: sizes,
            defaultStyle: null,
          },
        };
      }
    } else if (colour !== null && size !== null && pieces !== null) {
      candidate = {
        score: 12,
        layout: {
          kind: "LIST",
          headerRow: r,
          style,
          colour,
          size,
          pieces,
          sizeColumns: [],
          defaultStyle: null,
        },
      };
    }
    if (candidate && (!best || candidate.score > best.score)) best = candidate;
  });
  if (!best) return null;
  const found = (best as { layout: PackingLayout }).layout;
  return {
    ...found,
    defaultStyle:
      styleAbove(sheet.rows, found.headerRow) ?? titleAbove(sheet.rows, found.headerRow),
  };
}

/** The column names of a layout, to remember for the next list from the same place. */
export function saveLayout(sheet: Sheet, layout: PackingLayout): SavedLayout {
  const header = sheet.rows[layout.headerRow] ?? [];
  const name = (c: number | null) => (c === null ? null : headerKey(header[c]?.text ?? "") || null);
  return {
    kind: layout.kind,
    style: name(layout.style),
    colour: name(layout.colour),
    size: layout.kind === "LIST" ? name(layout.size) : null,
    pieces: layout.kind === "LIST" ? name(layout.pieces) : null,
    sizeHeaders:
      layout.kind === "GRID"
        ? layout.sizeColumns.map((c) => headerKey(header[c]?.text ?? "")).filter(Boolean)
        : [],
  };
}

/**
 * Finds a remembered layout's header row in a new file by its column names.
 * Null when the names are not there (the list changed): the caller then
 * detects the layout afresh.
 */
export function applySavedLayout(sheet: Sheet, saved: SavedLayout): PackingLayout | null {
  const rows = sheet.rows.slice(0, MAX_HEADER_SCAN);
  for (let r = 0; r < rows.length; r++) {
    const keys = (rows[r] ?? []).map((c) => headerKey(c?.text ?? ""));
    const at = (name: string | null) => {
      if (!name) return null;
      const i = keys.indexOf(name);
      return i < 0 ? null : i;
    };
    const colour = at(saved.colour);
    if (saved.colour && colour === null) continue;
    const style = at(saved.style);
    if (saved.kind === "LIST") {
      const size = at(saved.size);
      const pieces = at(saved.pieces);
      if (size === null || pieces === null) continue;
      return {
        kind: "LIST",
        headerRow: r,
        style,
        colour,
        size,
        pieces,
        sizeColumns: [],
        defaultStyle: styleAbove(sheet.rows, r),
      };
    }
    const wanted = new Set(saved.sizeHeaders);
    const sizeColumns = keys.flatMap((k, c) => (wanted.has(k) && c !== colour ? [c] : []));
    if (sizeColumns.length < Math.max(1, Math.ceil(wanted.size / 2))) continue;
    return {
      kind: "GRID",
      headerRow: r,
      style,
      colour,
      size: null,
      pieces: null,
      sizeColumns,
      defaultStyle: styleAbove(sheet.rows, r),
    };
  }
  return null;
}

/** Fixes a photo reader makes in numbers: O for 0, I or l for 1, S for 5, B for 8. */
const DIGIT_FIXES: Record<string, string> = {
  O: "0",
  o: "0",
  D: "0",
  Q: "0",
  I: "1",
  l: "1",
  "|": "1",
  i: "1",
  S: "5",
  s: "5",
  B: "8",
  Z: "2",
  z: "2",
  g: "9",
};

/**
 * Pieces in a cell: "1,200", "1200 pcs", "45.0". Blank, "-" or "nil" is no
 * pieces. A number that needed guessing (a letter read for a digit, a fraction)
 * comes back with why, so the cell shows yellow.
 */
export function readPieces(raw: string): { pieces: number; unsure: string | null } | null {
  let text = raw.trim();
  if (!text || /^[-–—_.xX/]+$/.test(text) || /^(NIL|NONE|N\/?A)$/i.test(text)) return null;
  text = text
    .replace(/\b(PCS?|PIECES?|NOS|UNITS?)\.?$/i, "")
    .replace(/\s/g, "")
    .trim();
  // "1,200" is a thousand separator; "1,2" is a decimal comma (not whole pieces).
  text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(/,/g, ".");
  if (/^\d+$/.test(text)) {
    const pieces = Number(text);
    return pieces > 1_000_000
      ? { pieces: 0, unsure: `“${raw.trim()}” is too many pieces for one cell` }
      : { pieces, unsure: null };
  }
  if (/^\d+\.0+$/.test(text)) return { pieces: Number(text), unsure: null };
  if (/^\d*\.\d+$/.test(text)) {
    return { pieces: Math.round(Number(text)), unsure: `“${raw.trim()}” is not a whole number` };
  }
  const fixed = [...text].map((ch) => DIGIT_FIXES[ch] ?? ch).join("");
  if (/^\d+$/.test(fixed) && /\d/.test(text) && fixed.length <= 7) {
    return { pieces: Number(fixed), unsure: `Read “${raw.trim()}” as ${Number(fixed)}` };
  }
  return { pieces: 0, unsure: `Could not read “${raw.trim()}” as pieces` };
}

const hardToRead = (cell: SheetCell | undefined) =>
  cell?.confidence !== undefined && cell.text.trim() !== "" && cell.confidence < SURE_CONFIDENCE;

/** A "Total" column to the right of a grid's sizes (in the header row or the one above). */
export function totalColumn(sheet: Sheet, layout: PackingLayout): number | null {
  if (layout.kind !== "GRID" || layout.sizeColumns.length === 0) return null;
  const right = Math.max(...layout.sizeColumns);
  for (const r of [layout.headerRow, layout.headerRow - 1]) {
    const row = sheet.rows[r] ?? [];
    for (let c = right + 1; c < row.length; c++) {
      if (isTotal(row[c]?.text ?? "")) return c;
    }
  }
  return null;
}

/**
 * The rows below the header as style blocks (one per style code; one block
 * when there is none), each row a colour with its sizes' pieces. Total rows and
 * empty rows are skipped; a blank colour or style (a merged cell) takes the one
 * above. Cells the reader is not sure of carry why (yellow on the review).
 */
export function readBlocks(sheet: Sheet, layout: PackingLayout): PaperBlock[] {
  const header = sheet.rows[layout.headerRow] ?? [];
  type Building = PaperBlock & { byColour: Map<string, PaperRow> };
  const blocks = new Map<string, Building>();
  const totalCol = totalColumn(sheet, layout);
  let lastColour = "";
  let lastStyle: string | null = layout.defaultStyle;
  const cellText = (row: SheetCell[], c: number | null) =>
    c === null ? "" : (row[c]?.text ?? "").replace(/\s+/g, " ").trim();
  const blockFor = (style: string | null): Building => {
    const key = style ? style.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    let block = blocks.get(key);
    if (!block) {
      block = {
        title: style,
        sizes:
          layout.kind === "GRID"
            ? layout.sizeColumns.map((c) => (header[c]?.text ?? "").trim())
            : [],
        rows: [],
        writtenTotal: null,
        byColour: new Map(),
      };
      blocks.set(key, block);
    }
    return block;
  };
  const sizeIndex = (block: PaperBlock, size: string) => {
    const wanted = canonicalSize(size);
    let i = block.sizes.findIndex((s) => canonicalSize(s) === wanted);
    if (i < 0) {
      block.sizes.push(size);
      i = block.sizes.length - 1;
    }
    return i;
  };

  for (let r = layout.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (row.every((c) => !c?.text.trim())) continue;
    const colourText = cellText(row, layout.colour);
    const firstText = row.find((c) => c?.text.trim())?.text ?? "";
    if (isTotal(colourText) || (!colourText && isTotal(firstText))) {
      // The grid's total row: the paper's grand total, in the total column.
      const total = totalCol === null ? null : readPieces(cellText(row, totalCol));
      if (total && !total.unsure) blockFor(lastStyle).writtenTotal = total.pieces;
      continue;
    }
    // A second header row (a list printed over two pages) is not a line.
    if (headerRole(colourText) === "colour") continue;

    const styleText = cellText(row, layout.style);
    if (styleText && !isTotal(styleText)) lastStyle = styleText;
    let colourUnsure: string | null = null;
    let colour = colourText;
    if (!colour && lastColour) {
      colour = lastColour;
      colourUnsure = "The colour was blank; the one above was used";
    }
    if (colour) lastColour = colour;
    if (hardToRead(layout.colour === null ? undefined : row[layout.colour])) {
      colourUnsure = `The colour “${colour}” was hard to read`;
    }
    const block = blockFor(lastStyle);
    const rowFor = () => {
      const key = colour.toUpperCase();
      let found = block.byColour.get(key);
      if (!found) {
        found = { colour: colour || "?", cells: [], writtenTotal: null, line: r + 1 };
        block.byColour.set(key, found);
        block.rows.push(found);
      }
      return found;
    };
    const put = (index: number, cell: SheetCell | undefined, sizeUnsure: string | null) => {
      const read = readPieces(cell?.text ?? "");
      if (!read) return;
      const reasons = [
        !colour ? "No colour on this row" : null,
        colourUnsure,
        sizeUnsure,
        read.unsure,
        hardToRead(cell) && !read.unsure ? "The number was hard to read" : null,
      ].filter(Boolean);
      const target = rowFor();
      while (target.cells.length <= index) target.cells.push({ pieces: null, unsure: null });
      const was = target.cells[index]!;
      target.cells[index] = {
        pieces: (was.pieces ?? 0) + read.pieces,
        unsure: reasons.length ? reasons.join(". ") : was.unsure,
      };
    };

    if (layout.kind === "GRID") {
      layout.sizeColumns.forEach((c, i) =>
        put(i, row[c], hardToRead(header[c]) ? "The size was hard to read" : null),
      );
      if (totalCol !== null && colour) {
        const total = readPieces(cellText(row, totalCol));
        if (total && !total.unsure) rowFor().writtenTotal = total.pieces;
      }
    } else {
      const size = cellText(row, layout.size);
      const cell = layout.pieces === null ? undefined : row[layout.pieces];
      if (!size && !colourText && !(cell?.text ?? "").trim()) continue;
      put(
        sizeIndex(block, size || "?"),
        cell,
        !size
          ? "No size on this row"
          : hardToRead(layout.size === null ? undefined : row[layout.size])
            ? "The size was hard to read"
            : null,
      );
    }
  }
  return [...blocks.values()]
    .map((b): PaperBlock => ({
      title: b.title,
      sizes: b.sizes,
      rows: b.rows,
      writtenTotal: b.writtenTotal,
    }))
    .filter((b) => b.rows.length > 0);
}

// =============================================================================
// From positioned words (a PDF's text, a photo's words) to rows and columns
// =============================================================================

export type PlacedWord = {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  confidence?: number;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};

/** Words grouped into the lines they sit on (top to bottom, each left to right). */
/** A page or photo is read up to this many words, rows and columns (a bigger one is not a packing list). */
const MAX_WORDS = 20_000;
const MAX_WORD_ROWS = 5000;
const MAX_WORD_COLS = 200;

export function wordLines(words: PlacedWord[]): { lines: PlacedWord[][]; height: number } {
  const placed = words.filter((w) => w.text.trim()).slice(0, MAX_WORDS);
  const height = median(placed.map((w) => Math.max(1, w.y1 - w.y0)));
  const sorted = [...placed].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines: PlacedWord[][] = [];
  let centre = Number.NEGATIVE_INFINITY;
  for (const word of sorted) {
    const mid = (word.y0 + word.y1) / 2;
    const line = lines[lines.length - 1];
    if (line && Math.abs(mid - centre) <= height * 0.6) {
      line.push(word);
      centre = line.reduce((s, w) => s + (w.y0 + w.y1) / 2, 0) / line.length;
    } else {
      lines.push([word]);
      centre = mid;
    }
  }
  return { lines: lines.map((l) => [...l].sort((a, b) => a.x0 - b.x0)), height };
}

/**
 * A photo's words as lines of text for "Type it like the paper": a number the
 * reader was not sure of (or read a letter in, like "2O") gets a "?" after it,
 * so it shows yellow until checked.
 */
export function photoText(words: PlacedWord[]): string {
  return wordLines(words)
    .lines.map((line) =>
      line
        .map((w) => {
          const text = w.text.trim();
          if (!/\d/.test(text) || !/^[=\-–—]?[0-9A-Za-z|,]+[=\-–—]?$/.test(text)) return text;
          const [, lead = "", body = "", tail = ""] =
            /^([=\-–—]?)(.*?)([=\-–—]?)$/.exec(text) ?? [];
          const fixed = [...body]
            .map((ch) => (/\d|,/.test(ch) ? ch : (DIGIT_FIXES[ch] ?? ch)))
            .join("");
          if (!/^[\d,]+$/.test(fixed)) return text;
          const unsure = fixed !== body || (w.confidence ?? 100) < SURE_CONFIDENCE;
          return `${lead}${fixed}${unsure ? "?" : ""}${tail}`;
        })
        .join(" "),
    )
    .join("\n");
}

/**
 * Words with their place on the page (y grows downwards) as rows and columns.
 * Words on the same line join into one cell while the gap between them is
 * small; the line with the most cells sets the columns, and every other line's
 * cells go to the column they overlap most (or the nearest one).
 */
export function wordsToRows(
  words: PlacedWord[],
  /** Words closer than this many line heights join into one cell. */
  joinGap = 1.1,
): SheetCell[][] {
  const { lines: all, height } = wordLines(words);
  const lines = all.slice(0, MAX_WORD_ROWS);
  if (lines.length === 0) return [];

  type Cell = { text: string; x0: number; x1: number; confidence?: number };
  const cellLines: Cell[][] = lines.map((line) => {
    const cells: Cell[] = [];
    for (const word of [...line].sort((a, b) => a.x0 - b.x0)) {
      const last = cells[cells.length - 1];
      if (last && word.x0 - last.x1 < height * joinGap) {
        last.text = `${last.text} ${word.text.trim()}`;
        last.x1 = Math.max(last.x1, word.x1);
        if (word.confidence !== undefined) {
          last.confidence = Math.min(last.confidence ?? 100, word.confidence);
        }
      } else {
        cells.push({
          text: word.text.trim(),
          x0: word.x0,
          x1: word.x1,
          confidence: word.confidence,
        });
      }
    }
    return cells;
  });

  const anchors = cellLines
    .reduce<Cell[]>((a, b) => (b.length > a.length ? b : a), [])
    .slice(0, MAX_WORD_COLS);
  const overlap = (a: Cell, b: Cell) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const centreOf = (c: Cell) => (c.x0 + c.x1) / 2;
  return cellLines.map((cells) => {
    const row: SheetCell[] = anchors.map(() => ({ text: "" }));
    for (const cell of cells) {
      let best = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      anchors.forEach((anchor, i) => {
        const o = overlap(cell, anchor);
        const score = o > 0 ? o : -Math.abs(centreOf(cell) - centreOf(anchor));
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      const target = row[best]!;
      target.text = target.text ? `${target.text} ${cell.text}` : cell.text;
      if (cell.confidence !== undefined) {
        target.confidence = Math.min(target.confidence ?? 100, cell.confidence);
      }
    }
    return row;
  });
}
