/*
 * "Type it like the paper": most factory packing lists are handwritten, one line
 * per colour with the pieces of each size and the row's total:
 *
 *   HOODY-ZIP
 *   S - M - L - XL - XXL
 *   Navy - 3 - 14 - 13 - 6 - 5 = 41
 *   Black 20 58 58 - 20 = 156
 *   Total = 197
 *
 * This text is how every reader's result is shown and corrected: a title line
 * starts a style, a line of sizes sets the columns, a colour line gives the
 * pieces ("-" alone or "- -" is a blank size), "= n" is the total written on the
 * paper, and a "Total" or bare number line is the paper's grand total. A number
 * with "?" after it is one the reader was not sure of (shown yellow). Totals
 * that do not add up are shown red until fixed or confirmed.
 */

import { canonicalSize, headerRole, isSizeName } from "./layout";

export type PaperCell = {
  /** Pieces; null for a blank size. */
  pieces: number | null;
  /** Why this number needs a look (yellow); null when it is clear. */
  unsure: string | null;
};

export type PaperRow = {
  colour: string;
  cells: PaperCell[];
  /** The row's total as written on the paper ("= 41"), to check the numbers against. */
  writtenTotal: number | null;
  /** The text line it came from (1 = the first). */
  line: number;
};

export type PaperBlock = {
  /** The style's name or code as written at the top ("HOODY-ZIP"); null when none. */
  title: string | null;
  sizes: string[];
  rows: PaperRow[];
  /** The total written under the block ("Total = 411", "300 pcs"). */
  writtenTotal: number | null;
};

export type PaperRead = {
  blocks: PaperBlock[];
  /** Lines that are not pieces (an address, a measurement), with why. */
  skipped: Array<{ line: number; text: string; why: string }>;
};

const DASHES = /[–—−_]/g;
const TOTAL_LINE = /^\s*(G(RAND)?\.?\s*)?(TOTAL|TTL|TOTL|TOTOL|SUM)\b/i;
const MEASURE = /\b(CM|INCH|INCHES|MESUR\w*|MEASURE\w*)\b|"|\d+\.\d+/i;
const TITLE_MARK = /^\s*(#|STYLE\s*(NO|CODE|NAME)?\s*[:.\-])\s*/i;

type Token =
  | { kind: "NUM"; value: number; unsure: string | null; raw: string }
  | { kind: "DASH" }
  | { kind: "BAD"; raw: string };

/** "14", "14?", "?" , "1,200": one number token; anything else in the numbers part is unreadable. */
function tokenOf(raw: string): Token {
  if (/^-+$/.test(raw)) return { kind: "DASH" };
  if (raw === "?") return { kind: "NUM", value: 0, unsure: "Could not be read", raw };
  const m = /^(\d{1,3}(?:,\d{3})+|\d{1,7})(\?)?$/.exec(raw);
  if (m) {
    return {
      kind: "NUM",
      value: Number(m[1]!.replace(/,/g, "")),
      unsure: m[2] ? "Check this number against the paper" : null,
      raw,
    };
  }
  return { kind: "BAD", raw };
}

/** "3 - 14 - - 6", "3-14--6", "20 58 - 40": the sizes' cells, blanks included. */
export function readNumbers(
  text: string,
  /** The text starts with a dash written onto the colour ("NAVY- 20 52"): it only separates. */
  attached = false,
): { cells: PaperCell[]; bad: string[] } {
  const spaced = text
    .replace(DASHES, "-")
    .replace(/-/g, " - ")
    .replace(/[;|/\\]/g, " ");
  const tokens = spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => (/^-+$/.test(raw) ? "-" : raw))
    .map(tokenOf);
  const bad = tokens.flatMap((t) => (t.kind === "BAD" ? [t.raw] : []));
  // No two numbers side by side: the dashes separate ("3 - 14 - 13"), and "- -" is a
  // blank between them. Otherwise spaces separate and a dash alone is a blank ("20 - 40").
  let dashed = true;
  for (let i = 0; i < tokens.length - 1 && dashed; i++) {
    if (tokens[i]!.kind !== "DASH" && tokens[i + 1]!.kind !== "DASH") dashed = false;
  }
  // A dash right after the colour ("Navy - 3 - 14", "NAVY- 20 52") only separates.
  if (tokens[0]?.kind === "DASH" && (dashed || attached)) tokens.shift();
  const cells: PaperCell[] = [];
  const cellOf = (t: Token): PaperCell =>
    t.kind === "NUM"
      ? { pieces: t.value, unsure: t.unsure }
      : t.kind === "BAD"
        ? { pieces: 0, unsure: `Could not read “${t.raw}” as pieces` }
        : { pieces: null, unsure: null };
  if (dashed) {
    let current: PaperCell | null = null;
    for (const t of tokens) {
      if (t.kind === "DASH") {
        cells.push(current ?? { pieces: null, unsure: null });
        current = null;
      } else current = cellOf(t);
    }
    if (current) cells.push(current);
  } else {
    for (const t of tokens) cells.push(cellOf(t));
  }
  // Blanks at the end say nothing.
  while (
    cells.length &&
    cells[cells.length - 1]!.pieces === null &&
    !cells[cells.length - 1]!.unsure
  ) {
    cells.pop();
  }
  return { cells, bad };
}

