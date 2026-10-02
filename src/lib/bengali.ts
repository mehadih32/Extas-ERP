import { readFile } from "node:fs/promises";
import path from "node:path";

/*
 * Bengali text in the PDFs. The built-in PDF fonts have no Bengali letters, so
 * Bengali runs are printed in Noto Sans Bengali (SIL Open Font License; the
 * files are in assets/fonts). Bengali also needs shaping: letters join into
 * conjuncts (ক্ষ), some vowel signs move in front of their consonant (কি), and
 * র before another consonant becomes a reph above it (কর্ম). pdfkit's own
 * shaper gets several of these wrong (doubled rephs, broken conjuncts, gaps in
 * the headline), so every Bengali run is shaped by HarfBuzz, the engine that
 * browsers and LibreOffice use, and pdfkit only places the glyphs it returns.
 */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

const FONT_FILES = {
  regular: "NotoSansBengali-Regular.ttf",
  bold: "NotoSansBengali-Bold.ttf",
} as const;

export type BengaliWeight = keyof typeof FONT_FILES;

/** One glyph from HarfBuzz: its id in the font and its placement, in font units. */
export type ShapedGlyph = {
  id: number;
  /** UTF-16 offset of the first character the glyph belongs to. */
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
};

export type BengaliFont = {
  weight: BengaliWeight;
  /** The font file, for pdfkit to embed (only the glyphs used end up in the PDF). */
  bytes: Buffer;
  /** The glyphs of `text`, left to right, as HarfBuzz shapes them. */
  shape(text: string): ShapedGlyph[];
};

export type BengaliFonts = Record<BengaliWeight, BengaliFont>;

/** Characters printed with the Bengali font: the Bengali block and the danda (।, ॥). */
export function isBengaliChar(code: number): boolean {
  return (code >= 0x0980 && code <= 0x09ff) || code === 0x0964 || code === 0x0965;
}

/** Zero-width joiners: they change how Bengali letters join, so they stay in a Bengali run. */
export function isJoiner(code: number): boolean {
  return code === 0x200c || code === 0x200d;
}

let loading: Promise<BengaliFonts> | null = null;

/** The two weights, loaded once per process (HarfBuzz runs as WebAssembly). */
export function loadBengaliFonts(): Promise<BengaliFonts> {
  loading ??= load().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function load(): Promise<BengaliFonts> {
  const hb = await import("harfbuzzjs");
  // One buffer serves every call: shaping is synchronous, so calls never overlap.
  const buffer = new hb.Buffer();
  const open = async (weight: BengaliWeight): Promise<BengaliFont> => {
    const bytes = await readFile(path.join(FONT_DIR, FONT_FILES[weight]));
    const font = new hb.Font(new hb.Face(new hb.Blob(new Uint8Array(bytes))));
    return {
      weight,
      bytes,
      shape(text) {
        buffer.clearContents();
        buffer.addText(text);
        buffer.setLanguage("bn");
        buffer.guessSegmentProperties();
        hb.shape(font, buffer);
        const positions = buffer.getGlyphPositions();
        return buffer.getGlyphInfos().map((info, i) => ({
          id: info.codepoint,
          cluster: info.cluster,
          xAdvance: positions[i]?.xAdvance ?? 0,
          yAdvance: positions[i]?.yAdvance ?? 0,
          xOffset: positions[i]?.xOffset ?? 0,
          yOffset: positions[i]?.yOffset ?? 0,
        }));
      },
    };
  };
  const [regular, bold] = await Promise.all([open("regular"), open("bold")]);
  return { regular, bold };
}

/**
 * Which characters each glyph stands for, so text copied out of the PDF reads
 * right. A glyph that is the font's own glyph for a character gets that
 * character; what is left of its cluster (conjuncts, reph, alternate forms)
 * goes to the first glyph that matched nothing.
 */
export function glyphCharacters(
  text: string,
  glyphs: readonly ShapedGlyph[],
  glyphFor: (codePoint: number) => number,
): number[][] {
  const result: number[][] = glyphs.map(() => []);
  const starts = [...new Set(glyphs.map((g) => g.cluster))].sort((a, b) => a - b);
  starts.forEach((start, k) => {
    const end = starts[k + 1] ?? text.length;
    const remaining = [...text.slice(start, end)].map((c) => c.codePointAt(0)!);
    const members = glyphs.flatMap((g, i) => (g.cluster === start ? [i] : []));
    const unmatched: number[] = [];
    for (const i of members) {
      const at = remaining.findIndex((code) => glyphFor(code) === glyphs[i]!.id);
      if (at >= 0) result[i] = remaining.splice(at, 1);
      else unmatched.push(i);
    }
    const owner = unmatched[0] ?? members[0];
    if (owner !== undefined && remaining.length > 0)
      result[owner] = [...result[owner]!, ...remaining];
  });
  return result;
}
