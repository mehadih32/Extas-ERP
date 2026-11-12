import { existsSync, readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanHandText,
  type HandLine,
  handLines,
  handwritingText,
  handwrittenRow,
  mergedSizes,
  preferHandwriting,
  printedIsWeak,
  splitDigits,
} from "@/modules/inventory/packing-list/handwriting";
import type { PlacedWord } from "@/modules/inventory/packing-list/layout";
import { blockProblems, parsePaperText } from "@/modules/inventory/packing-list/paper";
import {
  encodePng,
  forgetHandwritingReader,
  readHandwriting,
  readPackingFile,
} from "@/modules/inventory/packing-list/readers";

/*
 * Handwritten packing lists (2026-11-12): the second photo reader (PaddleOCR's
 * models on our own server, no AI) reads a handwritten row as one line, often
 * with its separators lost. The lines below are what it read from the owner's
 * photos; the reader itself is replaced here by a stand-in.
 */

const paddle = vi.hoisted(() => ({
  mode: "ok" as "ok" | "load-fails" | "read-fails",
  lines: [] as unknown[],
  paths: [] as string[],
  existed: [] as boolean[],
  creates: 0,
}));

vi.mock("@gutenye/ocr-node", () => ({
  default: {
    create: async () => {
      paddle.creates++;
      if (paddle.mode === "load-fails") throw new Error("model files missing");
      return {
        detect: async (file: string) => {
          paddle.paths.push(file);
          paddle.existed.push(existsSync(file));
          if (paddle.mode === "read-fails") throw new Error("cannot decode");
          return { texts: paddle.lines, resizedImageWidth: 800, resizedImageHeight: 600 };
        },
      };
    },
  },
}));

/** A reader line at a place: x from x0 to x1, one row of 40 px at row y. */
const at = (text: string, x0: number, x1: number, y: number, mean = 0.9): HandLine => ({
  text,
  mean,
  box: [
    [x0, y],
    [x1, y],
    [x1, y + 40],
    [x0, y + 40],
  ],
});

const pieces = (row: ReturnType<typeof handwrittenRow>) => row?.cells.map((c) => c.pieces);

describe("a handwritten row read as one line", () => {
  it("splits digits that ran together so they add up to the paper's total", () => {
    const row = handwrittenRow("1441333412=134", 5);
    expect(pieces(row)).toEqual([14, 41, 33, 34, 12]);
    expect(row!.total).toBe(134);
    expect(row!.checked).toBe(true);
    // Without the paper's size line too.
    expect(pieces(handwrittenRow("1441333412=134", null))).toEqual([14, 41, 33, 34, 12]);
  });

  it("keeps the colour's letters as read, a digit inside them too", () => {
    const row = handwrittenRow("B2ACK1441333412=134", 5);
    expect(row!.label).toBe("B2ACK");
    expect(pieces(row)).toEqual([14, 41, 33, 34, 12]);
  });

  it("keeps the separators' reading when no split adds up", () => {
    const row = handwrittenRow("6-39-95-19-17-16=142", 5);
    expect(row!.label).toBe("");
    expect(pieces(row)).toEqual([6, 39, 95, 19, 17, 16]);
    expect(row!.total).toBe(142);
    expect(row!.checked).toBe(false);
  });

  it("never stops on a line it cannot make add up", () => {
    const row = handwrittenRow("BLACK2058S8 40 196", 5);
    expect(row!.label).toBe("BLACK");
    expect(row!.cells.length).toBeGreaterThan(0);
    expect(() => handwrittenRow("NAW-163828132=102", 5)).not.toThrow();
    expect(handwrittenRow("NAW-163828132=102", 5)!.label).toBe("NAW");
    expect(() => handwrittenRow("=".repeat(300) + "9".repeat(200), null)).not.toThrow();
    expect(handwrittenRow("NAVY BLUE", 5)).toBeNull();
  });

  it("takes the last number as the total when there are more numbers than sizes", () => {
    const row = handwrittenRow("Navy 2 23 6 10 5 46", 5);
    expect(row!.label).toBe("Navy");
    expect(pieces(row)).toEqual([2, 23, 6, 10, 5]);
    expect(row!.total).toBe(46);
    expect(row!.checked).toBe(true);
  });

  it("finds the total after digits that ran together, even without “=”", () => {
    const row = handwrittenRow("RED 2058 40 118", 4);
    expect(pieces(row)).toEqual([20, 58, 40]);
    expect(row!.total).toBe(118);
  });

  it("reads a letter the reader put for a digit after the colour", () => {
    expect(pieces(handwrittenRow("GREY 1O 2S 3l = 66", 3))).toEqual([10, 25, 31]);
  });

  it("drops the Chinese the reader's models can also read, and full-width signs", () => {
    expect(cleanHandText("ＢＬＡＣＫ 12－14 ＝ 26 黑")).toBe("BLACK 12-14 = 26");
  });
});

