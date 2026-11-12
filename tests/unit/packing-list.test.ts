import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buyReadyLink,
  cellsWithPieces,
  codeFromTitle,
  colourChoice,
  readBuyPrefill,
  sizeChoice,
  styleChoice,
  tidyName,
} from "@/components/products/packing-list-model";
import {
  applySavedLayout,
  detectLayout,
  readBlocks,
  readPieces,
  saveLayout,
  type Sheet,
  wordsToRows,
} from "@/modules/inventory/packing-list/layout";
import {
  blockPieces,
  blockProblems,
  closest,
  likelyStyles,
  parsePaperText,
  renderPaperText,
  sizeFor,
} from "@/modules/inventory/packing-list/paper";
import {
  packingFileType,
  readCsv,
  readPackingFile,
  readPdfText,
  readXlsx,
} from "@/modules/inventory/packing-list/readers";

/*
 * Reading packing lists without AI (2026-11-12): Excel, CSV, PDF text and
 * photos on our own server, the "type it like the paper" text, the totals
 * check and matching handwritten names to the catalog. The sample files are
 * made-up lists in tests/fixtures/packing-lists.
 */

const fixture = (name: string) => readFileSync(`tests/fixtures/packing-lists/${name}`);

/** The first block's grid as { colour: [pieces per size] }. */
function grid(sheet: Sheet) {
  const layout = detectLayout(sheet);
  expect(layout).not.toBeNull();
  const blocks = readBlocks(sheet, layout!);
  return { layout: layout!, blocks };
}

const cells = (row: { cells: Array<{ pieces: number | null }> }) => row.cells.map((c) => c.pieces);

describe("Excel packing lists", () => {
  it("reads a colour x size grid with merged headers, blanks, a Total column and a Total row", () => {
    const [sheet] = readXlsx(fixture("grid.xlsx"));
    const { layout, blocks } = grid(sheet!);
    expect(layout.kind).toBe("GRID");
    expect(layout.defaultStyle).toBe("TST-POLO-1");
    const [block] = blocks;
    expect(block!.title).toBe("TST-POLO-1");
    expect(block!.sizes).toEqual(["S", "M", "L", "XL", "2XL"]);
    expect(block!.rows.map((r) => r.colour)).toEqual(["Black", "Navy", "Grey", "Brown"]);
    expect(cells(block!.rows[1]!)).toEqual([2, 23, 6, 10, 5]);
    expect(block!.rows[1]!.writtenTotal).toBe(46);
    expect(block!.writtenTotal).toBe(160);
    expect(blockPieces(block!)).toBe(160);
    expect(blockProblems(block!)).toEqual([]);
  });

  it("reads a long list (one row per colour and size) and takes the total pieces, not the cartons", () => {
    const [sheet] = readXlsx(fixture("long-list.xlsx"));
    const { layout, blocks } = grid(sheet!);
    expect(layout.kind).toBe("LIST");
    const [block] = blocks;
    expect(block!.title).toBe("TST-TEE-2");
    expect(block!.sizes).toEqual(["M", "L", "XL"]);
    // The merged colour cell gives "White" to the L row as well.
    const white = block!.rows.find((r) => r.colour === "White")!;
    expect(cells(white)).toEqual([40, 20]);
    const red = block!.rows.find((r) => r.colour === "Red")!;
    expect(cells(red)).toEqual([15, null, 1000]);
  });

  it("remembers a layout by its column names and finds it in the next file", () => {
    const [sheet] = readXlsx(fixture("long-list.xlsx"));
    const layout = detectLayout(sheet!)!;
    const saved = saveLayout(sheet!, layout);
    expect(saved).toMatchObject({
      kind: "LIST",
      colour: "COLOR",
      size: "SIZE",
      pieces: "TOTAL PCS",
    });
    // The next list starts two rows lower: the header row is found by its names.
    const moved: Sheet = {
      ...sheet!,
      rows: [[{ text: "" }], [{ text: "Factory" }], ...sheet!.rows],
    };
    const again = applySavedLayout(moved, saved)!;
    expect(again.headerRow).toBe(layout.headerRow + 2);
    expect(readBlocks(moved, again)[0]!.rows.length).toBe(2);
  });

  it("refuses an old .xls with what to do instead", () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expect(() => packingFileType(xls, "list.xls")).toThrow(/save it as \.xlsx or CSV/);
  });
});

