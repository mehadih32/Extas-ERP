import PDFDocument from "pdfkit";

/*
 * Helpers shared by the PDF writers (Report Builder and printed documents), on top
 * of pdfkit with its built-in fonts. Text is placed line by line at exact
 * positions, never through pdfkit's own wrapping, so nothing spills over or adds a
 * page by surprise. The built-in fonts cover Western European text only: other
 * scripts (e.g. Bengali) show as "?".
 */

export const PDF_MIME = "application/pdf";

/** Characters the built-in fonts can draw (Windows-1252 / WinAnsi). */
const WIN_ANSI_EXTRA = new Set(
  [
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
    0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
    0x0153, 0x017e, 0x0178,
  ].map((c) => String.fromCodePoint(c)),
);

/** Text the built-in fonts can draw on one line: other characters become "?". */
export function pdfText(text: string): string {
  let out = "";
  let replaced = false;
  for (const ch of text.normalize("NFC").replace(/\s+/g, " ")) {
    const code = ch.codePointAt(0)!;
    const ok =
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch);
    if (ok) {
      out += ch;
      replaced = false;
    } else if (!replaced) {
      out += "?";
      replaced = true;
    }
  }
  return out;
}

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

/**
 * Text cut to `width` with "…" at the end, measured in the document's current
 * font and size (and letter spacing, when given).
 */
export function fitText(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  characterSpacing = 0,
): string {
  const clean = pdfText(text);
  const measure = (s: string) => doc.widthOfString(s, { characterSpacing });
  if (measure(clean) <= width) return clean;
  let lo = 0;
  let hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${clean.slice(0, mid).trimEnd()}…`) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : `${clean.slice(0, lo).trimEnd()}…`;
}

/**
 * Greedy word wrap into lines no wider than `width` in the given font and size.
 * A word longer than a whole line is cut with "…" rather than overflowing.
 */
export function wrapText(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  font: string,
  size: number,
): string[] {
  doc.font(font).fontSize(size);
  const lines: string[] = [];
  let current = "";
  for (const word of pdfText(text).split(" ")) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (current && doc.widthOfString(next) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.map((line) => (doc.widthOfString(line) > width ? fitText(doc, line, width) : line));
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