describe("splitting digits that ran together", () => {
  it("prefers 2-digit numbers and tells when another split is as good", () => {
    expect(splitDigits(["2236105"], 46, 5)).toEqual({ cells: [2, 23, 6, 10, 5], ambiguous: true });
    expect(splitDigits(["1441333412"], 134, 5)).toEqual({
      cells: [14, 41, 33, 34, 12],
      ambiguous: false,
    });
  });

  it("never splits a run of 1 or 2 digits, and never goes past the sizes", () => {
    expect(splitDigits(["6", "39", "95", "19", "17", "16"], 142, 12)).toBeNull();
    expect(splitDigits(["1441333412"], 134, 4)).toBeNull();
    expect(splitDigits(["0505"], 10, 4)).toEqual({ cells: [0, 5, 0, 5], ambiguous: false });
  });
});

describe("a whole handwritten photo", () => {
  it("becomes the paper's text: sizes, rows and totals that add up", () => {
    const read = handwritingText([
      at("HOODY-ZIP", 0, 200, 0),
      at("SMLXLXXL", 100, 500, 50),
      at("B2ACK1441333412=134", 0, 600, 100),
      at("Navy 2 23 6 10 5", 0, 500, 150),
      // The row's total, written to its right, read as a line of its own.
      at("=46", 560, 620, 152),
      at("639", 300, 360, 300),
    ]);
    expect(read.text.split("\n")).toEqual([
      "HOODY-ZIP",
      "S M L XL XXL",
      "BZACK - 14 - 41 - 33 - 34 - 12 = 134",
      "Navy - 2 - 23 - 6 - 10 - 5 = 46",
      "639",
    ]);
    expect(read.numbers).toHaveLength(10);
    const { blocks } = parsePaperText(read.text);
    expect(blocks[0]!.title).toBe("HOODY-ZIP");
    expect(blocks[0]!.sizes).toEqual(["S", "M", "L", "XL", "XXL"]);
    expect(blocks[0]!.rows.map((r) => r.colour)).toEqual(["BZACK", "Navy"]);
    expect(blocks[0]!.rows.map((r) => r.writtenTotal)).toEqual([134, 46]);
    // The grand total under the rows does not match: shown red for the person to check.
    expect(blockProblems(blocks[0]!).length).toBeGreaterThan(0);
  });

  it("marks the numbers of an unsure row that does not add up", () => {
    const read = handwritingText([
      at("S M L", 0, 300, 0),
      at("Red 10 20 31 = 60", 0, 400, 50, 0.6),
    ]);
    expect(read.text.split("\n")[1]).toBe("Red - 10? - 20? - 31? = 60");
  });

  it("reads the reader's answer in either shape and skips anything else", () => {
    const line = {
      text: "Red 1 2",
      mean: 0.9,
      box: [
        [0, 0],
        [9, 0],
        [9, 9],
        [0, 9],
      ],
    };
    expect(handLines({ texts: [line] })).toHaveLength(1);
    expect(handLines([line, { text: 5 }, null])).toHaveLength(1);
    expect(handLines("nothing")).toEqual([]);
    expect(handLines([{ text: "x", mean: 7 }])[0]).toEqual({ text: "x", mean: 1, box: null });
  });

  it("finds sizes written without spaces only when the whole line is sizes", () => {
    expect(mergedSizes("SMLXLXXL")).toEqual(["S", "M", "L", "XL", "XXL"]);
    expect(mergedSizes("Size S-M-L")).toEqual(["S", "M", "L"]);
    expect(mergedSizes("SLIM")).toBeNull();
    expect(mergedSizes("ML")).toBeNull();
  });
});

