import { describe, expect, it } from "vitest";

import {
  checkDesign,
  designFacts,
  looksLikeDst,
  LONGEST_STITCH_MM,
  machineFileName,
  readDst,
  readExp,
  readSvg,
  svgToDesign,
  VectorError,
  writeDst,
  writeExp,
  type Design,
} from "@/modules/production/logo-files";

/* Logo machine files (X24): reading and writing DST and EXP, checking them, and the draft from a vector. */

const square: Design = {
  stitches: [
    { x: 0, y: 0, kind: "JUMP" },
    { x: 100, y: 0, kind: "STITCH" },
    { x: 100, y: 100, kind: "STITCH" },
    { x: 0, y: 100, kind: "STITCH" },
    { x: 0, y: 0, kind: "STITCH" },
    { x: 0, y: 0, kind: "COLOR" },
    { x: 250, y: 50, kind: "JUMP" },
    { x: 270, y: 50, kind: "STITCH" },
    { x: 270, y: 50, kind: "END" },
  ],
};

const LOGO = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <!-- a red bar and a navy ring -->
  <rect x="0" y="0" width="120" height="100" fill="#cc0000"/>
  <g transform="translate(160 50)">
    <circle cx="0" cy="0" r="40" style="fill:#1f2a44"/>
  </g>
</svg>`;

describe("logo machine files", () => {
  it("writes a DST that reads back with the same stitches, colours and size", () => {
    const bytes = writeDst(square, "TEST LOGO");
    expect(looksLikeDst(bytes)).toBe(true);
    expect(new TextDecoder().decode(bytes.subarray(0, 3))).toBe("LA:");
    const back = readDst(bytes);
    const facts = designFacts(back);
    expect(facts).toMatchObject({ stitches: 5, colours: 2, widthMm: 27, heightMm: 10 });
    expect(facts.longestStitchMm).toBe(10);
    // A move longer than 12.1 mm is split into jumps the format can hold.
    expect(back.stitches.filter((s) => s.kind === "JUMP").length).toBeGreaterThan(1);
    expect(back.stitches.at(-1)?.kind).toBe("END");
  });

  it("writes an EXP that reads back the same", () => {
    const back = readExp(writeExp(square));
    expect(designFacts(back)).toMatchObject({ stitches: 5, colours: 2, widthMm: 27, heightMm: 10 });
  });

  it("refuses bytes that are not a DST", () => {
    expect(() => readDst(new Uint8Array(600))).toThrow("not a DST");
  });

  it("checks a file against the spec: size, longest stitch, colours and stitch count", () => {
    expect(checkDesign(square, { widthMm: 27, heightMm: 10, colours: 2 }).verdict).toBe("PASS");
    const wrongSize = checkDesign(square, { widthMm: 20 });
    expect(wrongSize.verdict).toBe("FAIL");
    expect(wrongSize.notes[0]).toContain("Width 27 mm");
    expect(checkDesign(square, { colours: 3 }).verdict).toBe("WARN");
    expect(checkDesign(square, { approvedStitches: 6 }).verdict).toBe("FAIL");
    const long: Design = {
      stitches: [
        { x: 0, y: 0, kind: "STITCH" },
        { x: 150, y: 0, kind: "STITCH" },
      ],
    };
    expect(checkDesign(long).notes.join(" ")).toContain(`${LONGEST_STITCH_MM} mm at most`);
    expect(checkDesign({ stitches: [] }).verdict).toBe("FAIL");
    const farJump: Design = {
      stitches: [
        { x: 0, y: 0, kind: "STITCH" },
        { x: 400, y: 0, kind: "JUMP" },
        { x: 410, y: 0, kind: "STITCH" },
      ],
    };
    expect(checkDesign(farJump)).toMatchObject({ verdict: "WARN" });
    expect(checkDesign(farJump).notes[0]).toContain("should trim");
  });

  it("turns a vector logo into a draft at the logo's width, one thread per colour", () => {
    const design = svgToDesign(LOGO, 50);
    const facts = designFacts(design);
    expect(Math.abs(facts.widthMm - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(facts.heightMm - 25)).toBeLessThanOrEqual(1);
    expect(facts.colours).toBe(2);
    expect(facts.longestStitchMm).toBeLessThanOrEqual(LONGEST_STITCH_MM);
    expect(facts.stitches).toBeGreaterThan(500);
    // The draft survives a DST round trip.
    const back = designFacts(readDst(writeDst(design, "LOGO")));
    expect(back.stitches).toBe(facts.stitches);
    expect(back.widthMm).toBe(facts.widthMm);
  });

  it("reads paths with curves and arcs", () => {
    const { shapes } = readSvg(
      `<svg viewBox="0 0 10 10"><path d="M0 0 C 2 4 6 4 8 0 S 10 6 5 9 A 3 3 0 0 1 0 0 Z" fill="black"/></svg>`,
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.rings[0]!.length).toBeGreaterThan(30);
  });

  it("refuses live text, pictures and empty files", () => {
    expect(() => readSvg(`<svg><text x="0" y="0">EXTAS</text></svg>`)).toThrow(/outlines/);
    expect(() => readSvg(`<svg><image href="logo.png"/></svg>`)).toThrow(VectorError);
    expect(() => readSvg(`<svg></svg>`)).toThrow(/no shapes/);
    expect(() => readSvg(`not a vector`)).toThrow(/not an SVG/);
  });

  it("names machine files in 8 characters", () => {
    expect(machineFileName("Lacoste croc", "Pique", 1)).toBe("LACOPI01");
    expect(machineFileName("RL", null, 12)).toBe("RL12");
    expect(machineFileName("Big Pony Navy", "Jersey", 3).length).toBeLessThanOrEqual(8);
  });
});
