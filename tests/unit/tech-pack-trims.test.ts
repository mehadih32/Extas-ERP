import { describe, expect, it } from "vitest";

import {
  diffTrimsParts,
  readChanges,
  readTrimsPart,
  type TrimsPart,
} from "@/modules/production/tech-pack";

/*
 * A tech pack's trims part (v6.4.2): the trims, collar and cuff it was approved
 * with, and what changed since, so the part (and its trims bookings) waits to
 * be approved again.
 */

const item = (over: Partial<TrimsPart["items"][number]> = {}): TrimsPart["items"][number] => ({
  code: "TR-0001",
  name: "Polo Button 18L",
  kind: "TRIM",
  specification: "4 holes",
  colour: "Navy",
  unit: "PCS",
  perPiece: "3",
  wastagePercent: "2",
  split: "TOTAL",
  placement: "Placket",
  notes: null,
  imageId: null,
  ...over,
});

describe("what changed in a trims part since it was approved", () => {
  it("finds nothing when nothing changed", () => {
    const part = { items: [item(), item({ code: "TR-0002", name: "Flat knit collar" })] };
    expect(diffTrimsParts(part, structuredClone(part))).toEqual([]);
  });

  it("shows each change to a trim, collar or cuff as it was and as it is now", () => {
    const was = { items: [item(), item({ code: "TR-0002", name: "Flat knit collar" })] };
    const now = {
      items: [
        item({
          colour: "White",
          perPiece: "4",
          placement: "Cuff",
          notes: "Gold rim",
          imageId: "f1",
          split: "COLOUR_SIZE",
        }),
        item({
          code: "TR-0003",
          name: "Hang tag",
          unit: "PCS",
          perPiece: "1",
          wastagePercent: "0",
        }),
      ],
    };
    expect(diffTrimsParts(was, now)).toEqual([
      { item: "TR-0001 Polo Button 18L: colour", was: "Navy", now: "White" },
      { item: "TR-0001 Polo Button 18L: placement", was: "Placket", now: "Cuff" },
      { item: "TR-0001 Polo Button 18L: notes", was: "None", now: "Gold rim" },
      {
        item: "TR-0001 Polo Button 18L: use",
        was: "3 pcs a piece + 2% wastage",
        now: "4 pcs a piece + 2% wastage",
      },
      { item: "TR-0001 Polo Button 18L: split", was: "one total", now: "by colour and size" },
      { item: "TR-0001 Polo Button 18L: picture", was: "None", now: "A new picture" },
      { item: "TR-0002 Flat knit collar", was: "3 pcs a piece + 2% wastage", now: "Taken off" },
      { item: "TR-0003 Hang tag", was: "Not used", now: "1 pcs a piece + 0% wastage" },
    ]);
  });

  it("reads only what it kept, and leaves bad rows out", () => {
    expect(readTrimsPart(null)).toBeNull();
    expect(readTrimsPart({ fabrics: [] })).toBeNull();
    expect(readTrimsPart({ items: [item()] })).toEqual({ items: [item()] });
    expect(readChanges([{ item: "A", was: "1", now: "2" }, { item: "B" }, null, "C"])).toEqual([
      { item: "A", was: "1", now: "2" },
    ]);
    expect(readChanges({})).toEqual([]);
  });
});
