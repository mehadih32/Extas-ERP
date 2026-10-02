import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { type BengaliFonts, glyphCharacters, loadBengaliFonts } from "@/lib/bengali";
import {
  collectPdf,
  createPdf,
  drawText,
  fitText,
  pdfText,
  type TextStyle,
  textRuns,
  textWidth,
  wrapText,
} from "@/lib/pdf";

import { pdfTextBlocks } from "../fixtures/pdf";

const REGULAR: TextStyle = { font: "Helvetica", size: 10 };
const BOLD: TextStyle = { font: "Helvetica-Bold", size: 10 };

let fonts: BengaliFonts;
/** The font's own name for a glyph ("ka-beng", "reph-beng"...), read with HarfBuzz. */
let glyphName: (id: number) => string;
/** The font's own glyph for a character. */
let glyphOf: (codePoint: number) => number;

beforeAll(async () => {
  fonts = await loadBengaliFonts();
  const hb = await import("harfbuzzjs");
  const bytes = readFileSync(path.join("assets", "fonts", "NotoSansBengali-Regular.ttf"));
  const font = new hb.Font(new hb.Face(new hb.Blob(new Uint8Array(bytes))));
  glyphName = (id) => font.glyphName(id);
  glyphOf = (codePoint) => font.nominalGlyph(codePoint) ?? -1;
});

const names = (text: string) => fonts.regular.shape(text).map((g) => glyphName(g.id));

/** Draws each line on its own row and returns the PDF. */
async function pdfOf(lines: Array<[string, TextStyle?]>): Promise<Buffer> {
  const doc = await createPdf({ size: "A4", margin: 40, compress: false });
  const done = collectPdf(doc);
  lines.forEach(([text, style], i) => drawText(doc, text, 40, 40 + i * 20, style ?? REGULAR));
  doc.end();
  return done;
}

describe("pdfText", () => {
  it("keeps Bengali and Western European text and turns other scripts into one ?", () => {
    expect(pdfText("রহিম ট্রেডার্স, Dhaka – Café")).toBe("রহিম ট্রেডার্স, Dhaka – Café");
    expect(pdfText("মূল্য ১,২০০ টাকা।")).toBe("মূল্য ১,২০০ টাকা।");
    expect(pdfText("漢字 নাম 😀")).toBe("? নাম ?");
  });

  it("keeps zero-width joiners only beside Bengali letters", () => {
    expect(pdfText("র\u200dয")).toBe("র\u200dয");
    expect(pdfText("a\u200db\u200cc")).toBe("abc");
  });

  it("drops invisible characters and joins whitespace", () => {
    expect(pdfText("\ufeffবাংলা\u200b  দেশ\n\tA\u00adB")).toBe("বাংলা দেশ AB");
    expect(pdfText("a \u200b b")).toBe("a b");
  });

  it("composes vowel signs typed in two parts (NFC)", () => {
    // ে + া is the single sign ো.
    expect(pdfText("ক\u09c7\u09be")).toBe("ক\u09cb");
  });
});

describe("textRuns", () => {
  it("splits a line into Latin and Bengali runs, keeping spaces between Bengali words", () => {
    expect(textRuns("Bill to: রহিম ট্রেডার্স (Dhaka)")).toEqual([
      { text: "Bill to: ", bengali: false },
      { text: "রহিম ট্রেডার্স", bengali: true },
      { text: " (Dhaka)", bengali: false },
    ]);
    expect(textRuns("Qty ১২০ pcs")).toEqual([
      { text: "Qty ", bengali: false },
      { text: "১২০", bengali: true },
      { text: " pcs", bengali: false },
    ]);
  });
});

describe("Bengali shaping (HarfBuzz)", () => {
  it("puts the i-kar in front of its consonant", () => {
    expect(names("কি")).toEqual(["iMatra-beng", "ka-beng"]);
  });

  it("joins conjuncts, rephs and vowel signs without stray marks", () => {
    for (const word of [
      "বাংলাদেশ",
      "পরিদর্শন",
      "নিষ্ক্রিয়",
      "পার্টি",
      "কর্মী",
      "প্রিন্ট",
      "ট্রেডার্স",
    ]) {
      const glyphs = names(word);
      // A dotted circle or a visible hasanta means a sign was left unattached.
      expect(glyphs, word).not.toContain("dottedCircle");
      expect(
        glyphs.filter((n) => n.startsWith("halant")),
        word,
      ).toEqual([]);
    }
    // পরিদর্শন: the র of রি stays a letter; the র before শ becomes one reph above it.
    expect(names("পরিদর্শন").filter((n) => n === "ra-beng")).toHaveLength(1);
    expect(names("পরিদর্শন").filter((n) => n.startsWith("reph"))).toHaveLength(1);
  });

  it("gives every typed character to exactly one glyph", () => {
    for (const word of ["নিষ্ক্রিয়", "পার্টি", "প্রিন্ট", "রহিম ট্রেডার্স", "উজ্জ্বল"]) {
      const shaped = fonts.regular.shape(word);
      const characters = glyphCharacters(word, shaped, glyphOf);
      const given = characters.flat().sort((a, b) => a - b);
      const typed = [...word].map((c) => c.codePointAt(0)!).sort((a, b) => a - b);
      expect(given, word).toEqual(typed);
    }
  });

  it("loads the fonts once", async () => {
    expect(await loadBengaliFonts()).toBe(fonts);
  });
});

