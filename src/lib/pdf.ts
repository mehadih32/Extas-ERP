import PDFDocument from "pdfkit";

import {
  type BengaliFont,
  type BengaliFonts,
  type BengaliWeight,
  glyphCharacters,
  isBengaliChar,
  isJoiner,
  loadBengaliFonts,
} from "@/lib/bengali";

/*
 * Helpers shared by the PDF writers (Report Builder and printed documents), on top
 * of pdfkit. Latin text uses the built-in fonts (Helvetica and Times, which cover
 * Western European text); Bengali text uses Noto Sans Bengali, shaped by HarfBuzz
 * (see bengali.ts), on the same baseline. Other scripts show as "?". Text is
 * placed line by line at exact positions, never through pdfkit's own wrapping,
 * so nothing spills over or adds a page by surprise. Make documents with
 * createPdf() so they can print Bengali.
 */

export const PDF_MIME = "application/pdf";

/** Characters the built-in fonts can draw (Windows-1252 / WinAnsi) beyond Latin-1. */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

/** Invisible characters left out of PDF text: zero-width space, direction marks, BOM, soft hyphen. */
const INVISIBLE = new Set([0x00ad, 0x200b, 0x200e, 0x200f, 0x2060, 0xfeff]);

function isLatinChar(code: number): boolean {
  return (
    (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(code)
  );
}

/**
 * Text the PDF fonts can draw on one line: Western European and Bengali text is
 * kept, whitespace becomes single spaces, and other characters become "?".
 */
export function pdfText(text: string): string {
  // Invisible characters go first: JavaScript counts the BOM as whitespace.
  const visible = [...text.normalize("NFC")]
    .filter((c) => !INVISIBLE.has(c.codePointAt(0)!))
    .join("");
  const codes = [...visible.replace(/\s+/g, " ")].map((c) => c.codePointAt(0)!);
  let out = "";
  let replaced = false;
  codes.forEach((code, i) => {
    if (isJoiner(code)) {
      // A joiner only means something between Bengali letters.
      const prev = codes[i - 1];
      const next = codes[i + 1];
      if (
        (prev !== undefined && isBengaliChar(prev)) ||
        (next !== undefined && isBengaliChar(next))
      ) {
        out += String.fromCodePoint(code);
      }
      return;
    }
    if (isLatinChar(code) || isBengaliChar(code)) {
      out += String.fromCodePoint(code);
      replaced = false;
    } else if (!replaced) {
      out += "?";
      replaced = true;
    }
  });
  return out;
}

/** Document metadata (title, author): any script works there, it only needs one line. */
export function pdfInfo(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type TextRun = { text: string; bengali: boolean };

/** Text (as pdfText returns it) in runs for the Latin and the Bengali font. */
export function textRuns(text: string): TextRun[] {
  const chars = [...text];
  const runs: TextRun[] = [];
  chars.forEach((ch, i) => {
    const code = ch.codePointAt(0)!;
    const last = runs.at(-1);
    let bengali = isBengaliChar(code) || isJoiner(code);
    if (ch === " " && last?.bengali) {
      // A space between two Bengali words stays in the Bengali run.
      const next = chars[i + 1]?.codePointAt(0);
      bengali = next !== undefined && (isBengaliChar(next) || isJoiner(next));
    }
    if (last && last.bengali === bengali) last.text += ch;
    else runs.push({ text: ch, bengali });
  });
  return runs;
}

/** A font and size for a line of text. Letter spacing applies to Latin text only. */
export type TextStyle = { font: string; size: number; spacing?: number };

// --- Documents that can print Bengali ------------------------------------------

const BENGALI_FONT: Record<BengaliWeight, string> = {
  regular: "Bengali",
  bold: "Bengali-Bold",
};

/** The fontkit font inside a pdfkit embedded font (pdfkit leaves these internals untyped). */
type FontkitFont = {
  layout: (text: string, features?: unknown) => unknown;
  glyphForCodePoint(codePoint: number): { id: number };
  getGlyph(id: number): { advanceWidth: number };
};

const documentFonts = new WeakMap<PDFKit.PDFDocument, BengaliFonts>();
const shapedFonts = new WeakSet<object>();

/** A new pdfkit document that can print Bengali; use it instead of `new PDFDocument()`. */
export async function createPdf(options: PDFKit.PDFDocumentOptions): Promise<PDFKit.PDFDocument> {
  const fonts = await loadBengaliFonts();
  const doc = new PDFDocument(options);
  for (const weight of ["regular", "bold"] as const) {
    doc.registerFont(BENGALI_FONT[weight], fonts[weight].bytes);
  }
  documentFonts.set(doc, fonts);
  return doc;
}

/**
 * pdfkit lays text out with fontkit, whose Bengali shaping is wrong in places,
 * so the embedded Bengali font asks HarfBuzz instead. pdfkit then subsets,
 * measures and places the glyphs as usual.
 */
function harfbuzzLayout(fontkit: FontkitFont, font: BengaliFont) {
  const cmap = new Map<number, number>();
  const glyphFor = (code: number) => {
    let id = cmap.get(code);
    if (id === undefined) {
      id = fontkit.glyphForCodePoint(code).id;
      cmap.set(code, id);
    }
    return id;
  };
  return (text: string) => {
    const shaped = font.shape(text);
    const characters = glyphCharacters(text, shaped, glyphFor);
    const glyphs = shaped.map((g, i) => ({
      id: g.id,
      advanceWidth: fontkit.getGlyph(g.id).advanceWidth,
      codePoints: characters[i]!,
    }));
    // Fresh objects: pdfkit scales these in place.
    const positions = shaped.map((g) => ({
      xAdvance: g.xAdvance,
      yAdvance: g.yAdvance,
      xOffset: g.xOffset,
      yOffset: g.yOffset,
    }));
    return {
      glyphs,
      positions,
      get advanceWidth() {
        return positions.reduce((sum, p) => sum + p.xAdvance, 0);
      },
    };
  };
}

/** Selects the font for one run: the style's own font, or the Bengali font of its weight. */
function selectRunFont(doc: PDFKit.PDFDocument, run: TextRun, style: TextStyle) {
  if (!run.bengali) {
    doc.font(style.font).fontSize(style.size);
    return;
  }
  const fonts = documentFonts.get(doc);
  if (!fonts) throw new Error("Make the PDF with createPdf() to print Bengali text.");
  const weight: BengaliWeight = /bold/i.test(style.font) ? "bold" : "regular";
  doc.font(BENGALI_FONT[weight]).fontSize(style.size);
  const embedded = (doc as unknown as { _font: { font: FontkitFont } })._font;
  if (!shapedFonts.has(embedded)) {
    embedded.font.layout = harfbuzzLayout(embedded.font, fonts[weight]);
    shapedFonts.add(embedded);
  }
}

function runWidth(doc: PDFKit.PDFDocument, run: TextRun, style: TextStyle): number {
  selectRunFont(doc, run, style);
  return run.bengali
    ? doc.widthOfString(run.text)
    : doc.widthOfString(run.text, { characterSpacing: style.spacing ?? 0 });
}

/** The width of a line of text in the style, Bengali included. */
export function textWidth(doc: PDFKit.PDFDocument, text: string, style: TextStyle): number {
  const runs = textRuns(pdfText(text));
  const spacing = style.spacing ?? 0;
  return runs.reduce(
    (sum, run, i) =>
      sum + runWidth(doc, run, style) + (!run.bengali && i < runs.length - 1 ? spacing : 0),
    0,
  );
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Text cut to `width` with "…" at the end. Cuts fall between whole letters, so a
 * Bengali conjunct or vowel sign is never split.
 */
export function fitText(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  style: TextStyle,
): string {
  const clean = pdfText(text);
  if (textWidth(doc, clean, style) <= width) return clean;
  const parts = [...graphemes.segment(clean)].map((s) => s.segment);
  const cut = (n: number) => `${parts.slice(0, n).join("").trimEnd()}…`;
  let lo = 0;
  let hi = parts.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(doc, cut(mid), style) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : cut(lo);
}

/**
 * Greedy word wrap into lines no wider than `width`. A word longer than a whole
 * line is cut with "…" rather than overflowing.
 */
export function wrapText(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  style: TextStyle,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of pdfText(text).split(" ")) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (current && textWidth(doc, next, style) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.map((line) =>
    textWidth(doc, line, style) > width ? fitText(doc, line, width, style) : line,
  );
}

/**
 * Draws one line (already cut to fit) with its top at `y`, like
 * `doc.text(text, x, y, { lineBreak: false })`, in the current fill colour.
 * Bengali runs sit on the baseline of the Latin font. A line with Bengali in it
 * carries its text as ActualText, so copying and searching the PDF give the
 * words as typed (the glyphs of a Bengali word are not in typing order).
 * Returns the width drawn.
 */
export function drawText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): number {
  const clean = pdfText(text);
  const runs = textRuns(clean);
  const spacing = style.spacing ?? 0;
  doc.font(style.font).fontSize(style.size);
  const ascender = (doc as unknown as { _font: { ascender: number } })._font.ascender;
  const baseline = y + (ascender * style.size) / 1000;
  const marked = runs.some((run) => run.bengali);
  if (marked) doc.markContent("Span", { actual: clean });
  let cx = x;
  runs.forEach((run, i) => {
    selectRunFont(doc, run, style);
    if (run.bengali) {
      doc.text(run.text, cx, baseline, { lineBreak: false, baseline: "alphabetic" });
      cx += doc.widthOfString(run.text);
    } else {
      doc.text(run.text, cx, y, { lineBreak: false, characterSpacing: spacing });
      cx += doc.widthOfString(run.text, { characterSpacing: spacing });
      if (i < runs.length - 1) cx += spacing;
    }
  });
  if (marked) doc.endMarkedContent();
  return cx - x;
}

// --- Colours and output ---------------------------------------------------------

/** A "#RRGGBB" colour, or the fallback when it is anything else. */
export function safeHex(color: string | null | undefined, fallback: string): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

/** The colour mixed with white: amount 0 = the colour, 1 = white. */
export function tint(color: string, amount: number): string {
  const n = parseInt(color.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Collects a pdfkit document's output; call before writing pages, await after `end()`. */
export function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * The size pdfkit reads from an image, or null when it cannot open it. Only for
 * images that already passed the checks in images.ts: pdfkit trusts what it gets.
 */
export function pdfImageSize(bytes: Buffer): { width: number; height: number } | null {
  try {
    const doc = new PDFDocument({ autoFirstPage: false });
    const image = (
      doc as unknown as { openImage(src: Buffer): { width: number; height: number } }
    ).openImage(bytes);
    return { width: image.width, height: image.height };
  } catch {
    return null;
  }
}