describe("CSV and PDF packing lists", () => {
  it("reads a semicolon CSV with quotes, a dash for none and a doubtful number", () => {
    const { blocks } = grid(readCsv(fixture("grid.csv")));
    const [block] = blocks;
    expect(block!.sizes).toEqual(["S", "M", "L", "XL"]);
    expect(cells(block!.rows[0]!)).toEqual([10, 20, 30]);
    expect(block!.rows[0]!.colour).toBe("Navy Blue");
    // "1,2" is not a whole number of pieces: kept as 12 and shown yellow.
    const olive = block!.rows[1]!;
    expect(olive.cells[3]!.unsure).toBeTruthy();
  });

  it("reads a PDF's printed table by where its words sit", async () => {
    const sheet = await readPdfText(fixture("grid.pdf"));
    const { blocks } = grid(sheet!);
    const [block] = blocks;
    expect(block!.title).toBe("TST-POLO-1");
    expect(block!.sizes).toEqual(["S", "M", "L", "XL", "XXL"]);
    expect(block!.rows.map((r) => r.colour)).toEqual(["Black", "Navy", "Bottle Green"]);
    expect(cells(block!.rows[2]!)).toEqual([3, 6, 6, 3]);
    expect(block!.rows.map((r) => r.writtenTotal)).toEqual([78, 65, 18]);
    expect(block!.writtenTotal).toBe(161);
    expect(blockProblems(block!)).toEqual([]);
  });
});

describe("photos and scans", () => {
  it("shows a photo beside an empty paper box to type into", async () => {
    const read = await readPackingFile({
      bytes: fixture("printed-photo.png"),
      fileName: "list.png",
    });
    expect(read.photoText).toBe("");
    expect(read.sheets[0]!.notes[0]).toMatch(/Type the lines/);
  });

  it("joins a photo's words into cells and columns by where they sit", () => {
    const rows = wordsToRows([
      { text: "Navy", x0: 0, x1: 40, y0: 0, y1: 10 },
      { text: "Blue", x0: 44, x1: 80, y0: 0, y1: 10, confidence: 50 },
      { text: "12", x0: 200, x1: 215, y0: 1, y1: 11 },
      { text: "Red", x0: 0, x1: 30, y0: 30, y1: 40 },
      { text: "7", x0: 205, x1: 212, y0: 30, y1: 40 },
    ]);
    expect(rows.map((r) => r.map((c) => c.text))).toEqual([
      ["Navy Blue", "12"],
      ["Red", "7"],
    ]);
    expect(rows[0]![0]!.confidence).toBe(50);
  });
});