/** The sizes of a line like "S - M - L - XL - 2XL" or "Colour S M L Total"; null if it is not one. */
export function sizeLine(text: string, knownSizes: readonly string[] = []): string[] | null {
  const known = new Set(knownSizes.map(canonicalSize));
  const words = text
    .replace(DASHES, "-")
    .split(/[\s,\-|/]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const sizes: string[] = [];
  for (const word of words) {
    if (/^(TOTAL|TTL|QTY|PCS)$/i.test(word)) continue;
    const role = headerRole(word);
    if (role === "colour" || role === "size") continue;
    if (!isSizeName(word, known)) return null;
    sizes.push(word);
  }
  // Numbers alone ("20 30 40") are pieces, not sizes, unless the company has such sizes.
  const lettered = sizes.some((s) => /[A-Z]/i.test(s) || known.has(canonicalSize(s)));
  return sizes.length >= 2 && lettered ? sizes : null;
}

/** The last number on a total line: "Total = 411", "300 pcs", "639+159=798". */
function lastNumber(text: string): number | null {
  const all = [...text.replace(/,(\d{3})/g, "$1").matchAll(/\d+/g)];
  const last = all[all.length - 1];
  return last ? Number(last[0]) : null;
}

/** Reads the typed (or read) text into style blocks. */
export function parsePaperText(text: string, knownSizes: readonly string[] = []): PaperRead {
  const blocks: PaperBlock[] = [];
  const skipped: PaperRead["skipped"] = [];
  let block: PaperBlock | null = null;
  // Lines before the first sizes: the last one is the title, the others are skipped.
  let pending: Array<{ line: number; text: string }> = [];
  const flush = () => {
    for (const p of pending) skipped.push({ ...p, why: "Not pieces" });
    pending = [];
  };
  const start = (title: string | null, sizes: string[]) => {
    const next: PaperBlock = { title, sizes, rows: [], writtenTotal: null };
    blocks.push(next);
    block = next;
    return next;
  };

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = i + 1;
    const raw = rawLine.trim();
    if (!raw) return;
    const current = block as PaperBlock | null;
    const titled = TITLE_MARK.exec(raw);
    if (titled) {
      flush();
      start(raw.slice(titled[0].length).trim() || null, current?.sizes ?? []);
      return;
    }
    const sizes = sizeLine(raw, knownSizes);
    if (sizes) {
      if (current && current.rows.length === 0) {
        current.sizes = sizes;
        if (!current.title && pending.length) current.title = pending.pop()!.text;
      } else start(pending.pop()?.text ?? null, sizes);
      flush();
      return;
    }
    if (!current || current.sizes.length === 0) {
      pending.push({ line, text: raw });
      return;
    }
    if (TOTAL_LINE.test(raw) || /^[\d\s+=,.]+(PCS?|PIECES)?\.?$/i.test(raw)) {
      current.writtenTotal = lastNumber(raw);
      return;
    }
    if (!/\d|\?/.test(raw)) {
      // A name after the rows starts the next style, with the same sizes until a sizes line.
      if (current.rows.length > 0) start(raw, current.sizes);
      else skipped.push({ line, text: raw, why: "Not pieces" });
      return;
    }
    // The colour is the words before the first number, dash or "?".
    const m = /^(.*?[A-Za-z][^\d?]*?)\s*(?=[-–—\d?]|$)/.exec(raw);
    const colour = (m?.[1] ?? "").replace(/[\s\-:.]+$/, "").trim();
    if (!colour) {
      skipped.push({ line, text: raw, why: "No colour before the numbers" });
      return;
    }
    if (MEASURE.test(raw)) {
      skipped.push({ line, text: raw, why: "A measurement, not pieces" });
      return;
    }
    const rest = raw.slice(m![0].length);
    const [numbersPart, ...totalParts] = rest.split("=");
    const attached = /^[-–—]/.test(rest) && !/\s$/.test(m![0]);
    const read = readNumbers(numbersPart ?? "", attached);
    let writtenTotal = totalParts.length ? lastNumber(totalParts.join("=")) : null;
    const cells = read.cells;
    // One number more than sizes that is the others added up: the row's total
    // written without "=" (a printed table's Total column).
    const last = cells[current.sizes.length];
    if (
      writtenTotal === null &&
      cells.length === current.sizes.length + 1 &&
      last?.pieces !== null &&
      last?.pieces === cells.slice(0, -1).reduce((s, c) => s + (c.pieces ?? 0), 0)
    ) {
      cells.pop();
      writtenTotal = last.pieces;
    }
    current.rows.push({ colour, cells, writtenTotal, line });
  });
  flush();
  return { blocks: blocks.filter((b) => b.sizes.length > 0 || b.rows.length > 0), skipped };
}

