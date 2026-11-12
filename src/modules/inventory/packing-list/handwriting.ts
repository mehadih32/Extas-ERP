import { DIGIT_FIXES, type PlacedWord, SURE_CONFIDENCE } from "./layout";
import { sizeLine } from "./paper";

/*
 * Handwritten packing lists (the owner's decision, 2026-11-12): a second photo
 * reader that runs on our own server with no AI service (PaddleOCR's models).
 * It reads a handwritten row as ONE line, often with the separators lost and
 * a letter or two of the colour garbled:
 *
 *   "B2ACK1441333412=134"    the paper: BLACK 14 41 33 34 12 = 134
 *   "6-39-95-19-17-16=142"
 *   "BLACK2058S8 40 196"
 *
 * This module turns those lines into the "Type it like the paper" text: the
 * letters in front are the row's colour (kept as read, the person fixes it),
 * the number after "=" is the total written on the paper, and a run of digits
 * that ran together is split into the sizes so that it adds up to that total.
 * Nothing here is sure: the review screen shows the totals that do not add up.
 */

/** One line the handwriting reader found: its text, how sure it is (0-1) and its corners. */
export type HandLine = {
  text: string;
  /** 0 to 1. */
  mean: number;
  /** The four corners (x, y), or null when the reader gave none. */
  box: Array<[number, number]> | null;
};

const asNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The reader's answer ({ texts } in 1.4, a plain list before it) as lines; anything else is none. */
export function handLines(result: unknown): HandLine[] {
  const list = Array.isArray(result)
    ? result
    : result && typeof result === "object" && Array.isArray((result as { texts?: unknown }).texts)
      ? (result as { texts: unknown[] }).texts
      : [];
  const lines: HandLine[] = [];
  for (const item of list.slice(0, 2000)) {
    if (!item || typeof item !== "object") continue;
    const { text, mean, box } = item as { text?: unknown; mean?: unknown; box?: unknown };
    if (typeof text !== "string") continue;
    const corners = Array.isArray(box)
      ? box.flatMap((p): Array<[number, number]> => {
          const x = Array.isArray(p) ? asNumber(p[0]) : null;
          const y = Array.isArray(p) ? asNumber(p[1]) : null;
          return x !== null && y !== null ? [[x, y]] : [];
        })
      : [];
    lines.push({
      text: text.slice(0, 500),
      mean: Math.min(1, Math.max(0, asNumber(mean) ?? 0)),
      box: corners.length >= 2 ? corners : null,
    });
  }
  return lines;
}

/**
 * The reader's models also know Chinese: full-width signs ("＝", "１") become
 * plain ones and anything that is not Latin text is dropped.
 */
export function cleanHandText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[–—−_]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================================================
// One handwritten row
// =============================================================================

/**
 * Splits digit runs into at most `maxParts` numbers of 1 to 3 digits that add
 * up to `total` (a run of 1 or 2 digits is never split). The best split has
 * the fewest 3-digit numbers, then the fewest 1-digit ones (handwritten pieces
 * are mostly 2 digits). `ambiguous` when another split is as good. Null when
 * no split adds up.
 */
export function splitDigits(
  runs: readonly string[],
  total: number,
  maxParts: number,
): { cells: number[]; ambiguous: boolean } | null {
  if (runs.length === 0 || runs.length > maxParts) return null;
  if (runs.some((r) => !/^\d+$/.test(r))) return null;
  if (runs.join("").length > 3 * maxParts) return null;
  let best: number[] | null = null;
  let bestCost: [number, number] = [Infinity, Infinity];
  let ties = 0;
  // A long line could have very many splits: past this many steps, no answer.
  let budget = 200_000;
  const parts: number[] = [];
  const walk = (run: number, at: number, sum: number, threes: number, ones: number) => {
    if (--budget < 0 || sum > total || parts.length > maxParts) return;
    const digits = runs[run];
    if (digits === undefined) {
      if (sum !== total) return;
      if (threes < bestCost[0] || (threes === bestCost[0] && ones < bestCost[1])) {
        best = [...parts];
        bestCost = [threes, ones];
        ties = 0;
      } else if (threes === bestCost[0] && ones === bestCost[1]) {
        ties++;
      }
      return;
    }
    if (at === digits.length) {
      walk(run + 1, 0, sum, threes, ones);
      return;
    }
    const lengths = digits.length <= 2 ? [digits.length] : [1, 2, 3];
    for (const length of lengths) {
      if (at + length > digits.length) break;
      const piece = digits.slice(at, at + length);
      if (piece.length > 1 && piece.startsWith("0")) continue;
      parts.push(Number(piece));
      walk(
        run,
        at + length,
        sum + Number(piece),
        threes + (length === 3 ? 1 : 0),
        ones + (length === 1 ? 1 : 0),
      );
      parts.pop();
    }
  };
  walk(0, 0, 0, 0, 0);
  if (budget < 0 || !best) return null;
  return { cells: best, ambiguous: ties > 0 };
}