describe("type it like the paper", () => {
  it("reads lines as the factories write them: dashes, blanks, totals and several styles", () => {
    const text = [
      "Delivery: House 12, Road 8",
      "CTN: 22 PCS",
      "Mash",
      "M - L - XL - XXL - 3XL",
      "Navy 1 - 7 - 4 - 7 - 5 = 24",
      "Black 2-4-5-4-7 = 22",
      "Khaki - 3-1-4 - =8",
      "Total = 54",
      "",
      "Diesel",
      "S M L XL",
      "Navy 2 - 7 3",
      "White - 12 3 -",
    ].join("\n");
    const { blocks, skipped } = parsePaperText(text);
    expect(blocks.map((b) => b.title)).toEqual(["Mash", "Diesel"]);
    const [mash, diesel] = blocks;
    expect(mash!.sizes).toEqual(["M", "L", "XL", "XXL", "3XL"]);
    expect(cells(mash!.rows[0]!)).toEqual([1, 7, 4, 7, 5]);
    expect(cells(mash!.rows[2]!)).toEqual([3, 1, 4]);
    expect(mash!.rows[2]!.writtenTotal).toBe(8);
    expect(mash!.writtenTotal).toBe(54);
    expect(blockProblems(mash!)).toEqual([]);
    // Spaces between the numbers: a dash alone is a blank size.
    expect(cells(diesel!.rows[0]!)).toEqual([2, null, 7, 3]);
    expect(cells(diesel!.rows[1]!)).toEqual([null, 12, 3]);
    // The address above the list is not pieces.
    expect(skipped.map((s) => s.text)).toEqual(["Delivery: House 12, Road 8", "CTN: 22 PCS"]);
  });

  it("marks totals that do not add up red, row by row and for the whole list", () => {
    const { blocks } = parsePaperText("HOODY\nS M L\nNavy 3 14 13 = 31\nGrey 1 1 1 = 3\nTotal 40");
    const problems = blockProblems(blocks[0]!);
    expect(problems).toEqual([
      "Navy: the numbers add up to 30, the paper says 31 (line 3).",
      "The rows add up to 33 pieces, the paper's total says 40.",
    ]);
  });

  it("refuses a row with more numbers than sizes, and skips a measurement row", () => {
    const { blocks, skipped } = parsePaperText(
      "HOODY-ZIP\nS M L\nZIPPER MESUR. 63 66 67.5 cm\nBlack 20 58 58 40\n",
    );
    expect(skipped.map((s) => s.why)).toEqual(["A measurement, not pieces"]);
    expect(blockProblems(blocks[0]!)[0]).toMatch(/Black has 4 numbers for 3 sizes/);
  });

  it("keeps a number marked ? as one to check (yellow), and round-trips the text", () => {
    const { blocks } = parsePaperText("Polo\nS M L\nNavy 52? - - 7 = 59");
    const row = blocks[0]!.rows[0]!;
    expect(row.cells[0]).toEqual({ pieces: 52, unsure: "Check this number against the paper" });
    expect(row.cells[1]).toEqual({ pieces: null, unsure: null });
    const again = parsePaperText(renderPaperText(blocks)).blocks;
    expect(again).toEqual(
      blocks.map((b) => ({ ...b, rows: b.rows.map((r) => ({ ...r, line: 3 })) })),
    );
  });

  it("reads numbers the way they are written", () => {
    expect(readPieces("1,200")).toEqual({ pieces: 1200, unsure: null });
    expect(readPieces("45 pcs")).toEqual({ pieces: 45, unsure: null });
    expect(readPieces("-")).toBeNull();
    expect(readPieces("2O")).toEqual({ pieces: 20, unsure: "Read “2O” as 20" });
    expect(readPieces("abc")!.unsure).toMatch(/Could not read/);
  });
});

describe("matching handwritten names to the catalog", () => {
  const colours = [
    "Black",
    "Navy",
    "Grey",
    "Green",
    "Anthracite",
    "Orange",
    "Coffee",
    "Brick",
    "White",
  ].map((name, i) => ({ id: `c${i}`, name }));
  const guess = (written: string) => closest(written, colours, (c) => c.name);

  it("finds the colour a misspelt name means, and says when it is a guess", () => {
    expect(guess("BLACK")).toEqual({ item: colours[0], exact: true });
    for (const [written, meant] of [
      ["NAWY", "Navy"],
      ["ANTRA", "Anthracite"],
      ["GREEY", "Grey"],
      ["ORENCH", "Orange"],
      ["COFFY", "Coffee"],
      ["BRIKS", "Brick"],
    ] as const) {
      expect(guess(written), written).toMatchObject({ item: { name: meant }, exact: false });
    }
  });

  it("leaves a name nothing (or two colours equally) is like for the person to pick", () => {
    expect(guess("Purple")).toBeNull();
    expect(closest("Blu", [{ name: "Blue" }, { name: "Blush" }], (c) => c.name)).toBeNull();
  });

  it("matches sizes as written and suggests the closest styles to a title", () => {
    const sizes = [{ name: "S" }, { name: "XXL" }, { name: "3XL" }];
    expect(sizeFor("2XL", sizes)).toEqual({ name: "XXL" });
    expect(sizeFor("xxxl", sizes)).toEqual({ name: "3XL" });
    const styles = [
      { code: "LC-POLO", name: "Lacoste polo" },
      { code: "HZ-01", name: "Hoody zip" },
      { code: "RL-SW", name: "RL Sweater" },
    ];
    expect(likelyStyles("HOODY-ZIP", styles)[0]).toEqual(styles[1]);
    expect(likelyStyles("Lacoste-polo", styles)[0]).toEqual(styles[0]);
  });
});