const cellText = (cell: PaperCell | undefined) =>
  !cell || cell.pieces === null
    ? cell?.unsure
      ? "?"
      : ""
    : `${cell.pieces}${cell.unsure ? "?" : ""}`;

/**
 * Blocks back to text, the way the factories write it: "Navy - 3 - 14 - - 6 = 23"
 * (dashes between the sizes, nothing between two dashes for a blank).
 */
export function renderPaperText(blocks: readonly PaperBlock[]): string {
  return blocks
    .map((b) =>
      [
        b.title ? (sizeLine(b.title) || /\d/.test(b.title) ? `Style: ${b.title}` : b.title) : null,
        b.sizes.join(" "),
        ...b.rows.map((r) => {
          const cells = b.sizes.map((_, i) => cellText(r.cells[i]));
          const extra = r.cells.slice(b.sizes.length).map(cellText);
          const all = [...cells, ...extra];
          // Blanks at the end say nothing ("Black - 15", not "Black - 15 - - - -").
          while (all.length > 1 && all[all.length - 1] === "") all.pop();
          return `${r.colour} - ${all.join(" - ")}${
            r.writtenTotal !== null ? ` = ${r.writtenTotal}` : ""
          }`
            .replace(/\s+/g, " ")
            .trim();
        }),
        b.writtenTotal !== null ? `Total = ${b.writtenTotal}` : null,
      ]
        .filter((l): l is string => l !== null)
        .join("\n"),
    )
    .join("\n\n");
}

export const rowPieces = (row: PaperRow) => row.cells.reduce((s, c) => s + (c.pieces ?? 0), 0);
export const blockPieces = (block: PaperBlock) => block.rows.reduce((s, r) => s + rowPieces(r), 0);