export type HandCell = { pieces: number; unsure: boolean };

export type HandRow = {
  /** The letters in front (the colour) as read; "" when the line starts with a number. */
  label: string;
  cells: HandCell[];
  /** The total written on the paper ("= 134"), or null. */
  total: number | null;
  /** True when the numbers add up to the written total. */
  checked: boolean;
};

/** Letters with a digit inside ("B2ACK"), a dash between words ("OFF-WHITE"), until the numbers start. */
const LABEL =
  /^\s*([A-Za-z](?:[A-Za-z .'&/()]|(?<=[A-Za-z])-(?=[A-Za-z])|(?<=[A-Za-z])\d(?=[A-Za-z]))*)/;
/** A many-digit run written without spaces: more than any one size would hold. */
const isMerged = (run: string) => run.length > 3;
/** Most rows have at most this many sizes when the paper's size line was not read. */
const MAX_SIZES = 12;

/**
 * Reads one handwritten row. `sizeCount` is the number of sizes on the paper's
 * size line (null when it was not read). Null for a line without digits.
 */
/**
 * When no split adds up to the written total (one digit was misread), the split
 * into exactly `parts` sizes whose sum comes closest to it: a start the person
 * corrects, every cell marked unsure. Null when the digits cannot make that many sizes.
 */
export function nearestSplit(
  runs: readonly string[],
  total: number,
  parts: number,
): number[] | null {
  if (runs.length === 0 || runs.length > parts || parts > MAX_SIZES) return null;
  if (runs.some((r) => !/^\d+$/.test(r))) return null;
  const length = runs.join("").length;
  if (length < parts || length > 3 * parts) return null;
  let best: number[] | null = null;
  let bestCost: [number, number, number] = [Infinity, Infinity, Infinity];
  let budget = 200_000;
  const cells: number[] = [];
  const walk = (run: number, at: number, sum: number, threes: number, ones: number) => {
    if (--budget < 0 || cells.length > parts) return;
    const digits = runs[run];
    if (digits === undefined) {
      if (cells.length !== parts) return;
      const cost: [number, number, number] = [Math.abs(sum - total), threes, ones];
      const better =
        cost[0] < bestCost[0] ||
        (cost[0] === bestCost[0] &&
          (cost[1] < bestCost[1] || (cost[1] === bestCost[1] && cost[2] < bestCost[2])));
      if (better) {
        best = [...cells];
        bestCost = cost;
      }
      return;
    }
    if (at === digits.length) {
      walk(run + 1, 0, sum, threes, ones);
      return;
    }
    const lengths = digits.length <= 2 ? [digits.length] : [1, 2, 3];
    for (const size of lengths) {
      if (at + size > digits.length) break;
      const piece = digits.slice(at, at + size);
      if (piece.length > 1 && piece.startsWith("0")) continue;
      cells.push(Number(piece));
      walk(
        run,
        at + size,
        sum + Number(piece),
        threes + (size === 3 ? 1 : 0),
        ones + (size === 1 ? 1 : 0),
      );
      cells.pop();
    }
  };
  walk(0, 0, 0, 0, 0);
  return budget < 0 ? null : best;
}

export function handwrittenRow(text: string, sizeCount: number | null): HandRow | null {
  const line = cleanHandText(text);
  if (!/\d/.test(line)) return null;
  const labelMatch = LABEL.exec(line);
  const label = (labelMatch?.[1] ?? "").replace(/[\s\-:.]+$/, "").trim();
  const rest = line
    .slice(labelMatch ? labelMatch[0].length : 0)
    .replace(/[A-Za-z|]/g, (ch) => DIGIT_FIXES[ch] ?? ch);
  const equals = rest.lastIndexOf("=");
  const numbersPart = equals >= 0 ? rest.slice(0, equals) : rest;
  let total: number | null = null;
  if (equals >= 0) {
    const after = rest.slice(equals + 1).match(/\d+/g);
    total = after ? Number(after[after.length - 1]) : null;
  }
  // The runs of digits, with the letters the fixes could not turn into digits dropped.
  const pieces = numbersPart.split(/[^0-9A-Za-z]+/).filter(Boolean);
  const runs = pieces.map((p) => p.replace(/\D/g, "")).filter(Boolean);
  const lost = pieces.some((p) => /\D/.test(p));
  if (runs.length === 0) return null;
  const maxParts = sizeCount ?? MAX_SIZES;

  let cells: HandCell[] | null = null;
  let checked = false;
  const plain = () => runs.map((r) => ({ pieces: Number(r), unsure: lost || isMerged(r) }));
  const fits = (list: readonly string[], sum: number) =>
    !list.some(isMerged) && list.reduce((s, r) => s + Number(r), 0) === sum;

  if (total === null && runs.length >= 2) {
    // No "=": the last number is the row's total when there are more numbers than
    // sizes, or when the numbers before it can only be split to add up to it.
    const last = Number(runs[runs.length - 1]);
    const before = runs.slice(0, -1);
    if (sizeCount !== null && runs.length > sizeCount && !isMerged(runs[runs.length - 1]!)) {
      total = last;
      runs.pop();
    } else if (before.some(isMerged) && splitDigits(before, last, maxParts)) {
      total = last;
      runs.pop();
    }
  }
  if (total !== null) {
    if (fits(runs, total)) {
      cells = runs.map((r) => ({ pieces: Number(r), unsure: lost }));
      checked = !lost;
    } else {
      const split = splitDigits(runs, total, maxParts);
      if (split) {
        cells = split.cells.map((pieces) => ({ pieces, unsure: lost || split.ambiguous }));
        checked = !lost && !split.ambiguous;
      } else if (sizeCount !== null && runs.some(isMerged)) {
        const near = nearestSplit(runs, total, sizeCount);
        if (near) cells = near.map((pieces) => ({ pieces, unsure: true }));
      }
    }
  }
  return { label, cells: cells ?? plain(), total, checked };
}

/** A digit in a colour's name back to the letter it most likely was ("B2ACK" -> "BZACK"). */
const LETTER_FOR_DIGIT: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "3": "E",
  "4": "A",
  "5": "S",
  "6": "G",
  "7": "T",
  "8": "B",
  "9": "G",
};

/** A row as a "Type it like the paper" line: "BZACK - 14 - 41 - 33 - 34 - 12 = 134". */
export function renderHandRow(row: HandRow, sure: boolean) {
  const colour = row.label.replace(/\d/g, (d) => LETTER_FOR_DIGIT[d] ?? d);
  const cells = row.cells.map(
    (c) => `${c.pieces}${c.unsure || (!sure && !row.checked) ? "?" : ""}`,
  );
  return (
    [colour, cells.join(" - ")].filter(Boolean).join(" - ") +
    (row.total !== null ? ` = ${row.total}` : "")
  );
}

const SIZE_TOKENS = [
  "XXXXL",
  "XXXL",
  "XXXS",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "XXL",
  "XXS",
  "XL",
  "XS",
  "S",
  "M",
  "L",
];

/** A size line read without spaces ("SMLXLXXL"): its sizes when the whole line is sizes, else null. */
export function mergedSizes(text: string): string[] | null {
  const squeezed = cleanHandText(text)
    .toUpperCase()
    .replace(/\b(SIZES?|SZ|COLOU?RS?|TOTAL|TTL|QTY|PCS)\b/g, " ")
    .replace(/[\s\-|,/]+/g, "");
  if (!squeezed || squeezed.length > 30) return null;
  const sizes: string[] = [];
  let at = 0;
  while (at < squeezed.length) {
    const token = SIZE_TOKENS.find((t) => squeezed.startsWith(t, at));
    if (!token) return null;
    sizes.push(token);
    at += token.length;
  }
  return sizes.length >= 3 ? sizes : null;
}

// =============================================================================
// A whole photo
// =============================================================================

type Placed = { text: string; mean: number; x0: number; x1: number; y0: number; y1: number };

function placed(line: HandLine): Placed | null {
  if (!line.box) return null;
  const xs = line.box.map((p) => p[0]);
  const ys = line.box.map((p) => p[1]);
  return {
    text: line.text,
    mean: line.mean,
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
}

const LONE_TOTAL = /^=?\s*(\d{1,5})$/;

/**
 * A row's total written to its right can come back as a line of its own
 * ("=149"): it is put back on the row beside it (the one whose height it
 * shares most), when that row has no total yet.
 */
function joinLoneTotals(lines: HandLine[]): HandLine[] {
  const out = lines.map((l) => ({ ...l, text: cleanHandText(l.text) })).filter((l) => l.text);
  const used = new Set<number>();
  out.forEach((line, i) => {
    const lone = LONE_TOTAL.exec(line.text);
    const here = placed(line);
    if (!lone || !here) return;
    let best = -1;
    let bestOverlap = 0;
    out.forEach((other, j) => {
      const there = placed(other);
      if (j === i || used.has(j) || !there || LONE_TOTAL.test(other.text)) return;
      if (other.text.includes("=") || !/\d/.test(other.text)) return;
      if (there.x1 > here.x0 + (here.x1 - here.x0)) return;
      const overlap = Math.min(here.y1, there.y1) - Math.max(here.y0, there.y0);
      const height = Math.min(here.y1 - here.y0, there.y1 - there.y0);
      if (overlap > height * 0.5 && overlap > bestOverlap) {
        best = j;
        bestOverlap = overlap;
      }
    });
    if (best >= 0) {
      out[best] = {
        ...out[best]!,
        text: `${out[best]!.text} = ${lone[1]}`,
        mean: Math.min(out[best]!.mean, line.mean),
      };
      used.add(i);
    }
  });
  return out.filter((_, i) => !used.has(i));
}

export type HandRead = {
  /** The "Type it like the paper" text. */
  text: string;
  /** How sure the reader was (0-100) of each number it put in a size. */
  numbers: number[];
  /** How sure the reader was (0-100) of each line. */
  confidences: number[];
};

/** The handwriting reader's lines as the "Type it like the paper" text. */
export function handwritingText(lines: HandLine[]): HandRead {
  const sorted = [...lines].sort((a, b) => {
    const pa = placed(a);
    const pb = placed(b);
    return pa && pb ? (pa.y0 + pa.y1) / 2 - (pb.y0 + pb.y1) / 2 : 0;
  });
  const out: string[] = [];
  const numbers: number[] = [];
  const confidences: number[] = [];
  let sizeCount: number | null = null;
  for (const line of joinLoneTotals(sorted)) {
    const sure = line.mean * 100 >= SURE_CONFIDENCE;
    confidences.push(Math.round(line.mean * 100));
    // A measurement ("12.5") or an unread line stays as read.
    if (/\d\.\d/.test(line.text) || LONE_TOTAL.test(line.text)) {
      out.push(line.text);
      continue;
    }
    const sizes = sizeLine(line.text) ?? mergedSizes(line.text);
    if (sizes) {
      sizeCount = sizes.length;
      out.push(sizes.join(" "));
      continue;
    }
    const row = handwrittenRow(line.text, sizeCount);
    if (!row) {
      out.push(line.text);
      continue;
    }
    numbers.push(...row.cells.map(() => Math.round(line.mean * 100)));
    out.push(renderHandRow(row, sure));
  }
  return { text: out.join("\n"), numbers, confidences };
}

// =============================================================================
// Which reader's result to use
// =============================================================================

const isNumberWord = (w: PlacedWord) => /\d/.test(w.text) && /^[^A-Za-z]*$/.test(w.text.trim());

/**
 * Whether the printed-text reader did badly on a photo (few numbers, or not
 * sure of what it read): then the handwriting reader is tried too.
 */
export function printedIsWeak(words: readonly PlacedWord[]) {
  if (words.length === 0) return true;
  const average = words.reduce((s, w) => s + (w.confidence ?? 0), 0) / words.length;
  return average < 70 || words.filter(isNumberWord).length < 4;
}

/** Whether the handwriting reader's numbers beat the printed-text reader's (each counted by how sure). */
export function preferHandwriting(words: readonly PlacedWord[], hand: HandRead) {
  const printed = words.filter(isNumberWord).reduce((s, w) => s + (w.confidence ?? 0) / 100, 0);
  const handwritten = hand.numbers.reduce((s, c) => s + c / 100, 0);
  return hand.numbers.length > 0 && handwritten > printed;
}