describe("Bengali in PDFs", () => {
  it("embeds the Bengali font only when Bengali is printed", async () => {
    const latin = await pdfOf([["Commercial Invoice"]]);
    expect(latin.toString("latin1")).not.toContain("NotoSansBengali");

    const bengali = await pdfOf([["Bill to: রহিম ট্রেডার্স"]]);
    const blocks = pdfTextBlocks(bengali);
    expect(blocks.map((b) => b.font.replace(/^[A-Z]{6}\+/, ""))).toEqual([
      "Helvetica",
      "NotoSansBengali-Regular",
    ]);
  });

  it("draws the glyphs HarfBuzz chose and keeps the line as typed for copying", async () => {
    const line = "পরিদর্শন: নিষ্ক্রিয় পার্টি";
    const blocks = pdfTextBlocks(await pdfOf([[line]]));
    const bengali = blocks.filter((b) => b.font.endsWith("NotoSansBengali-Regular"));
    expect(bengali.map((b) => b.glyphs)).toEqual([
      fonts.regular.shape("পরিদর্শন").length,
      fonts.regular.shape("নিষ্ক্রিয় পার্টি").length,
    ]);
    expect(new Set(blocks.map((b) => b.actualText))).toEqual(new Set([line]));
  });

  it("prints bold Bengali in the bold weight", async () => {
    const blocks = pdfTextBlocks(await pdfOf([["মোট", BOLD]]));
    expect(blocks.map((b) => b.font.replace(/^[A-Z]{6}\+/, ""))).toEqual(["NotoSansBengali-Bold"]);
  });

  it("sets Bengali on the same baseline as the Latin text beside it", async () => {
    const blocks = pdfTextBlocks(await pdfOf([["Total মোট 1,200"], ["কি Bold", BOLD]]));
    const rows = new Map<number, number[]>();
    for (const b of blocks) rows.set(b.y, [...(rows.get(b.y) ?? []), b.x]);
    // Two rows, each starting at the left margin and moving right run by run.
    expect([...rows.values()].map((xs) => xs.length)).toEqual([3, 2]);
    for (const xs of rows.values()) {
      expect(xs[0]).toBe(40);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
    }
  });

  it("measures, cuts and wraps Bengali between whole letters", async () => {
    const doc = await createPdf({ size: "A4" });
    const text = "সোনালি রং একটু উজ্জ্বল হবে, বোতাম ঠিকমতো লাগাতে হবে";
    const full = textWidth(doc, text, REGULAR);
    expect(full).toBeGreaterThan(100);
    // Width is the sum of the runs, so a mixed line measures as its parts.
    expect(textWidth(doc, `Note: ${text}`, REGULAR)).toBeCloseTo(
      textWidth(doc, "Note: ", REGULAR) + full,
      6,
    );

    const graphemes = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].map(
      (s) => s.segment,
    );
    for (const width of [30, 55, 80, 120]) {
      const cut = fitText(doc, text, width, REGULAR);
      expect(cut.endsWith("…")).toBe(true);
      expect(textWidth(doc, cut, REGULAR)).toBeLessThanOrEqual(width);
      const kept = cut.slice(0, -1);
      // The cut text is whole letters from the start: no conjunct or vowel sign is split.
      const prefixes = graphemes.map((_, n) =>
        graphemes
          .slice(0, n + 1)
          .join("")
          .trimEnd(),
      );
      expect(prefixes).toContain(kept);
    }

    const lines = wrapText(doc, text, 120, REGULAR);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(text);
    for (const line of lines) expect(textWidth(doc, line, REGULAR)).toBeLessThanOrEqual(120);
  });

  it("refuses Bengali in a document not made with createPdf", async () => {
    const { default: PDFDocument } = await import("pdfkit");
    const doc = new PDFDocument();
    expect(() => textWidth(doc, "কি", REGULAR)).toThrow(/createPdf/);
    expect(textWidth(doc, "Latin only", REGULAR)).toBeGreaterThan(0);
  });
});