describe("the upload window's choices", () => {
  const colours = [
    { id: "c1", name: "Navy" },
    { id: "c2", name: "Anthracite" },
    { id: "c3", name: "Grey" },
    { id: "c4", name: "Green" },
  ];

  it("takes a factory's remembered spelling first, then the same name, then a guess", () => {
    expect(colourChoice("GREE", colours, { GREE: "c3" })).toEqual({
      value: "c3",
      how: "REMEMBERED",
    });
    expect(colourChoice("navy", colours, {})).toEqual({ value: "c1", how: "SAME" });
    expect(colourChoice("ANTRA", colours, {})).toEqual({ value: "c2", how: "GUESS" });
    expect(colourChoice("Purple", colours, {})).toEqual({ value: "", how: "NONE" });
    expect(sizeChoice("2XL", [{ id: "s1", name: "XXL" }])).toEqual({ value: "s1", how: "SAME" });
    expect(sizeChoice("3XL", [{ id: "s1", name: "XXL" }])).toEqual({ value: "NEW", how: "NEW" });
  });

  it("picks the style only when it is clear, and offers the closest ones", () => {
    const styles = [
      { id: "a", code: "HZ-01", name: "Hoody zip" },
      { id: "b", code: "LC-POLO", name: "Lacoste polo" },
    ];
    const page = styles[0]!;
    expect(styleChoice({ title: null }, styles, page).value).toBe("a");
    expect(styleChoice({ title: "Lacoste polo" }, styles, page).value).toBe("b");
    expect(styleChoice({ title: "Mash" }, styles, page).value).toBe("");
    expect(codeFromTitle("R-L Ziper polo stock")).toBe("R-L-ZIPER-POLO-STOCK");
    expect(tidyName("ANTRA")).toBe("Antra");
  });

  it("adds up a block's pieces by written colour and size", () => {
    const { blocks } = parsePaperText("X\nS M\nNavy 1 2\nNAVY 3 -\nGrey 0 4");
    expect(cellsWithPieces(blocks[0]!)).toEqual([
      { colour: "Navy", size: "S", pieces: 4 },
      { colour: "Navy", size: "M", pieces: 2 },
      { colour: "Grey", size: "M", pieces: 4 },
    ]);
  });

  it("sends the pieces to Buy ready stock in its link, and reads only what it should", () => {
    const style = "ckstyle0000000000000000001";
    const link = buyReadyLink(style, [
      { colorId: "ckcolour00000000000000001", sizeId: "cksize0000000000000000001", pieces: 12 },
    ]);
    const params = Object.fromEntries(new URL(link, "http://x").searchParams);
    expect(link.startsWith("/business/retail/shop-stock?")).toBe(true);
    expect(readBuyPrefill(params)).toEqual({
      styleId: style,
      pieces: { "ckcolour00000000000000001:cksize0000000000000000001": 12 },
    });
    expect(readBuyPrefill({ buy: "x'; drop", pieces: "a.b.1" })).toBeNull();
    expect(readBuyPrefill({ buy: style, pieces: "bad,ckcolour00000000000000001.x.1" })).toEqual({
      styleId: style,
      pieces: {},
    });
  });
});