/**
 * What does not add up in a block (shown red): a row with more numbers than
 * sizes, a row whose numbers differ from its written total, a grand total that
 * differs from the rows. `allPieces` lets a total under the last block count
 * every block ("639+159=798").
 */
export function blockProblems(block: PaperBlock, allPieces?: number): string[] {
  const problems: string[] = [];
  for (const row of block.rows) {
    if (row.cells.length > block.sizes.length) {
      problems.push(
        `${row.colour} has ${row.cells.length} numbers for ${block.sizes.length} sizes (line ${row.line}).`,
      );
    }
    const sum = rowPieces(row);
    if (row.writtenTotal !== null && row.writtenTotal !== sum) {
      problems.push(
        `${row.colour}: the numbers add up to ${sum}, the paper says ${row.writtenTotal} (line ${row.line}).`,
      );
    }
  }
  const total = blockPieces(block);
  if (
    block.writtenTotal !== null &&
    block.writtenTotal !== total &&
    block.writtenTotal !== allPieces
  ) {
    problems.push(
      `The rows add up to ${total} pieces, the paper's total says ${block.writtenTotal}.`,
    );
  }
  return problems;
}

/** Cells that need a look (yellow), as "colour / size: why". */
export function blockDoubts(block: PaperBlock): string[] {
  return block.rows.flatMap((row) =>
    row.cells.flatMap((cell, i) =>
      cell.unsure ? [`${row.colour} / ${block.sizes[i] ?? "?"}: ${cell.unsure}`] : [],
    ),
  );
}

// =============================================================================
// Matching names to the catalog (spelling as written: ANTRA, GREEY, NAWY)
// =============================================================================

/** "navy blue" -> "NAVYBLUE". */
export const nameKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length]!;
}

/** Whether every letter of `short` appears in `long` in order, starting with the same letter. */
function inOrder(short: string, long: string) {
  if (!short || short[0] !== long[0]) return false;
  let at = 0;
  for (const ch of long) if (ch === short[at]) at++;
  return at === short.length;
}

/** 0 to 1: how alike two names are, as written by hand ("ANTRA" is like "ANTHRACITE"). */
export function likeness(a: string, b: string) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  let score = 1 - editDistance(x, y) / long.length;
  if (long.startsWith(short) && short.length >= 3) score = Math.max(score, 0.85);
  // Letters left out or written twice ("ANTRA", "GREEY") keep the rest in order.
  if (short.length >= 4 && inOrder(short, long)) score = Math.max(score + 0.1, 0.75);
  return Math.min(score, 0.99);
}

export type Guess<T> = { item: T; exact: boolean } | null;

/**
 * The catalog name a written name most likely means: the same name, else the
 * clearly closest one that is alike enough. Null when nothing is close or two
 * are equally close (the person picks).
 */
export function closest<T>(
  written: string,
  items: readonly T[],
  nameOf: (item: T) => string,
): Guess<T> {
  const scored = items
    .map((item) => ({ item, score: likeness(written, nameOf(item)) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < 0.5) return null;
  if (best.score === 1) return { item: best.item, exact: true };
  if (second && best.score - second.score < 0.08) return null;
  return { item: best.item, exact: false };
}

/** The style's size a written size means ("2XL" is XXL, "Large" is L). */
export function sizeFor<T extends { name: string }>(
  written: string,
  sizes: readonly T[],
): T | null {
  const wanted = canonicalSize(written);
  return wanted ? (sizes.find((s) => canonicalSize(s.name) === wanted) ?? null) : null;
}

/** Existing styles most like a written title, best first (at most `limit`). */
export function likelyStyles<T extends { code: string; name: string }>(
  title: string,
  styles: readonly T[],
  limit = 5,
): T[] {
  return styles
    .map((s) => ({ s, score: Math.max(likeness(title, s.code), likeness(title, s.name)) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}