describe("which reader's result is used", () => {
  const word = (text: string, confidence: number): PlacedWord => ({
    text,
    x0: 0,
    x1: 10,
    y0: 0,
    y1: 10,
    confidence,
  });
  const printed = ["Navy", "2", "23", "6", "10", "5", "46"].map((t) => word(t, 92));

  it("keeps a printed photo read well, and tries handwriting when little was read", () => {
    expect(printedIsWeak(printed)).toBe(false);
    expect(printedIsWeak([])).toBe(true);
    expect(printedIsWeak(printed.map((w) => ({ ...w, confidence: 40 })))).toBe(true);
    expect(printedIsWeak([word("Navy", 95), word("12", 95)])).toBe(true);
  });

  it("uses the handwriting only when its numbers beat the printed reader's", () => {
    const hand = { text: "", numbers: [90, 90, 90], confidences: [90] };
    expect(preferHandwriting([word("B~", 30), word("1", 20)], hand)).toBe(true);
    expect(preferHandwriting(printed, hand)).toBe(false);
    expect(preferHandwriting([], { text: "x", numbers: [], confidences: [50] })).toBe(false);
  });
});

describe("running the handwriting reader", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    forgetHandwritingReader();
    Object.assign(paddle, { mode: "ok", lines: [], paths: [], existed: [], creates: 0 });
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  const blank = encodePng(new Uint8Array(400 * 200).fill(255), 400, 200, 1);

  it("reads the photo from a private file it always removes, and keeps the reader", async () => {
    paddle.lines = [at("S M L", 0, 300, 0), at("Red 102030=60", 0, 400, 50)];
    const read = await readHandwriting(blank);
    expect(read!.text).toBe("S M L\nRed - 10 - 20 - 30 = 60");
    expect(paddle.existed).toEqual([true]);
    expect(existsSync(paddle.paths[0]!)).toBe(false);
    await readHandwriting(blank);
    expect(paddle.creates).toBe(1);
  });

  it("gives nothing, never an error, when the reader cannot load or read", async () => {
    paddle.mode = "load-fails";
    expect(await readHandwriting(blank)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // Loaded again with the next photo.
    paddle.mode = "read-fails";
    expect(await readHandwriting(blank)).toBeNull();
    expect(paddle.creates).toBe(2);
    expect(existsSync(paddle.paths[0]!)).toBe(false);
  });

  it(
    "uses the handwriting for a photo the printed reader found nothing in",
    {
      timeout: 120_000,
    },
    async () => {
      paddle.lines = [at("S M L", 0, 300, 0), at("Black 1441 26=81", 0, 400, 50)];
      const read = await readPackingFile({ bytes: blank, fileName: "hand.png" });
      expect(read.photoText).toBe("S M L\nBlack - 14 - 41 - 26 = 81");
      expect(read.sheets[0]!.notes[0]).toMatch(/handwriting was read/);
      expect(read.sheets[0]!.rows).toEqual([]);
    },
  );

  it(
    "falls back to the printed reader when the handwriting reader fails",
    {
      timeout: 120_000,
    },
    async () => {
      paddle.mode = "load-fails";
      const read = await readPackingFile({ bytes: blank, fileName: "hand.png" });
      expect(read.photoText).toBe("");
      expect(read.sheets[0]!.notes[0]).toMatch(/No writing was found/);
    },
  );

  it("never runs it on a printed photo read well", { timeout: 120_000 }, async () => {
    const bytes = readFileSync("tests/fixtures/packing-lists/printed-photo.png");
    const read = await readPackingFile({ bytes, fileName: "list.png" });
    expect(read.photoText).toMatch(/Navy/);
    expect(paddle.creates).toBe(0);
  });
});
